import { createHmac } from 'node:crypto';

/**
 * Hosted spending ledger in Redis (Upstash REST). Every paid provider attempt
 * reserves its worst-case cost before dispatch and settles with reported usage:
 *
 *   settled + held + next hold <= cap, for every applicable scope
 *
 * Scopes: the annual window, the UTC calendar month, the UTC day for everyone
 * together, the visitor's UTC day and the network's UTC day. Amounts are integer nano-USD. Reservation and
 * settlement are single atomic scripts, idempotent by attempt id. An attempt
 * records the exact scope keys it reserved against, so settlement after a
 * month or year boundary lands in the period that admitted it. Ledger,
 * period and attempt records never expire; only per-day totals do, after
 * 35 days, as they only limit that day. Ledgers created before the daily
 * total existed have no daily cap until one is set.
 */

export type SpendScope = 'year' | 'month' | 'day' | 'visitor' | 'network';
export type ReserveResult =
  | { ok: true }
  | { ok: false; reason: `${SpendScope}-exhausted` | 'paused' | 'ledger-missing' | 'ledger-expired' | 'duplicate' };
export type SettleResult = 'settled' | 'settled-over-hold' | 'unknown' | 'missing' | `already-${'settled' | 'unknown'}`;
export interface SpendingCaps { annualNanos: number; monthNanos: number; dayNanos: number; visitorDayNanos: number; networkDayNanos: number }
export interface SpendingStatus {
  paused: boolean; pausedReason: string | null; start: number; end: number; caps: Omit<SpendingCaps, 'dayNanos'> & { dayNanos: number | null };
  year: { settledNanos: number; heldNanos: number }; month: { id: string; settledNanos: number; heldNanos: number }; day: { id: string; settledNanos: number; heldNanos: number };
  unknownAttempts: number;
}

const RESERVE = `
local state = redis.call('HGET', KEYS[2], 'state')
if state then return {'duplicate'} end
local c = redis.call('HMGET', KEYS[1], 'version', 'start', 'end', 'annual', 'month', 'visitor', 'network', 'paused', 'day')
if not c[1] then return {'ledger-missing'} end
if c[8] == '1' then return {'paused'} end
local now, amount, p = tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[1]
if now < tonumber(c[2]) or now >= tonumber(c[3]) then return {'ledger-expired'} end
local scopes = {{'year', p .. 'totals:year:' .. c[2], tonumber(c[4])}, {'month', p .. 'totals:month:' .. ARGV[8], tonumber(c[5])}}
if c[9] then table.insert(scopes, {'day', p .. 'totals:day:' .. ARGV[9], tonumber(c[9])}) end
if ARGV[4] ~= '' then table.insert(scopes, {'visitor', p .. 'totals:visitor:' .. ARGV[9] .. ':' .. ARGV[4], tonumber(c[6])}) end
if ARGV[5] ~= '' then table.insert(scopes, {'network', p .. 'totals:network:' .. ARGV[9] .. ':' .. ARGV[5], tonumber(c[7])}) end
for _, s in ipairs(scopes) do
  local t = redis.call('HMGET', s[2], 'settled', 'held')
  if (tonumber(t[1]) or 0) + (tonumber(t[2]) or 0) + amount > s[3] then return {s[1] .. '-exhausted'} end
end
local keys = {}
for _, s in ipairs(scopes) do
  redis.call('HINCRBY', s[2], 'held', amount)
  if s[1] == 'day' or s[1] == 'visitor' or s[1] == 'network' then redis.call('EXPIRE', s[2], 3024000) end
  table.insert(keys, s[2])
end
redis.call('HSET', KEYS[2], 'state', 'held', 'reserved', amount, 'model', ARGV[6], 'basis', ARGV[7], 'scopes', table.concat(keys, ' '), 'reservedAt', ARGV[2])
return {'ok'}`;

const SETTLE = `
local a = redis.call('HMGET', KEYS[1], 'state', 'reserved', 'scopes')
if not a[1] then return 'missing' end
if a[1] ~= 'held' then return 'already-' .. a[1] end
if ARGV[1] == '' then
  redis.call('HSET', KEYS[1], 'state', 'unknown')
  redis.call('SADD', KEYS[3], KEYS[1])
  return 'unknown'
end
local charged, reserved = tonumber(ARGV[1]), tonumber(a[2])
for key in string.gmatch(a[3], '%S+') do
  if redis.call('EXISTS', key) == 1 then
    redis.call('HINCRBY', key, 'held', -reserved)
    redis.call('HINCRBY', key, 'settled', charged)
  end
end
redis.call('HSET', KEYS[1], 'state', 'settled', 'charged', charged)
if charged > reserved then
  redis.call('HSET', KEYS[2], 'paused', '1', 'pausedReason', 'A charge exceeded its hold.')
  return 'settled-over-hold'
end
return 'settled'`;

const INIT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 'exists' end
redis.call('HSET', KEYS[1], 'version', 1, 'start', ARGV[1], 'end', ARGV[2], 'annual', ARGV[3], 'month', ARGV[4], 'visitor', ARGV[5], 'network', ARGV[6], 'day', ARGV[7], 'paused', 0)
return 'initialized'`;

// Caps apply to holds made from now on; settled and held totals are kept as they are.
const SET_CAPS = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'ledger-missing' end
redis.call('HSET', KEYS[1], 'annual', ARGV[1], 'month', ARGV[2], 'day', ARGV[3], 'visitor', ARGV[4], 'network', ARGV[5], 'capsChangedAt', ARGV[6])
return 'updated'`;

const STATUS = `
local c = redis.call('HMGET', KEYS[1], 'version', 'start', 'end', 'annual', 'month', 'visitor', 'network', 'paused', 'pausedReason', 'day')
if not c[1] then return {} end
local y = redis.call('HMGET', ARGV[1] .. 'totals:year:' .. c[2], 'settled', 'held')
local m = redis.call('HMGET', ARGV[1] .. 'totals:month:' .. ARGV[2], 'settled', 'held')
local d = redis.call('HMGET', ARGV[1] .. 'totals:day:' .. ARGV[3], 'settled', 'held')
return {c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9] or '', y[1] or '0', y[2] or '0', m[1] or '0', m[2] or '0', redis.call('SCARD', KEYS[2]), c[10] or '', d[1] or '0', d[2] or '0'}`;

const RESOLVE = `
local a = redis.call('HMGET', KEYS[1], 'state', 'reserved', 'scopes')
if a[1] ~= 'unknown' then return 'not-unknown' end
local charged, reserved = tonumber(ARGV[1]), tonumber(a[2])
if charged > reserved then return 'over-hold' end
for key in string.gmatch(a[3], '%S+') do
  if redis.call('EXISTS', key) == 1 then
    redis.call('HINCRBY', key, 'held', -reserved)
    redis.call('HINCRBY', key, 'settled', charged)
  end
end
redis.call('HSET', KEYS[1], 'state', 'settled', 'charged', charged, 'evidence', ARGV[2], 'resolvedAt', ARGV[3])
redis.call('SREM', KEYS[2], KEYS[1])
return 'resolved'`;

const UNKNOWN = `
local out = {}
for _, key in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  local a = redis.call('HMGET', key, 'model', 'reserved', 'reservedAt')
  table.insert(out, key); table.insert(out, a[1] or ''); table.insert(out, a[2] or '0'); table.insert(out, a[3] or '0')
end
return out`;

const RENEW = `
local c = redis.call('HMGET', KEYS[1], 'version', 'end')
if not c[1] then return 'ledger-missing' end
if tonumber(ARGV[1]) < tonumber(c[2]) then return 'still-open' end
if tonumber(ARGV[2]) < tonumber(c[2]) then return 'overlaps' end
redis.call('HSET', KEYS[1], 'start', ARGV[2], 'end', ARGV[3])
return 'renewed'`;

const PAUSE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'ledger-missing' end
redis.call('HSET', KEYS[1], 'paused', ARGV[1], 'pausedReason', ARGV[2])
return 'ok'`;

export class SpendingLedgerUnavailable extends Error {}

/** One Upstash REST command. Any transport, HTTP or Redis error is "unavailable". */
export function redisRest(url: string, token: string, timeoutMs = 2500) {
  return async (command: (string | number)[]): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(command), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw new SpendingLedgerUnavailable('Spending ledger request failed.'); }
    const body = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
    if (!response.ok || !body || body.error !== undefined) throw new SpendingLedgerUnavailable('Spending ledger request failed.');
    return body.result;
  };
}

const MAX_NANOS = 1_000_000_000_000;
const amount = (value: number, zero = false) => {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > MAX_NANOS) throw new Error('Invalid spending amount.');
  return value;
};
const utc = (ms: number) => new Date(ms).toISOString();
export const monthId = (ms: number) => utc(ms).slice(0, 7);
export const dayId = (ms: number) => utc(ms).slice(0, 10);
/** Visitor and network days within the overall day, the day within a month, a month within the year. */
function checkCaps(caps: SpendingCaps) {
  for (const value of Object.values(caps)) amount(value);
  if (caps.monthNanos > caps.annualNanos || caps.dayNanos > caps.monthNanos || caps.visitorDayNanos > caps.dayNanos || caps.networkDayNanos > caps.dayNanos)
    throw new Error('Caps must nest: visitor and network days within the overall day, the day within a month, a month within the year.');
}

/** Redis operations for one ledger prefix, such as `archwoven:` or `archwoven-preview:`. */
export function openSpendingLedger({ url, token, prefix, now = () => Date.now(), call = redisRest(url, token) }: {
  url: string; token: string; prefix: string; now?: () => number; call?: (command: (string | number)[]) => Promise<unknown>;
}) {
  if (!/^[a-z0-9-]+:$/.test(prefix)) throw new Error('The spending ledger prefix must be lowercase letters, digits or dashes, ending in a colon.');
  const config = `${prefix}spend:config`;
  const unknownSet = `${prefix}spend:unknown`;
  const attempt = (id: string) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid attempt id.');
    return `${prefix}spend:attempt:${id}`;
  };
  // Identities are stored only as keyed hashes; the key is the ledger credential.
  const hash = (kind: string, value: string | null) => value ? createHmac('sha256', token).update(`${prefix}${kind}:${value}`).digest('hex').slice(0, 32) : '';
  const eval_ = (script: string, keys: string[], args: (string | number)[]) => call(['EVAL', script, keys.length, ...keys, ...args.map(String)]);
  const p = `${prefix}spend:`;
  return {
    /** Explicit operator action. An existing ledger is never replaced. */
    async initialize(window: { start: number; end: number }, caps: SpendingCaps): Promise<'initialized' | 'exists'> {
      if (!(window.start < window.end)) throw new Error('The annual window must end after it starts.');
      checkCaps(caps);
      return await eval_(INIT, [config], [window.start, window.end, caps.annualNanos, caps.monthNanos, caps.visitorDayNanos, caps.networkDayNanos, caps.dayNanos]) as 'initialized' | 'exists';
    },
    /** Explicit operator action: new caps for holds made from now on. Records are kept. */
    async setCaps(caps: SpendingCaps): Promise<'updated' | 'ledger-missing'> {
      checkCaps(caps);
      return await eval_(SET_CAPS, [config], [caps.annualNanos, caps.monthNanos, caps.dayNanos, caps.visitorDayNanos, caps.networkDayNanos, now()]) as 'updated' | 'ledger-missing';
    },
    /** Hold `nanos` for one attempt against every applicable cap. Idempotent by id. */
    async reserve(id: string, nanos: number, who: { visitor: string; network: string | null }, identity: { model: string; basis: string }): Promise<ReserveResult> {
      const at = now();
      const [reason] = await eval_(RESERVE, [config, attempt(id)], [p, at, amount(nanos), hash('visitor', who.visitor), hash('network', who.network), identity.model, identity.basis, monthId(at), dayId(at)]) as [string];
      return reason === 'ok' ? { ok: true } : { ok: false, reason: reason as Exclude<ReserveResult, { ok: true }>['reason'] };
    },
    /** Settle with the reported charge, or `null` when usage is unknown (the hold is kept). Idempotent. */
    async settle(id: string, chargedNanos: number | null): Promise<SettleResult> {
      return await eval_(SETTLE, [attempt(id), config, unknownSet], [chargedNanos === null ? '' : amount(chargedNanos, true)]) as SettleResult;
    },
    /** Attempts whose usage was never reported, oldest first; each keeps its whole hold. */
    async unknownAttempts(): Promise<{ id: string; model: string; reservedNanos: number; reservedAt: number }[]> {
      const flat = await eval_(UNKNOWN, [unknownSet], []) as string[];
      const rows = [];
      for (let i = 0; i < flat.length; i += 4) rows.push({ id: flat[i]!.slice(`${prefix}spend:attempt:`.length), model: flat[i + 1]!, reservedNanos: Number(flat[i + 2]), reservedAt: Number(flat[i + 3]) });
      return rows.sort((a, b) => a.reservedAt - b.reservedAt);
    },
    /** Settle one unknown attempt at an amount confirmed outside the ledger, such as the
     * provider's usage console. Explicit operator action, never above the hold. */
    async resolveUnknown(id: string, chargedNanos: number, evidence: string): Promise<'resolved' | 'not-unknown' | 'over-hold'> {
      const note = evidence.trim();
      if (!note || note.length > 500) throw new Error('Resolving unknown usage needs evidence of at most 500 characters.');
      return await eval_(RESOLVE, [attempt(id), unknownSet], [amount(chargedNanos, true), note, now()]) as 'resolved' | 'not-unknown' | 'over-hold';
    },
    /** Start the next annual window once the current one has ended. Holds stay in the year that made them. */
    async renew(window: { start: number; end: number }): Promise<'renewed' | 'still-open' | 'overlaps' | 'ledger-missing'> {
      if (!(window.start < window.end)) throw new Error('The annual window must end after it starts.');
      return await eval_(RENEW, [config], [now(), window.start, window.end]) as 'renewed' | 'still-open' | 'overlaps' | 'ledger-missing';
    },
    /** Kill switch shared by every instance. */
    async setPaused(paused: boolean, reason = ''): Promise<'ok' | 'ledger-missing'> {
      return await eval_(PAUSE, [config], [paused ? 1 : 0, reason]) as 'ok' | 'ledger-missing';
    },
    async status(): Promise<SpendingStatus | null> {
      const at = now();
      const row = await eval_(STATUS, [config, unknownSet], [p, monthId(at), dayId(at)]) as (string | number)[];
      if (!row.length) return null;
      const n = (i: number) => Number(row[i]);
      return {
        start: n(0), end: n(1), caps: { annualNanos: n(2), monthNanos: n(3), dayNanos: row[13] === '' ? null : n(13), visitorDayNanos: n(4), networkDayNanos: n(5) },
        paused: String(row[6]) === '1', pausedReason: String(row[7]) || null,
        year: { settledNanos: n(8), heldNanos: n(9) }, month: { id: monthId(at), settledNanos: n(10), heldNanos: n(11) }, day: { id: dayId(at), settledNanos: n(14), heldNanos: n(15) },
        unknownAttempts: n(12),
      };
    },
  };
}
export type SpendingLedger = ReturnType<typeof openSpendingLedger>;
