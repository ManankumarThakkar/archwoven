import { newUsageLedger, startAttempt, captureUsage, recordAttemptError, type UsageLedger } from './usage';
import { guardEgress, SecretEgressError } from './secrets';
import type { TaskUsage } from '@archwoven/model';
export type { TaskUsage } from '@archwoven/model';
import { ClarificationSchema, CLARIFICATION_SYSTEM, type DescriptionOutcome } from './clarification';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { generatedViewErrors } from './generated-view';
import {
  SystemModelSchema,
  validateModel,
  validFullModelExtended,
  type SystemModel,
  type ViewType,
  DEFAULT_HOSTED_MODEL, HOSTED_REQUESTS, resolveHostedModelId, type HostedModelId,
} from '@archwoven/model';

export const MODEL = DEFAULT_HOSTED_MODEL;
/** Server configuration only; each task captures this once for all its attempts. */
export const configuredHostedModel = (): HostedModelId => resolveHostedModelId(process.env.ARCHWOVEN_HOSTED_MODEL);
export const MAX_REPAIRS = 2;
/** Fixed: max_tokens ≤ 8k. If live truncation recurs, the fix is effort-low
 *  output or a spec config-review amendment — never silent drift in code. */
export const MAX_TOKENS = 8192;
/** Fixed: assembled context > 25k tokens is rejected before send. */
export const CONTEXT_TOKEN_LIMIT = 25_000;

/**
 * Always talk to api.anthropic.com directly. The SDK defaults baseURL to
 * process.env.ANTHROPIC_BASE_URL — a dev shell behind a proxy (Claude Code's
 * 127.0.0.1:2018) would silently drop output_config and free-generate markdown,
 * and would forward the API key to whatever proxy is configured.
 */
export const makeAnthropic = (apiKey: string): Anthropic =>
  new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com', maxRetries: 0 });

/** Zero-spend mode for quota/e2e smoke: return a canned valid model, never call the API. */
export const fakeMode = () => process.env.ARCHWOVEN_FAKE === '1';
const fakeUsage = (effort: Effort): TaskUsage => ({ ...usageFrom({}, effort, 0, 0), provider: 'demo' });

/** tsx/node --env-file does not strip surrounding quotes; a key written as
 *  KEY="sk-ant-…" arrives with literal quotes and 401s. Sanitize defensively. */
export const resolveApiKey = (raw = process.env.ANTHROPIC_API_KEY): string =>
  (raw ?? '').trim().replace(/^["']|["']$/g, '');
/** Structured outputs is a beta capability — without this header the API silently
 *  ignores output_config.format and free-generates markdown. The SDK's beta namespace
 *  does NOT add it for us on .create(); we must pass it explicitly. */
export const STRUCTURED_OUTPUTS_BETA = 'structured-outputs-2025-12-15';

/** Every hosted call goes through the secret egress guard, including injected clients. */
export const hostedClient = (injected?: StructuredClient): StructuredClient =>
  guardEgress(injected ?? (makeAnthropic(resolveApiKey()) as unknown as StructuredClient));

/** Local preflight refusals explain themselves; other counting failures keep their cause. */
export const countFailureMessage = (e: unknown): string =>
  e instanceof SecretEgressError || e instanceof ProviderRequestNotSentError ? e.message : `context token count failed: ${e instanceof Error ? e.message : String(e)}`;

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
    countTokens(params: { model: string; system: unknown; messages: unknown[] }, options?: { signal?: AbortSignal }): Promise<{ input_tokens: number }>;
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

/** Terminal adapter refusals distinguish a send that never happened from an
 * ambiguous post-dispatch accounting failure. Neither is a transport retry. */
export class ProviderRequestNotSentError extends Error {}
export class ProviderAccountingError extends Error {}
export function providerRequestStopped(error: unknown, ledger: UsageLedger): boolean {
  if (error instanceof ProviderRequestNotSentError || error instanceof SecretEgressError) { ledger.attempts.pop(); return true; }
  recordAttemptError(ledger, error, error instanceof ProviderAccountingError ? 'accounting' : undefined);
  return error instanceof ProviderAccountingError;
}

/**
 * Convert a zod JSON schema into Anthropic's strict structured-outputs grammar
 * (verified live + platform docs):
 * - strips unsupported constraints (minimum/maximum/multipleOf, minItems>1/
 *   maxItems/uniqueItems, minLength/maxLength/pattern/format) — validateModel
 *   still enforces every one of them server-side on the response;
 * - every object gets additionalProperties:false (the API demands it);
 * - record/map nodes (object without properties — z.record) become JSON-encoded
 *   string fields, the only shape the grammar can express for dynamic keys;
 *   callers parse them back at their response boundary;
 * - dropProperties removes top-level properties entirely (layout is computed
 *   server-side — the model must not spend tokens guessing coordinates).
 * enum/const/required/properties/items survive — that is the grammar that
 * keeps output shaped.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'maxItems', 'uniqueItems', 'contains',
  'minLength', 'maxLength', 'pattern', 'format',
  'contentEncoding', 'contentMediaType',
]);

const isNullable = (s: unknown): boolean => {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  if (o.type === 'null') return true;
  if (Array.isArray(o.type) && o.type.includes('null')) return true;
  if (Array.isArray(o.anyOf) && o.anyOf.some(isNullable)) return true;
  return false;
};
const asNullable = (s: unknown): unknown => (isNullable(s) ? s : { anyOf: [s, { type: 'null' }] });

export function wireSchema(
  node: unknown,
  opts: { dropTopLevel?: readonly string[]; stringify?: Readonly<Record<string, string>>; atTop?: boolean; requireAllProperties?: boolean } = {},
): unknown {
  if (Array.isArray(node)) return node.map((n) => wireSchema(n, { ...opts, atTop: false }));
  if (!node || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (UNSUPPORTED_KEYWORDS.has(k)) continue;
    // minItems: only 0 or 1 are supported
    if (k === 'minItems' && v !== 0 && v !== 1) continue;
    // record subschema — the {type:'object'}-without-properties node replaces it below
    if (k === 'additionalProperties' && typeof v === 'object') continue;
    if (k === 'properties') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        if (opts.atTop && opts.dropTopLevel?.includes(pk)) continue;
        // deep nested shapes exceed the grammar's union cap as objects —
        // they travel as JSON-encoded strings, decoded by decodeWireModel
        const wireName = opts.stringify?.[pk];
        if (wireName) {
          props[wireName] = { type: 'string', description: `JSON-encoded ${pk} (compact JSON, no commentary)` };
          continue;
        }
        props[pk] = wireSchema(pv, { ...opts, atTop: false });
      }
      out[k] = props;
      continue;
    }
    if (k === 'required' && opts.atTop && opts.dropTopLevel?.length) {
      out[k] = (v as string[]).filter((r) => !opts.dropTopLevel!.includes(r));
      continue;
    }
    out[k] = wireSchema(v, { ...opts, atTop: false });
  }
  if (out.type === 'object' && out.properties === undefined) {
    // record/map → JSON-encoded object string (strict grammar cannot hold dynamic keys)
    const d = typeof out.description === 'string' ? `${out.description} ` : '';
    return { type: 'string', description: `${d}JSON-encoded object` };
  }
  if (out.type === 'object' && out.properties) {
    if (opts.requireAllProperties === false) {
      // Text prompts keep the model's optional/default semantics. The API-only
      // all-required/null workaround otherwise asks for invalid default arrays
      // (e.g. openQuestions:null) and parentId:null on a new model.
      out.required = ((out.required as string[]) ?? []).map((key) => opts.stringify?.[key] ?? key);
      out.additionalProperties = false;
      return out;
    }
    // strict grammar caps optional params (≤24, schema had 27): every property
    // becomes required; zod-optional ones carry null in their type instead.
    // Safe because the model schema uses .nullish() (null-accepting) throughout.
    const props = out.properties as Record<string, unknown>;
    const origRequired = new Set((out.required as string[]) ?? []);
    for (const pk of Object.keys(props)) {
      if (!origRequired.has(pk)) props[pk] = asNullable(props[pk]);
    }
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

/**
 * Faithful JSON schema sent to the API. We deliberately do NOT use the SDK's
 * zodOutputFormat(): its transformJSONSchema strips `enum`/`minLength`/`default`
 * into the description string, so the grammar stops constraining kind/type/
 * provenance and the model drifts to a generic source/target/kind shape.
 * `reused:'inline'` avoids $defs/$ref so the grammar is fully explicit.
 * Numeric bounds are stripped for API compatibility (stripNumericBounds).
 */
// evidence/fields/sequence travel as JSON strings: as objects their nested
// nullables blow the grammar's ≤16-union cap (verified live: 27 unions).
export const WIRE_STRINGIFIED: Readonly<Record<string, string>> = {
  evidence: 'evidenceJson',
  fields: 'fieldsJson',
  sequence: 'sequenceJson',
};

export const faithfulSchema = wireSchema(z.toJSONSchema(SystemModelSchema, {
  reused: 'inline',
  target: 'draft-2020-12',
}), { dropTopLevel: ['layout'], stringify: WIRE_STRINGIFIED, atTop: true }) as Record<string, unknown>;

/** The output contract both providers see: native JSON values with every nested
 * shape visible (evidence objects, fields, sequence), no grammar workarounds,
 * encoded strings or forced nullable defaults. Hosted calls use no grammar, so
 * the wire encoding only hid the evidence shape and every first attempt wrote
 * free-text evidence. New models have no parent and layout is computed by the
 * server. Ollama also receives this schema as `format`. */
export const NATIVE_MODEL_JSON_SCHEMA = z.toJSONSchema(SystemModelSchema.omit({ layout: true, parentId: true }), {
  reused: 'inline', target: 'draft-2020-12', io: 'input',
});
export const NATIVE_MODEL_JSON_CONTRACT = `Output must conform to this JSON schema. Use native JSON values: evidence and fields are arrays, sequence is an object with participants and messages. Omit absent optional fields; never replace default arrays with null. New models omit parentId and layout is computed by the server.
<model-json-schema>
${JSON.stringify(NATIVE_MODEL_JSON_SCHEMA)}
</model-json-schema>`;

/** The model sometimes wraps an otherwise complete JSON answer in one Markdown code
 * fence. Unwrap exactly that shape; any other surrounding text still fails to parse
 * and goes through the repair loop. */
export const unfenced = (text: string): string => /^\s*```(?:json)?[ \t]*\n([\s\S]*)\n```\s*$/.exec(text)?.[1] ?? text;

/** Decode wire-encoded JSON-string fields back to their schema shapes, at any depth. */
export function decodeWireModel(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(decodeWireModel);
  if (!node || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const wireKey = Object.entries(WIRE_STRINGIFIED).find(([, w]) => w === k)?.[0];
    if (wireKey && typeof v === 'string') {
      try { out[wireKey] = JSON.parse(v); } catch { out[wireKey] = v; /* leave — validation reports it */ }
      continue;
    }
    out[k] = decodeWireModel(v);
  }
  return out;
}

/**
 * Stable system prefix — frozen bytes so prompt caching hits across every call.
 * Volatile content (the user prompt) goes in the message, never here.
 */
const modelSystem = (contract: string, privacy: 'public' | 'private'): string => `You are Archwoven's architecture design model. Emit ONLY a valid Archwoven system model JSON (schemaVersion "1").

Hard rules:
- revision is always 1 for a new model; parentId omitted.
- privacy is exactly ${JSON.stringify(privacy === 'private' ? { classification: 'private', boundary: 'local-only' } : { classification: 'public', boundary: 'external-allowed' })} — no other keys, no other values (the server re-stamps it from the deployment mode).
- ids are stable, lowercase, dotted: svc.orders, entity.user, e.api-orders.
- every node and edge carries provenance: user-specified (stated by the user), source-supported (seen in code), inferred (reasonable deduction), proposed (your recommendation, not the user's).
- never invent business-critical components as user-specified; when unsure use inferred or proposed.
- sequence views: participants + messages, seq consecutive from 1, kind call|return|async, fragments alt|loop|opt with covers listing message seqs.
- ER views: entity nodes with fields (name, type, key pk|fk|uk) and relation edges with cardinality 1:1|1:N|N:M. N:M is one relation edge, not mirrored/duplicate edges. If cardinality is unknown, use null and an openQuestions entry with blockedBy set to that edge id.
- every view lists its member node ids and edge ids; every referenced id exists.
- labels short (<= 40 chars); no HTML, no markdown, no comments in the JSON.
- Optional semantic fields — emit when they genuinely hold: semanticChecks (allowedRoots/allowedTerminals = nodes legitimately without incoming/outgoing edges, requiredEdges/requiredPaths = bindings and paths the architecture really has), view mainPath (ordered node ids along real forward edges), edge role (main|branch|async|return|error), boundaries (wraps node ids, a node sits in at most one), guidedViews (<= 5 chapters, focus = node ids, note explains the chapter). Never emit a check your own output would fail.

${contract}`;

export const STABLE_SYSTEM = modelSystem(NATIVE_MODEL_JSON_CONTRACT, 'public');
export const LOCAL_MODEL_SYSTEM = modelSystem(NATIVE_MODEL_JSON_CONTRACT, 'private');

export function usageFrom(usage: RawUsage | UsageLedger, effort: Effort, latencyMs: number, repairs: number, modelId: HostedModelId = MODEL): TaskUsage {
  return {
    model: modelId,
    provider: 'anthropic',
    effort,
    attempts: 'attempts' in usage ? usage.attempts : [],
    transportRetries: 'attempts' in usage ? usage.attempts.filter(part => part.kind === 'retry').length : 0,
    usageComplete: 'attempts' in usage ? usage.attempts.every(part => part.usageComplete) : true,
    inputTokens: usage.input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    latencyMs,
    repairs: 'attempts' in usage ? usage.attempts.filter(part => part.kind === 'repair').length : repairs,
  };
}

const textOf = (content: { type: string; text?: string }[]) =>
  content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');

/**
 * Generate (or repair) a system model for one view.
 * The prompt carries the schema; hosted calls do not send an API grammar.
 * Shape and graph validation run server-side and validator errors are fed back
 * for up to MAX_REPAIRS rounds. We use .create() + our own parse so that a
 * truncated or invalid response still yields the raw text we can quote back to
 * the model — .parse() throws and discards it, so repairs never converge.
 */
type GenerateOptions = { client?: StructuredClient; effort?: Effort; signal?: AbortSignal };
export function generateModel(prompt: string, view: ViewType, opts?: GenerateOptions & { allowClarification?: false }): Promise<GenerateOutcome>;
export function generateModel(prompt: string, view: ViewType, opts: GenerateOptions & { allowClarification: boolean }): Promise<DescriptionOutcome>;
export async function generateModel(
  prompt: string,
  view: ViewType,
  opts: GenerateOptions & { allowClarification?: boolean } = {},
): Promise<DescriptionOutcome> {
  const effort: Effort = opts.effort ?? 'medium';
  const modelId = !opts.client && fakeMode() ? MODEL : configuredHostedModel();
  if (opts.signal?.aborted) return { ok: false, errors: ['Generation cancelled.'], usage: usageFrom({}, effort, 0, 0, modelId) };
  if (!opts.client && fakeMode()) return { ok: true, model: structuredClone(validFullModelExtended), usage: fakeUsage(effort) };
  const client: StructuredClient =
    hostedClient(opts.client);

  const t0 = Date.now();
  const messages: unknown[] = [{ role: 'user', content: `View: ${view}\n\n${prompt}` }];
  const system = [{ type: 'text', text: STABLE_SYSTEM + (opts.allowClarification ? CLARIFICATION_SYSTEM : ''), cache_control: { type: 'ephemeral' } }];

  // Per-request gate: exact token count before send. Fail closed — an
  // uncounted send is exactly the oversized context the gate exists to stop.
  try {
    const counted = await client.messages.countTokens({ model: modelId, system, messages }, { signal: opts.signal });
    if (counted.input_tokens > CONTEXT_TOKEN_LIMIT) {
      return { ok: false, errors: ['assembled context exceeds the 25k token limit — scope the description down to one system or flow'], usage: usageFrom({}, effort, Date.now() - t0, 0, modelId) };
    }
  } catch (e) {
    return { ok: false, errors: [countFailureMessage(e)], usage: usageFrom({}, effort, Date.now() - t0, 0, modelId) };
  }

  let lastErrors: string[] = [];
  let repairs = 0;
  // Billed usage accumulates across every attempt — repairs cost real money and
  // the stop-loss and evaluation meter must see it, not just the last attempt.
  const billed = newUsageLedger();

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    if (opts.signal?.aborted) { lastErrors = ['Generation cancelled.']; break; }
    startAttempt(billed, repairs);
    let response: Awaited<ReturnType<StructuredClient['beta']['messages']['create']>>;
    try {
      // No structured-output grammar on hosted generate: the full
      // SystemModelSchema exceeds the API's grammar limits (verified live:
      // >16 unions, then "compiled grammar is too large"). Shape is enforced
      // by the repair loop + validateModel server-side; the prompt carries
      // the grammar (STABLE_SYSTEM).
      response = await client.beta.messages.create({
        model: modelId,
        max_tokens: HOSTED_REQUESTS.generate.maxTokens,
        system,
        messages,
      }, { signal: opts.signal });
    } catch (e) {
      lastErrors = [`request failed: ${e instanceof Error ? e.message : String(e)}`];
      if (providerRequestStopped(e, billed) || opts.signal?.aborted) break;
      continue; // transient/transport failure — retry within budget
    }
    captureUsage(billed, response.usage);

    const text = textOf(response.content);
    let parsed: unknown;
    try {
      parsed = decodeWireModel(JSON.parse(unfenced(text)));
    } catch (e) {
      lastErrors = [`output was not valid JSON (${response.stop_reason ?? 'unknown'}): ${e instanceof Error ? e.message : String(e)}`];
      if (attempt < MAX_REPAIRS) {
        repairs++;
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: `Your previous response was not complete valid JSON${response.stop_reason === 'max_tokens' ? ' (it was truncated)' : ''} — emit the complete valid Archwoven system model JSON only, no markdown, no commentary.` });
      }
      continue;
    }

    const decision = opts.allowClarification ? ClarificationSchema.safeParse(parsed) : null;
    if (decision?.success) return { ok: true, questions: decision.data.clarificationQuestions, usage: usageFrom(billed, effort, Date.now() - t0, repairs, modelId) };
    const result = validateModel(parsed);
    lastErrors = result.ok ? generatedViewErrors(result.model, view) : result.errors;
    if (result.ok && !lastErrors.length) return { ok: true, model: result.model, usage: usageFrom(billed, effort, Date.now() - t0, repairs, modelId) };
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `The model JSON failed validation with these errors — fix them and emit the complete corrected JSON only:\n- ${lastErrors.join('\n- ')}`,
      });
    }
  }

  return { ok: false, errors: lastErrors, usage: usageFrom(billed, effort, Date.now() - t0, repairs, modelId) };
}
