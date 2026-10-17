import { ClarificationSchema, CLARIFICATION_SYSTEM, CLARIFICATION_SCHEMA, type DescriptionOutcome } from './clarification';
import { generatedViewErrors } from './generated-view';
import { z } from 'zod';
import type { Fragment } from '@archwoven/extract';
import {
  EditOpSchema, applyEditOps, validateModel,
  type EditOp, type SystemModel, type ViewType,
} from '@archwoven/model';
import { LOCAL_MODEL_SYSTEM, NATIVE_MODEL_JSON_SCHEMA, MAX_REPAIRS, type GenerateOutcome, type TaskUsage } from './client';
import { LOCAL_REPO_SYSTEM, fenceEscape, pinEvidence, sourceEvidenceErrors, preserveSourceGaps } from './repo';
import { LOCAL_REFINEMENT_SYSTEM } from './refine';
import type { RefineOutcome } from './refine';
import { buildSourceModel, SOURCE_PRESENTATION_SCHEMA, SOURCE_PRESENTATION_SYSTEM } from './source-presentation';

/** Overridable via OLLAMA_MODEL (.env.local); 20b (~13 GB) keeps a 16 GB-light
 * footprint vs 120b's 65 GB resident — same family, same constrained-decoding path. */
export const LOCAL_MODEL = process.env.OLLAMA_MODEL ?? 'gpt-oss:20b';
/**
 * Local runaway guard. NOT the hosted 8192 lock (§15 is scoped "hosted mode"; its
 * table says local/private = no quotas, quota code compiled out) — gpt-oss spends
 * thousands of tokens on hidden reasoning
 * that `think:false` does not suppress on Ollama, so 8000 truncated the JSON answer.
 * 16000 leaves headroom for reasoning + a full model; still bounded, never unbounded.
 */
export const MAX_OUTPUT_TOKENS = 16000;

export interface LocalInferenceOptions {
  fetchImpl?: typeof fetch;
  model?: string;
  baseUrl?: string;
  think?: boolean;
  effort?: TaskUsage['effort'];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function taskSignal(opts: LocalInferenceOptions): AbortSignal {
  const raw = opts.timeoutMs ?? Number(process.env.ARCHWOVEN_LOCAL_TIMEOUT_MS ?? 180000);
  const ms = Number.isFinite(raw) && raw > 0 ? Math.min(600000, Math.ceil(raw)) : 180000;
  return AbortSignal.any([...(opts.signal ? [opts.signal] : []), AbortSignal.timeout(ms)]);
}

const abortedMessage = (signal: AbortSignal) => signal.reason?.name === 'TimeoutError'
  ? 'Local generation timed out — try a smaller description or repository scope.'
  : 'Generation cancelled.';

const addLocalUsage = (total: LocalTaskUsage, part: LocalTaskUsage, repairs: number): LocalTaskUsage => ({
  ...part, repairs,
  inputTokens: total.inputTokens + part.inputTokens,
  outputTokens: total.outputTokens + part.outputTokens,
  cacheWriteTokens: total.cacheWriteTokens + part.cacheWriteTokens,
  cacheReadTokens: total.cacheReadTokens + part.cacheReadTokens,
  latencyMs: total.latencyMs + part.latencyMs,
  ttftMs: total.ttftMs || part.ttftMs,
});

export interface LocalTaskUsage extends TaskUsage {
  ttftMs: number;
}

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaResult {
  text: string;
  usage: LocalTaskUsage;
  error?: string;
}

const zeroUsage = (model: string, ttftMs = 0): LocalTaskUsage => ({ model, effort: 'medium', inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, latencyMs: 0, repairs: 0, ttftMs });

/**
 * One streamed Ollama /api/chat call with schema-constrained decoding
 * (`format: <json-schema>`). Never throws: transport and mid-stream errors
 * come back as `error` so every caller's failure path stays local-only —
 * there is no fallback client to fall back to.
 */
export async function ollamaChat(
  messages: { role: string; content: string }[],
  format: unknown,
  opts: LocalInferenceOptions = {},
): Promise<OllamaResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const model = opts.model ?? LOCAL_MODEL;
  const baseUrl = opts.baseUrl ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const effort = opts.effort ?? 'medium';
  const signal = taskSignal(opts);
  if (signal.aborted) return { text: '', usage: zeroUsage(model), error: abortedMessage(signal) };

  const t0 = Date.now();
  let res: Response;
  try {
    res = await doFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true, think: opts.think ?? false, options: { num_predict: Math.min(MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS))) }, keep_alive: '10m', format, messages }),
    });
  } catch (e) {
    return { text: '', usage: zeroUsage(model), error: signal.aborted ? abortedMessage(signal) : `ollama request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok || !res.body) {
    return { text: '', usage: zeroUsage(model), error: `ollama http ${res.status}` };
  }

  let text = '';
  let ttftMs = 0;
  let final: OllamaChunk = {};
  let streamError: string | null = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let chunk: OllamaChunk & { error?: string };
    try {
      chunk = JSON.parse(line) as OllamaChunk & { error?: string };
    } catch {
      return; // tolerate stream noise rather than losing the run
    }
    if (typeof chunk.error === 'string') {
      streamError = chunk.error;
      return;
    }
    text += chunk.message?.content ?? '';
    if (chunk.done) final = chunk;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (ttftMs === 0) ttftMs = Date.now() - t0;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
      if (streamError) break;
    }
    pending += decoder.decode();
    if (pending) handleLine(pending);
  } catch (e) {
    streamError = signal.aborted ? abortedMessage(signal) : `ollama stream failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (streamError || signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return {
    text,
    ...(streamError || signal.aborted ? { error: streamError ?? abortedMessage(signal) } : {}),
    usage: {
      model,
      effort,
      inputTokens: final.prompt_eval_count ?? 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: final.eval_count ?? 0,
      latencyMs: Date.now() - t0,
      repairs: 0,
      ttftMs,
    },
  };
}

/**
 * Generate a full SystemModel locally (§8 private flow): streamed, schema-
 * constrained, validated, repaired within the same budget as the hosted path.
 */
export function generateModelLocal(prompt: string, view: ViewType, opts?: LocalInferenceOptions & { allowClarification?: false }): Promise<GenerateOutcome>;
export function generateModelLocal(prompt: string, view: ViewType, opts: LocalInferenceOptions & { allowClarification: boolean }): Promise<DescriptionOutcome>;
export async function generateModelLocal(
  prompt: string,
  view: ViewType,
  opts: LocalInferenceOptions & { allowClarification?: boolean } = {},
): Promise<DescriptionOutcome> {
  opts = { ...opts, signal: taskSignal(opts) };
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: (opts.allowClarification ? CLARIFICATION_SYSTEM + '\nThe system-model contract below applies only when the requirements are compatible and no clarification is necessary.\n' : '') + LOCAL_MODEL_SYSTEM + (opts.allowClarification ? CLARIFICATION_SYSTEM : '') },
    { role: 'user', content: `View: ${view}\n\n${prompt}` },
  ];
  const format = structuredClone(NATIVE_MODEL_JSON_SCHEMA);
  if (view === 'er') {
    // Make omission impossible in the native grammar; null remains available
    // for genuinely unknown cardinality, which the content gate discloses.
    const edgeList = format.properties?.edges;
    const edge = edgeList && typeof edgeList === 'object' ? edgeList.items : undefined;
    if (edge && !Array.isArray(edge) && typeof edge === 'object') edge.required = [...new Set([...(edge.required ?? []), 'cardinality'])];
  }

  let lastErrors: string[] = [];
  let repairs = 0;
  let usage = zeroUsage(opts.model ?? LOCAL_MODEL);

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const r = await ollamaChat(messages, opts.allowClarification ? { anyOf: [CLARIFICATION_SCHEMA, format] } : format, opts);
    usage = addLocalUsage(usage, r.usage, repairs);
    if (r.error) {
      lastErrors = [r.error];
      break; // transport/stream failure — never retry into a different host
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.text);
    } catch {
      lastErrors = ['output was not valid JSON (truncated?)'];
      parsed = undefined;
    }
    if (parsed !== undefined) {
      const decision = opts.allowClarification ? ClarificationSchema.safeParse(parsed) : null;
      if (decision?.success) return { ok: true, questions: decision.data.clarificationQuestions, usage };
      const result = validateModel(parsed);
      lastErrors = result.ok ? generatedViewErrors(result.model, view) : result.errors;
      if (result.ok && !lastErrors.length) return { ok: true, model: result.model, usage };
    }
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: r.text });
      messages.push({
        role: 'user',
        content: `The model JSON failed validation with these errors — fix them and emit the complete corrected JSON only:\n- ${lastErrors.join('\n- ')}`,
      });
    }
  }

  return { ok: false, errors: lastErrors, usage };
}

const opsSchema = z.toJSONSchema(z.array(EditOpSchema));

/**
 * Refinement as bounded EditOps, locally (§8): same apply-then-accept
 * semantics as refine.ts, same repair budget, ollama only.
 */
export async function generateRefinementLocal(
  instruction: string,
  model: SystemModel,
  view: ViewType,
  opts: LocalInferenceOptions = {},
): Promise<RefineOutcome> {
  opts = { ...opts, signal: taskSignal(opts) };
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: LOCAL_REFINEMENT_SYSTEM },
    { role: 'user', content: `View: ${view}\n\nCurrent model JSON (revision ${model.revision}):\n${JSON.stringify(model)}\n\nInstruction: ${instruction}` },
  ];

  let lastErrors: string[] = [];
  let repairs = 0;
  let usage = zeroUsage(opts.model ?? LOCAL_MODEL);

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const r = await ollamaChat(messages, opsSchema, opts);
    usage = addLocalUsage(usage, r.usage, repairs);
    if (r.error) {
      lastErrors = [r.error];
      break;
    }
    let ops: unknown;
    try {
      ops = JSON.parse(r.text);
    } catch (e) {
      lastErrors = [`ops were not valid JSON: ${e instanceof Error ? e.message : String(e)}`];
      ops = undefined;
    }
    if (ops !== undefined) {
      const checked = z.array(EditOpSchema).safeParse(ops);
      if (!checked.success) {
        lastErrors = checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      } else {
        const badBase = checked.data.filter((o) => o.baseRevision !== model.revision);
        if (badBase.length === 0) {
          const applied = applyEditOps(model, checked.data);
          if (applied.ok) return { ok: true, ops: checked.data, usage };
          lastErrors = applied.errors;
        } else {
          lastErrors = [`baseRevision must be ${model.revision}`];
        }
      }
    }
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: r.text });
      messages.push({ role: 'user', content: `These EditOps failed validation — fix them and emit the complete corrected array only:\n- ${lastErrors.join('\n- ')}` });
    }
  }

  return { ok: false, errors: lastErrors, usage };
}

/**
 * Repo→SystemModel assembly, locally (§8): the untrusted fragment stays on
 * this machine — same fence, same pinning, ollama only.
 */
export async function assembleRepoModelLocal(
  fragment: Fragment,
  meta: { owner: string; repo: string; sha: string; framework: string },
  opts: LocalInferenceOptions = {},
): Promise<GenerateOutcome> {
  opts = { ...opts, signal: taskSignal(opts) };
  const repoFull = `${meta.owner}/${meta.repo}`;
  const generic = !!fragment.sourceContext;
  const context = fenceEscape(JSON.stringify({ framework: meta.framework, repo: repoFull, sha: meta.sha, fragment }));
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: generic ? SOURCE_PRESENTATION_SYSTEM : LOCAL_REPO_SYSTEM },
    { role: 'user', content: `Repository: ${repoFull} @ ${meta.sha}\nFramework: ${meta.framework}\n\n<repo-data>\n${context}\n</repo-data>` },
  ];

  let lastErrors: string[] = [];
  let repairs = 0;
  let usage = zeroUsage(opts.model ?? LOCAL_MODEL);

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const r = await ollamaChat(messages, generic ? SOURCE_PRESENTATION_SCHEMA : NATIVE_MODEL_JSON_SCHEMA, { ...opts, maxOutputTokens: generic ? 4096 : MAX_OUTPUT_TOKENS });
    usage = addLocalUsage(usage, r.usage, repairs);
    if (r.error) {
      lastErrors = [r.error];
      break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.text);
    } catch (e) {
      lastErrors = [`output was not valid JSON: ${e instanceof Error ? e.message : String(e)}`];
      parsed = undefined;
    }
    if (parsed !== undefined) {
      const result = generic ? buildSourceModel(fragment, parsed, { classification: 'private', boundary: 'local-only' }) : validateModel(parsed);
      if (result.ok) {
        lastErrors = sourceEvidenceErrors(fragment, result.model);
        if (!lastErrors.length) {
          preserveSourceGaps(fragment, result.model);
          pinEvidence(result.model, repoFull, meta.sha); // pinned server-side, never model-supplied
          return { ok: true, model: result.model, usage };
        }
      } else {
        lastErrors = result.errors;
      }
    }
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: r.text });
      messages.push({ role: 'user', content: `The ${generic ? 'source presentation' : 'model'} JSON failed validation with these errors — fix them and emit the complete corrected JSON only:\n- ${lastErrors.join('\n- ')}` });
    }
  }

  return { ok: false, errors: lastErrors, usage };
}
