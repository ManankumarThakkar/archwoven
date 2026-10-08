import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  SystemModelSchema,
  validateModel,
  type SystemModel,
  type ViewType,
} from '@archwoven/model';

export const MODEL = 'claude-opus-5-5';
export const MAX_REPAIRS = 2;
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

type RawUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

/** Minimal surface we need — lets tests inject a fake. */
export interface StructuredClient {
  beta: {
    messages: {
      create(params: unknown): Promise<{
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
- labels short (<= 40 chars); no HTML, no markdown, no comments in the JSON.`;

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
  const client: StructuredClient =
    opts.client ??
    (new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as StructuredClient);

  const t0 = Date.now();
  const messages: unknown[] = [{ role: 'user', content: `View: ${view}\n\n${prompt}` }];

  let lastErrors: string[] = [];
  let repairs = 0;
  let usage: TaskUsage | null = null;

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    let response: Awaited<ReturnType<StructuredClient['beta']['messages']['create']>>;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: [STRUCTURED_OUTPUTS_BETA],
        system: [{ type: 'text', text: STABLE_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages,
        output_config: { format: { type: 'json_schema', schema: faithfulSchema, name: 'system_model' }, effort },
      });
    } catch (e) {
      lastErrors = [`request failed: ${e instanceof Error ? e.message : String(e)}`];
      usage = usageFrom({}, effort, Date.now() - t0, repairs);
      continue; // transient/transport failure — retry within budget
    }
    usage = usageFrom(response.usage, effort, Date.now() - t0, repairs);

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
    if (result.ok) return { ok: true, model: result.model, usage };

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

  return { ok: false, errors: lastErrors, usage: usage ?? usageFrom({}, effort, Date.now() - t0, repairs) };
}
