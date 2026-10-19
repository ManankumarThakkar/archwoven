import { createHash, randomUUID } from 'node:crypto';
import { evaluationHoldNanos } from '@archwoven/model';
import { openSpendingLedger, type ReserveResult, type SpendingLedger } from '@archwoven/jobs';
import { makeAnthropic, resolveApiKey, ProviderAccountingError, ProviderRequestNotSentError, type StructuredClient } from '@archwoven/llm';
import { PINNED_OPTIONS, reviewedRequest, usageCost } from './evaluation-budget';

/** Who a paid attempt is charged to: the server-issued visitor cookie and the platform-verified network address. */
export interface Spender { visitor: string; network: string | null }

/** count_tokens is an estimate, so the hold covers it with margin. */
export const inputCeiling = (counted: number) => Math.ceil(counted * 1.1) + 512;

const STILL_FREE = 'You can still view, edit and download your diagrams.';
/** Editing needs the same storage as the ledger, so an outage leaves only what the browser holds. */
const STILL_LOCAL = 'You can still view and download your diagrams.';
const nextMonth = (now: number) => new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1))
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** One message per refusal. The refused attempt was not sent; earlier attempts in the same task may have been. */
export function refusalCopy(reason: Exclude<ReserveResult, { ok: true }>['reason'] | 'unavailable', now = Date.now()): string {
  const message = {
    'visitor-exhausted': "You've reached today's AI limit for this browser. It resets at 00:00 UTC.",
    'network-exhausted': "Today's AI limit for your network is used up. It resets at 00:00 UTC.",
    'day-exhausted': "Today's free AI budget is used up. It resets at 00:00 UTC.",
    'month-exhausted': `This month's free AI budget is used up. It resets on ${nextMonth(now)}.`,
    'year-exhausted': "The free AI budget for this year is used up.",
    'ledger-expired': "The free AI budget for this year is used up.",
    paused: 'AI generation is paused while spending is reviewed.',
  }[reason as string] ?? 'AI generation is temporarily unavailable. No further AI request was sent.';
  return `${message} ${reason === 'unavailable' ? STILL_LOCAL : STILL_FREE}`;
}

const notSent = (message: string) => new ProviderRequestNotSentError(message);
const ACCOUNTING = 'Spending accounting failed after sending. Its reservation is retained; further automatic retries were stopped.';

/** Every hosted paid attempt crosses this boundary: measure, reserve, send, settle.
 * Unknown usage and crashes keep the whole hold. */
export function withSpendingLimits(client: StructuredClient, ledger: SpendingLedger, who: Spender): StructuredClient {
  return {
    messages: { countTokens: (params, options) => client.messages.countTokens(params, options) },
    beta: { messages: { create: async (params, options) => {
      const quote = reviewedRequest(params);
      const request = params as { system?: unknown; messages: unknown[]; output_config?: { format?: { schema?: unknown } } };
      const cancelled = () => notSent('Cancelled before sending.');
      if (options?.signal?.aborted) throw cancelled();
      let counted: number;
      try { counted = (await client.messages.countTokens({ model: quote.model, system: request.system, messages: request.messages }, options)).input_tokens; }
      catch {
        if (options?.signal?.aborted) throw cancelled();
        throw notSent(`AI generation is temporarily unavailable: the request could not be measured. No further AI request was sent. ${STILL_FREE}`);
      }
      // An output schema adds context that count_tokens is not asked about; its byte length bounds it.
      const schema = request.output_config?.format?.schema;
      const context = inputCeiling(counted + (schema ? Buffer.byteLength(JSON.stringify(schema)) : 0));
      const id = randomUUID();
      let admitted: ReserveResult;
      try { admitted = await ledger.reserve(id, evaluationHoldNanos(quote.model, quote.maxTokens, context), who, { model: quote.model, basis: quote.basis }); }
      catch {
        // The reservation may have been recorded before the connection failed; release it, since nothing is sent.
        await ledger.settle(id, 0).catch(() => undefined);
        throw notSent(refusalCopy('unavailable'));
      }
      if (!admitted.ok) throw notSent(refusalCopy(admitted.reason));
      if (options?.signal?.aborted) { await ledger.settle(id, 0).catch(() => undefined); throw cancelled(); }
      let response: Awaited<ReturnType<StructuredClient['beta']['messages']['create']>>;
      try { response = await client.beta.messages.create({ ...(params as object), ...PINNED_OPTIONS }, options); }
      catch (error) {
        try { await ledger.settle(id, null); } catch { throw new ProviderAccountingError(ACCOUNTING); }
        throw error;
      }
      try { await ledger.settle(id, usageCost(quote.model, response.usage)?.nanos ?? null); }
      catch { throw new ProviderAccountingError(ACCOUNTING); }
      return response;
    } } },
  };
}

const refusing = (message: string): StructuredClient => ({
  messages: { countTokens: async () => { throw notSent(message); } },
  beta: { messages: { create: async () => { throw notSent(message); } } },
});
const NOT_CONFIGURED = `AI generation is unavailable: spending limits are not configured. ${STILL_FREE}`;

let ledgers: { key: string; ledger: SpendingLedger } | undefined;
/** The hosted client for one request. Development servers without a ledger keep
 * their existing behaviour; on Vercel a missing or invalid ledger refuses paid work. */
export function spendingClient(who: Spender | undefined): StructuredClient | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim(), token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim(), prefix = process.env.ARCHWOVEN_REDIS_PREFIX?.trim();
  const onVercel = process.env.VERCEL === '1';
  if (!url && !token && !prefix) return onVercel ? refusing(NOT_CONFIGURED) : undefined;
  const loopback = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url ?? '');
  if (!url || !token || !prefix || !(/^https:\/\/[a-z0-9.-]+\.upstash\.io\/?$/.test(url) || (loopback && !onVercel))) return refusing(NOT_CONFIGURED);
  // On Vercel every request carries a platform-set address; without one the network cap cannot apply.
  // Storage is fine here: only paid work needs the verified address, so editing still works.
  if (!who?.visitor) return refusing(refusalCopy('ledger-missing'));
  if (onVercel && !who.network) return refusing(`AI generation needs a verified network address, which this request did not include. No further AI request was sent. ${STILL_FREE}`);
  const key = `${url}|${prefix}|${createHash('sha256').update(token).digest('hex')}`;
  try { if (ledgers?.key !== key) ledgers = { key, ledger: openSpendingLedger({ url, token, prefix }) }; }
  catch { return refusing(NOT_CONFIGURED); }
  return withSpendingLimits(makeAnthropic(resolveApiKey()) as unknown as StructuredClient, ledgers.ledger, who);
}
