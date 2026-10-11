import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  SystemModelSchema,
  validateModel,
  validFullModelExtended,
  type SystemModel,
  type ViewType,
} from '@archwoven/model';

export const MODEL = 'claude-opus-5-5';
export const MAX_REPAIRS = 2;
/** §15 LOCKED: max_tokens ≤ 8k. If live truncation recurs, the fix is effort-low
 *  output or a spec config-review amendment — never silent drift in code. */
export const MAX_TOKENS = 8192;
/** §15 LOCKED: assembled context > 25k tokens is rejected before send. */
export const CONTEXT_TOKEN_LIMIT = 25_000;

/**
 * Always talk to api.anthropic.com directly. The SDK defaults baseURL to
 * process.env.ANTHROPIC_BASE_URL — a dev shell behind a proxy (Claude Code's
 * 127.0.0.1:2018) would silently drop output_config and free-generate markdown,
 * and would forward the API key to whatever proxy is configured.
 */
export const makeAnthropic = (apiKey: string): Anthropic =>
  new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com' });

/** Zero-spend mode for quota/e2e smoke: return a canned valid model, never call the API. */
export const fakeMode = () => process.env.ARCHWOVEN_FAKE === '1';
const fakeUsage = (effort: Effort): TaskUsage => ({ model: MODEL, effort, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, latencyMs: 0, repairs: 0 });

/** tsx/node --env-file does not strip surrounding quotes; a key written as
 *  KEY="sk-ant-…" arrives with literal quotes and 401s. Sanitize defensively. */
export const resolveApiKey = (raw = process.env.ANTHROPIC_API_KEY): string =>
  (raw ?? '').trim().replace(/^["']|["']$/g, '');
/** Structured outputs is a beta capability — without this header the API silently
 *  ignores output_config.format and free-generates markdown. The SDK's beta namespace
 *  does NOT add it for us on .create(); we must pass it explicitly. */
export const STRUCTURED_OUTPUTS_BETA = 'structured-outputs-2025-12-15';

export interface TaskUsage {
  model: string;
  effort: Effort;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  latencyMs: number;
  repairs: number;
}

export type Effort = 'low' | 'medium' | 'high';

export type GenerateOutcome =
  | { ok: true; model: SystemModel; usage: TaskUsage }
  | { ok: false; errors: string[]; usage: TaskUsage };

export type RawUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

/** Minimal surface we need — lets tests inject a fake. */
export interface StructuredClient {
  messages: {
    countTokens(params: { model: string; system: unknown; messages: unknown[] }): Promise<{ input_tokens: number }>;
  };
  beta: {
    messages: {
      create(params: unknown, options?: { signal?: AbortSignal }): Promise<{
        content: { type: string; text?: string }[];
        stop_reason: string | null;
        usage: RawUsage;
      }>;
    };
  };
}

/**
 * Faithful JSON schema sent to the API. We deliberately do NOT use the SDK's
 * zodOutputFormat(): its transformJSONSchema strips `enum`/`minLength`/`default`
 * into the description string, so the grammar stops constraining kind/type/
 * provenance and the model drifts to a generic source/target/kind shape.
 * `reused:'inline'` avoids $defs/$ref so the grammar is fully explicit.
 */
export const faithfulSchema = z.toJSONSchema(SystemModelSchema, {
  reused: 'inline',
  target: 'draft-2020-12',
});

/**
 * Stable system prefix — frozen bytes so prompt caching hits across every call.
 * Volatile content (the user prompt) goes in the message, never here.
 */
export const STABLE_SYSTEM = `You are Archwoven's architecture design model. Emit ONLY a valid Archwoven system model JSON (schemaVersion "1").

Hard rules:
- revision is always 1 for a new model; parentId omitted.
- ids are stable, lowercase, dotted: svc.orders, entity.user, e.api-orders.
- every node and edge carries provenance: user-specified (stated by the user), source-supported (seen in code), inferred (reasonable deduction), proposed (your recommendation, not the user's).
- never invent business-critical components as user-specified; when unsure use inferred or proposed.
- sequence views: participants + messages, seq consecutive from 1, kind call|return|async, fragments alt|loop|opt with covers listing message seqs.
- ER views: entity nodes with fields (name, type, key pk|fk|uk) and relation edges with cardinality 1:1|1:N|N:M.
- every view lists its member node ids and edge ids; every referenced id exists.
- labels short (<= 40 chars); no HTML, no markdown, no comments in the JSON.
- Optional semantic fields — emit when they genuinely hold: semanticChecks (allowedRoots/allowedTerminals = nodes legitimately without incoming/outgoing edges, requiredEdges/requiredPaths = bindings and paths the architecture really has), view mainPath (ordered node ids along real forward edges), edge role (main|branch|async|return|error), boundaries (wraps node ids, a node sits in at most one), guidedViews (<= 5 chapters, focus = node ids, note explains the chapter). Never emit a check your own output would fail.`;

export function usageFrom(usage: RawUsage, effort: Effort, latencyMs: number, repairs: number): TaskUsage {
  return {
    model: MODEL,
    effort,
    inputTokens: usage.input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    latencyMs,
    repairs,
  };
}

const textOf = (content: { type: string; text?: string }[]) =>
  content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');

/**
 * Generate (or repair) a system model for one view.
 * Structured output is constrained to a faithful SystemModelSchema via the beta
 * endpoint; graph validation runs client-side and validator errors are fed back
 * for up to MAX_REPAIRS rounds. We use .create() + our own parse so that a
 * truncated or invalid response still yields the raw text we can quote back to
 * the model — .parse() throws and discards it, so repairs never converge.
 */
export async function generateModel(
  prompt: string,
  view: ViewType,
  opts: { client?: StructuredClient; effort?: Effort } = {},
): Promise<GenerateOutcome> {
  const effort: Effort = opts.effort ?? 'medium';
  if (!opts.client && fakeMode()) return { ok: true, model: structuredClone(validFullModelExtended), usage: fakeUsage(effort) };
  const client: StructuredClient =
    opts.client ?? (makeAnthropic(resolveApiKey()) as unknown as StructuredClient);

  const t0 = Date.now();
  const messages: unknown[] = [{ role: 'user', content: `View: ${view}\n\n${prompt}` }];
  const system = [{ type: 'text', text: STABLE_SYSTEM, cache_control: { type: 'ephemeral' } }];

  // §15 per-request gate: exact token count before send. Fail closed — an
  // uncounted send is exactly the oversized context the gate exists to stop.
  try {
    const counted = await client.messages.countTokens({ model: MODEL, system, messages });
    if (counted.input_tokens > CONTEXT_TOKEN_LIMIT) {
      return { ok: false, errors: ['assembled context exceeds the 25k token limit — scope the description down to one system or flow'], usage: usageFrom({}, effort, Date.now() - t0, 0) };
    }
  } catch (e) {
    return { ok: false, errors: [`context token count failed: ${e instanceof Error ? e.message : String(e)}`], usage: usageFrom({}, effort, Date.now() - t0, 0) };
  }

  let lastErrors: string[] = [];
  let repairs = 0;
  // Billed usage accumulates across every attempt — repairs cost real money and
  // the stop-loss/§11 meter must see it, not just the last attempt.
  const billed: Required<RawUsage> = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  const addUsage = (u: RawUsage) => {
    billed.input_tokens += u.input_tokens ?? 0;
    billed.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
    billed.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    billed.output_tokens += u.output_tokens ?? 0;
  };

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    let response: Awaited<ReturnType<StructuredClient['beta']['messages']['create']>>;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        betas: [STRUCTURED_OUTPUTS_BETA],
        system,
        messages,
        output_config: { format: { type: 'json_schema', schema: faithfulSchema, name: 'system_model' }, effort },
      });
    } catch (e) {
      lastErrors = [`request failed: ${e instanceof Error ? e.message : String(e)}`];
      continue; // transient/transport failure — retry within budget
    }
    addUsage(response.usage);

    const text = textOf(response.content);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      lastErrors = [`output was not valid JSON (${response.stop_reason ?? 'unknown'}): ${e instanceof Error ? e.message : String(e)}`];
      if (attempt < MAX_REPAIRS) {
        repairs++;
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: `Your previous response was not complete valid JSON${response.stop_reason === 'max_tokens' ? ' (it was truncated)' : ''} — emit the complete valid Archwoven system model JSON only, no markdown, no commentary.` });
      }
      continue;
    }

    const result = validateModel(parsed);
    if (result.ok) return { ok: true, model: result.model, usage: usageFrom(billed, effort, Date.now() - t0, repairs) };

    lastErrors = result.errors;
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `The model JSON failed validation with these errors — fix them and emit the complete corrected JSON only:\n- ${lastErrors.join('\n- ')}`,
      });
    }
  }

  return { ok: false, errors: lastErrors, usage: usageFrom(billed, effort, Date.now() - t0, repairs) };
}
