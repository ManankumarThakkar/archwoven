import type { AttemptUsage } from '@archwoven/model';
import type { RawUsage } from './client';

export interface UsageLedger extends Required<RawUsage> { attempts: AttemptUsage[] }
export const newUsageLedger = (): UsageLedger => ({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, attempts: [] });

/** A prepared repair is counted only when submitted to the adapter. */
export function startAttempt(ledger: UsageLedger, preparedRepairs: number): void {
  const repairsSent = ledger.attempts.filter(part => part.kind === 'repair').length;
  ledger.attempts.push({ kind: !ledger.attempts.length ? 'initial' : preparedRepairs > repairsSent ? 'repair' : 'retry', inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, usageComplete: false });
}
/** Keep why the current attempt failed, so a later retry or refusal cannot hide the cause. */
export function recordAttemptError(ledger: UsageLedger, error: unknown, label?: string): void {
  const part = ledger.attempts.at(-1);
  if (!part) return;
  const e = error as { status?: unknown; message?: unknown; error?: { error?: { type?: unknown; message?: unknown } } };
  const message = String(e?.message ?? error);
  const text = label ? `${label}: ${message}`
    : e?.error?.error && typeof e.error.error.message === 'string' ? `${e.status} ${e.error.error.type}: ${e.error.error.message}`
    // The SDK's message already starts with the status when the body was not JSON.
    : typeof e?.status === 'number' ? (message.startsWith(String(e.status)) ? message : `${e.status} ${message}`)
    : `no response: ${message}`;
  part.error = text.slice(0, 300);
}
export const reportedTokens = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const tokens = (value: unknown): number => reportedTokens(value) ? value : 0;

export function captureUsage(ledger: UsageLedger, raw: RawUsage): void {
  const part = ledger.attempts.at(-1)!;
  Object.assign(part, { inputTokens: tokens(raw.input_tokens), cacheWriteTokens: tokens(raw.cache_creation_input_tokens), cacheReadTokens: tokens(raw.cache_read_input_tokens), outputTokens: tokens(raw.output_tokens), usageComplete: reportedTokens(raw.input_tokens) && reportedTokens(raw.output_tokens) && (raw.cache_creation_input_tokens === undefined || reportedTokens(raw.cache_creation_input_tokens)) && (raw.cache_read_input_tokens === undefined || reportedTokens(raw.cache_read_input_tokens)) });
  ledger.input_tokens += part.inputTokens; ledger.cache_creation_input_tokens += part.cacheWriteTokens;
  ledger.cache_read_input_tokens += part.cacheReadTokens; ledger.output_tokens += part.outputTokens;
}
