import { HOSTED_MODELS, resolveHostedModelId } from '@archwoven/model';
import { openEvaluationBudget, type EvaluationBudget } from '@archwoven/jobs';
import { makeAnthropic, resolveApiKey, MAX_TOKENS, STRUCTURED_OUTPUTS_BETA, ProviderAccountingError, ProviderRequestNotSentError, type RawUsage, type StructuredClient } from '@archwoven/llm';

/** Reviewed context ceiling, not a count_tokens estimate. Standard global direct
 * API, no tools, 5-minute caches. Re-review this contract when adding models or
 * paid features. https://platform.claude.com/docs/en/models/overview */
const CONTEXT_CEILING = 1_000_000;
const refusal = () => new ProviderRequestNotSentError('This evaluation request uses options outside the reviewed spending limits. Nothing was sent.');
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw refusal();
  return value as Record<string, unknown>;
};
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw refusal();
}
function text(value: unknown) {
  if (typeof value === 'string') return;
  if (!Array.isArray(value)) throw refusal();
  for (const item of value) {
    const block = object(item); keys(block, ['type', 'text', 'cache_control']);
    if (block.type !== 'text' || typeof block.text !== 'string') throw refusal();
    if (block.cache_control !== undefined) {
      const cache = object(block.cache_control); keys(cache, ['type', 'ttl']);
      if (cache.type !== 'ephemeral' || (cache.ttl !== undefined && cache.ttl !== '5m')) throw refusal();
    }
  }
}

export function evaluationReservation(raw: unknown) {
  const request = object(raw); keys(request, ['model', 'max_tokens', 'system', 'messages', 'betas', 'output_config']);
  if (typeof request.model !== 'string' || !Object.hasOwn(HOSTED_MODELS, request.model)) throw refusal();
  const model = resolveHostedModelId(request.model);
  if (!Number.isSafeInteger(request.max_tokens) || (request.max_tokens as number) < 1 || (request.max_tokens as number) > MAX_TOKENS) throw refusal();
  text(request.system);
  if (!Array.isArray(request.messages)) throw refusal();
  for (const rawMessage of request.messages) {
    const message = object(rawMessage); keys(message, ['role', 'content']);
    if (message.role !== 'user' && message.role !== 'assistant') throw refusal();
    text(message.content);
  }
  if (request.betas !== undefined && (!Array.isArray(request.betas) || request.betas.some(beta => beta !== STRUCTURED_OUTPUTS_BETA))) throw refusal();
  if (request.output_config !== undefined) {
    const config = object(request.output_config); keys(config, ['format', 'effort']);
    if (config.effort !== undefined && !['low', 'medium', 'high'].includes(config.effort as string)) throw refusal();
    const format = object(config.format); keys(format, ['type', 'schema']);
    if (format.type !== 'json_schema') throw refusal();
    object(format.schema);
  }
  const profile = HOSTED_MODELS[model];
  const multiplier = model === 'claude-haiku-5-5' ? 5 : 1; // reserve the higher long-context tier
  const maxTokens = request.max_tokens as number;
  const nanos = CONTEXT_CEILING * (Math.max(profile.prices.input, profile.prices.cacheWrite, profile.prices.cacheRead) * 1000) * multiplier
    + maxTokens * (profile.prices.output * 1000) * multiplier;
  return { model, maxTokens, nanos, basis: profile.costBasis };
}

function charge(quote: ReturnType<typeof evaluationReservation>, usage: RawUsage): number | null | 'out-of-contract' {
  const values = [usage?.input_tokens, usage?.output_tokens,
    usage?.cache_creation_input_tokens === undefined ? 0 : usage.cache_creation_input_tokens,
    usage?.cache_read_input_tokens === undefined ? 0 : usage.cache_read_input_tokens];
  if (!values.every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return null;
  const [input, output, write, read] = values as number[];
  const total = input! + write! + read!;
  if (total > CONTEXT_CEILING || output! > quote.maxTokens) return 'out-of-contract';
  const rates = HOSTED_MODELS[quote.model].prices;
  const multiplier = quote.model === 'claude-haiku-5-5' && total > 100_000 ? 5 : 1;
  return (input! * (rates.input * 1000) + output! * (rates.output * 1000) + write! * (rates.cacheWrite * 1000) + read! * (rates.cacheRead * 1000)) * multiplier;
}

/** All paid attempts (including repairs/retries) cross this boundary. Unknown
 * usage and crashes keep the entire hold. SDK automatic retries are disabled. */
export function withEvaluationBudget(client: StructuredClient, budget: EvaluationBudget): StructuredClient {
  const before = <T>(action: () => T, signal?: AbortSignal): T => {
    if (signal?.aborted) throw new ProviderRequestNotSentError('Evaluation cancelled before sending.');
    try { return action(); } catch (error) {
      if (error instanceof ProviderRequestNotSentError) throw error;
      throw new ProviderRequestNotSentError(error instanceof Error && error.message.startsWith('Evaluation budget cannot cover')
        ? error.message : 'Evaluation budget is unavailable. Nothing was sent. Check the local ledger before continuing.');
    }
  };
  return {
    messages: { countTokens: async (params, options) => {
      // Free preflight avoids a network request when even the smallest supported
      // attempt cannot fit. Only reserve() below is authoritative for concurrency.
      before(() => budget.assertAvailable(evaluationReservation({ ...params, max_tokens: 1 }).nanos), options?.signal);
      return client.messages.countTokens(params, options);
    } },
    beta: { messages: { create: async (params, options) => {
      const quote = before(() => evaluationReservation(params), options?.signal);
      const ticket = before(() => budget.reserve(quote.nanos, { model: quote.model, basis: quote.basis }), options?.signal);
      let response: Awaited<ReturnType<StructuredClient['beta']['messages']['create']>>;
      try {
        // Pin charge-affecting defaults too: a workspace can default to US-only
        // inference. Explicit global/standard options keep the reviewed rates.
        response = await client.beta.messages.create({ ...object(params), service_tier: 'standard_only', inference_geo: 'global', speed: 'standard' }, options);
      }
      catch (error) {
        try { budget.settle(ticket, null); }
        catch { throw new ProviderAccountingError('Evaluation accounting failed after sending. Its spending reservation is retained; further automatic retries were stopped.'); }
        throw error;
      }
      try {
        const cost = charge(quote, response.usage);
        if (cost === 'out-of-contract') {
          budget.freeze(); budget.settle(ticket, null);
          throw new ProviderAccountingError('Provider usage exceeded the reviewed evaluation limits. The budget is frozen for inspection.');
        }
        budget.settle(ticket, cost);
      }
      catch (error) {
        if (error instanceof ProviderAccountingError) throw error;
        throw new ProviderAccountingError('Evaluation accounting failed after sending. Its spending reservation is retained; further automatic retries were stopped.');
      }
      return response;
    } } },
  };
}

let singleton: { file: string; budget: EvaluationBudget } | undefined;
/** Opt-in local evaluation only. Public deployment uses a separate shared quota
 * design; SQLite evaluation ledgers must never masquerade as distributed caps. */
export function evaluationClient(): StructuredClient | undefined {
  const file = process.env.ARCHWOVEN_EVAL_BUDGET_DB;
  if (file === undefined) return undefined;
  if (!file.trim() || process.env.VERCEL || process.env.ARCHWOVEN_MODE === 'local' || process.env.ARCHWOVEN_FAKE === '1') throw new Error('Evaluation budgets require a local hosted-mode server with sample data disabled.');
  if (file === process.env.ARCHWOVEN_DB) throw new Error('Use a separate evaluation budget database.');
  if (singleton && singleton.file !== file) throw new Error('Restart the server to change the evaluation budget ledger.');
  singleton ??= { file, budget: openEvaluationBudget(file) };
  return withEvaluationBudget(makeAnthropic(resolveApiKey()) as unknown as StructuredClient, singleton.budget);
}
