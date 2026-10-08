import { z } from 'zod';
import { SystemModelSchema, validateModel, type ViewType } from '@archwoven/model';
import { STABLE_SYSTEM, MAX_REPAIRS, type GenerateOutcome, type TaskUsage } from './client';

export const LOCAL_MODEL = 'gpt-oss:120b';
export const MAX_OUTPUT_TOKENS = 8000; // runaway-generation guard, matches hosted max_tokens

export interface LocalTaskUsage extends TaskUsage {
  ttftMs: number;
}

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Local generation via Ollama /api/chat with schema-constrained decoding
 * (`format: <json-schema>`) — the private-repo path (SPEC: private content
 * never leaves the machine). Same contract as client.ts generateModel:
 * streamed response, graph validation, repair loop feeding named errors back.
 */
export async function generateModelLocal(
  prompt: string,
  view: ViewType,
  opts: { fetchImpl?: typeof fetch; model?: string; baseUrl?: string; think?: boolean } = {},
): Promise<GenerateOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  const model = opts.model ?? LOCAL_MODEL;
  const baseUrl = opts.baseUrl ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const format = z.toJSONSchema(SystemModelSchema);

  const t0 = Date.now();
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: STABLE_SYSTEM },
    { role: 'user', content: `View: ${view}\n\n${prompt}` },
  ];

  let lastErrors: string[] = [];
  let repairs = 0;
  let usage: LocalTaskUsage = { model, effort: 'medium', inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, latencyMs: 0, repairs: 0, ttftMs: 0 };

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const res = await doFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true, think: opts.think ?? false, num_predict: MAX_OUTPUT_TOKENS, keep_alive: '10m', format, messages }),
    });
    if (!res.ok || !res.body) {
      lastErrors = [`ollama http ${res.status}`];
      break;
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
    pending += decoder.decode(); // flush multibyte tail
    if (pending) handleLine(pending);
    if (streamError) {
      lastErrors = [streamError];
      break;
    }

    usage = {
      model,
      effort: 'medium',
      inputTokens: final.prompt_eval_count ?? 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: final.eval_count ?? 0,
      latencyMs: Date.now() - t0,
      repairs,
      ttftMs,
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastErrors = ['output was not valid JSON (truncated?)'];
      parsed = undefined;
    }
    if (parsed !== undefined) {
      const result = validateModel(parsed);
      if (result.ok) return { ok: true, model: result.model, usage };
      lastErrors = result.errors;
    }
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `The model JSON failed validation with these errors — fix them and emit the complete corrected JSON only:\n- ${lastErrors.join('\n- ')}`,
      });
    }
  }

  return { ok: false, errors: lastErrors, usage };
}
