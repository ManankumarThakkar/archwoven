import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  SystemModelSchema,
  validateModel,
  type SystemModel,
  type ViewType,
} from '@archwoven/model';

export const MODEL = 'claude-opus-5-5';
export const MAX_REPAIRS = 2;

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

/** Minimal surface we need — lets tests inject a fake. */
export interface ParseClient {
  messages: {
    parse(params: unknown): Promise<{
      parsed_output: unknown;
      usage: {
        input_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        output_tokens?: number;
      };
    }>;
  };
}

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
- labels short (<= 40 chars); no HTML, no markdown, no comments in the JSON.`;

function usageFrom(
  usage: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number },
  effort: Effort,
  latencyMs: number,
  repairs: number,
): TaskUsage {
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

/**
 * Generate (or repair) a system model for one view.
 * Structured output is constrained to SystemModelSchema; graph validation runs
 * client-side and validator errors are fed back for up to MAX_REPAIRS rounds.
 */
export async function generateModel(
  prompt: string,
  view: ViewType,
  opts: { client?: ParseClient; effort?: Effort } = {},
): Promise<GenerateOutcome> {
  const effort: Effort = opts.effort ?? 'medium';
  const client: ParseClient =
    opts.client ??
    (new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as ParseClient);

  const t0 = Date.now();
  const messages: unknown[] = [{ role: 'user', content: `View: ${view}\n\n${prompt}` }];

  let lastErrors: string[] = [];
  let repairs = 0;
  let usage: TaskUsage | null = null;

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    let response: Awaited<ReturnType<ParseClient['messages']['parse']>>;
    try {
      response = await client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        system: [{ type: 'text', text: STABLE_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages,
        output_config: { format: zodOutputFormat(SystemModelSchema), effort },
      });
    } catch (e) {
      // Structured output unparseable (e.g. truncated at max_tokens) — a failed
      // attempt, not a crash: ask for a complete regeneration within the repair budget.
      lastErrors = [`previous output was not valid JSON: ${e instanceof Error ? e.message : String(e)}`];
      usage = usageFrom({}, effort, Date.now() - t0, repairs);
      if (attempt < MAX_REPAIRS) {
        repairs++;
        messages.push({ role: 'user', content: `Your previous response was not valid JSON matching the schema (it may have been truncated) — emit the complete valid JSON only, and keep it under the token budget.` });
      }
      continue;
    }
    usage = usageFrom(response.usage, effort, Date.now() - t0, repairs);

    const result = validateModel(response.parsed_output);
    if (result.ok) return { ok: true, model: result.model, usage };

    lastErrors = result.errors;
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: JSON.stringify(response.parsed_output) });
      messages.push({
        role: 'user',
        content: `The model JSON failed validation with these errors — fix them and emit the complete corrected JSON only:\n- ${lastErrors.join('\n- ')}`,
      });
    }
  }

  return { ok: false, errors: lastErrors, usage: usage ?? usageFrom({}, effort, Date.now() - t0, repairs) };
}
