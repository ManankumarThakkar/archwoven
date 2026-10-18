import { createHmac } from 'node:crypto';
import { redisRest } from './spending-ledger';

/**
 * Shared hosted job lifecycle in Redis (Upstash REST), for serverless
 * instances that share nothing else. Every transition is one atomic script:
 *
 *   admit:  idempotent per owner and key; one active job per owner; a bounded
 *           waiting list. The accepting invocation then executes its own job.
 *   claim:  first in, first out, within a running limit; exactly one claimant
 *           ever moves a job from queued to running, so no paid work repeats.
 *   finish: only the claimant of a still-running job records its result.
 *   cancel: owner-checked; a running job is flagged for its executor to abort.
 *   read:   owner-checked; a job past its deadline reads as failed, which is
 *           how crashed or killed executions end. Nothing is ever retried.
 *
 * Job status, results and the visitor's last task report expire 24 hours
 * after the job was created. Spending records live elsewhere and never do.
 */

export type HostedJobStatus = 'queued' | 'running' | 'clarifying' | 'succeeded' | 'failed' | 'cancelled';
export interface HostedJobLimits { maxRunning: number; maxWaiting: number; waitMs: number; runMs: number; maxPerNetwork?: number }
export interface HostedJobView {
  status: HostedJobStatus; kind: string; stage: string | null; error: string | null; queuePosition: number | null;
  deadlineAt: number; usagePending: boolean; modelId: string | null; revision: number | null; questions: string[];
  clarification: unknown;
}
export type AdmitResult = { kind: 'admitted' } | { kind: 'replay'; jobId: string } | { kind: 'busy'; jobId: string } | { kind: 'queue-full' } | { kind: 'network-busy' };
export type ClaimResult = { kind: 'claimed' } | { kind: 'wait'; position: number } | { kind: 'expired' | 'gone' } | { kind: 'not-queued'; status: string };

export const RESULT_TTL_SECONDS = 86_400;
export const EXPIRED_COPY = 'This job stopped before it finished, so it was not completed. You can retry it.';
export const WAIT_COPY = 'The service was busy for too long, so this request did not start. Nothing was charged. You can retry it.';

const ADMIT = `
local p, now = ARGV[1], tonumber(ARGV[2])
local id, owner, idem = ARGV[3], ARGV[4], ARGV[5]
local waitMs, runMs, ttl = tonumber(ARGV[8]), tonumber(ARGV[9]), tonumber(ARGV[10])
if idem ~= '' then
  -- Replay only a job that can still succeed or did; a retry after failure starts afresh.
  local existing = redis.call('GET', p .. 'jobs:idem:' .. owner .. ':' .. idem)
  if existing then
    local e = redis.call('HMGET', p .. 'job:' .. existing, 'status', 'deadlineAt')
    local live = e[1] == 'succeeded' or e[1] == 'clarifying' or ((e[1] == 'queued' or e[1] == 'running') and tonumber(e[2]) > now)
    if live then return {'replay', existing} end
  end
end
local activeKey = p .. 'jobs:active:' .. owner
local active = redis.call('GET', activeKey)
if active then
  local a = redis.call('HMGET', p .. 'job:' .. active, 'status', 'deadlineAt')
  if (a[1] == 'queued' or a[1] == 'running') and tonumber(a[2]) > now then return {'busy', active} end
end
local net = ARGV[11]
local netKey = p .. 'jobs:net:' .. net
if net ~= '' then
  redis.call('ZREMRANGEBYSCORE', netKey, '-inf', now)
  if redis.call('ZCARD', netKey) >= tonumber(ARGV[12]) then return {'network-busy'} end
end
redis.call('ZREMRANGEBYSCORE', p .. 'jobs:waiting', '-inf', now - waitMs)
if redis.call('ZCARD', p .. 'jobs:waiting') >= tonumber(ARGV[7]) then return {'queue-full'} end
local key = p .. 'job:' .. id
local deadline = now + waitMs + runMs
redis.call('HSET', key, 'owner', owner, 'net', net, 'kind', ARGV[6], 'status', 'queued', 'createdAt', now, 'deadlineAt', deadline, 'usagePending', '1')
if net ~= '' then
  redis.call('ZADD', netKey, deadline, id)
  redis.call('PEXPIRE', netKey, deadline - now + 60000)
end
redis.call('EXPIRE', key, ttl)
redis.call('ZADD', p .. 'jobs:waiting', now, id)
redis.call('SET', activeKey, id, 'PX', deadline - now + 60000)
if idem ~= '' then redis.call('SET', p .. 'jobs:idem:' .. owner .. ':' .. idem, id, 'EX', ttl) end
return {'admitted'}`;

const CLAIM = `
local p, id, now = ARGV[1], ARGV[2], tonumber(ARGV[3])
local maxRunning, runMs, waitMs = tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[7])
local key = p .. 'job:' .. id
local s = redis.call('HMGET', key, 'status', 'createdAt')
if not s[1] then return {'gone'} end
if s[1] ~= 'queued' then return {'not-queued', s[1]} end
if now > tonumber(s[2]) + waitMs then return {'expired'} end
redis.call('ZREMRANGEBYSCORE', p .. 'jobs:running', '-inf', now)
redis.call('ZREMRANGEBYSCORE', p .. 'jobs:waiting', '-inf', now - waitMs)
local rank = redis.call('ZRANK', p .. 'jobs:waiting', id)
if not rank then return {'gone'} end
if redis.call('ZCARD', p .. 'jobs:running') + rank >= maxRunning then return {'wait', rank + 1} end
redis.call('ZREM', p .. 'jobs:waiting', id)
redis.call('ZADD', p .. 'jobs:running', now + runMs, id)
redis.call('HSET', key, 'status', 'running', 'claimedBy', ARGV[6], 'stage', 'generating')
return {'claimed'}`;

const RELEASE = `
local function release(p, id, owner)
  redis.call('ZREM', p .. 'jobs:running', id)
  redis.call('ZREM', p .. 'jobs:waiting', id)
  local net = redis.call('HGET', p .. 'job:' .. id, 'net')
  if net and net ~= '' then redis.call('ZREM', p .. 'jobs:net:' .. net, id) end
  if owner and redis.call('GET', p .. 'jobs:active:' .. owner) == id then redis.call('DEL', p .. 'jobs:active:' .. owner) end
end`;

const FINISH = RELEASE + `
local p, id = ARGV[1], ARGV[2]
local key = p .. 'job:' .. id
local s = redis.call('HMGET', key, 'status', 'claimedBy', 'owner')
if not s[1] then return 'gone' end
release(p, id, s[3])
redis.call('HSET', key, 'usagePending', '0')
if s[1] ~= 'running' or s[2] ~= ARGV[3] then return 'stale' end
redis.call('HSET', key, 'status', ARGV[4], 'error', ARGV[5], 'stage', '')
for i = 6, #ARGV, 2 do redis.call('HSET', key, ARGV[i], ARGV[i + 1]) end
return 'ok'`;

const ABANDON = RELEASE + `
local p, id = ARGV[1], ARGV[2]
local key = p .. 'job:' .. id
local s = redis.call('HMGET', key, 'status', 'owner')
if not s[1] then return 'gone' end
release(p, id, s[2])
if s[1] == 'queued' then redis.call('HSET', key, 'status', 'failed', 'error', ARGV[3], 'usagePending', '0') return 'failed' end
redis.call('HSET', key, 'usagePending', '0')
return s[1]`;

const CANCEL = RELEASE + `
local p, id = ARGV[1], ARGV[2]
local key = p .. 'job:' .. id
local s = redis.call('HMGET', key, 'status', 'owner')
if not s[1] or s[2] ~= ARGV[3] then return 'not-found' end
if s[1] == 'queued' then
  release(p, id, s[2])
  redis.call('HSET', key, 'status', 'cancelled', 'error', 'Cancelled.', 'usagePending', '0')
  return 'cancelled'
end
if s[1] == 'running' then
  -- The executor aborts and releases its running slot; usage stays pending until it does.
  if redis.call('GET', p .. 'jobs:active:' .. s[2]) == id then redis.call('DEL', p .. 'jobs:active:' .. s[2]) end
  local net = redis.call('HGET', key, 'net')
  if net and net ~= '' then redis.call('ZREM', p .. 'jobs:net:' .. net, id) end
  redis.call('HSET', key, 'status', 'cancelled', 'error', 'Cancelled.', 'cancel', '1')
  return 'cancelled'
end
return s[1]`;

const READ = RELEASE + `
local p, id, now = ARGV[1], ARGV[2], tonumber(ARGV[4])
local key = p .. 'job:' .. id
local f = redis.call('HMGET', key, 'owner', 'status', 'kind', 'stage', 'error', 'deadlineAt', 'usagePending', 'modelId', 'revision', 'clarification')
if not f[1] or f[1] ~= ARGV[3] then return {} end
if (f[2] == 'queued' or f[2] == 'running') and now > tonumber(f[6]) then
  release(p, id, f[1])
  redis.call('HSET', key, 'status', 'failed', 'error', ARGV[5], 'usagePending', '0')
  f[2], f[5], f[7] = 'failed', ARGV[5], '0'
elseif f[2] == 'cancelled' and f[7] == '1' and now > tonumber(f[6]) then
  -- Its executor never reported back; nothing more will settle.
  redis.call('HSET', key, 'usagePending', '0')
  f[7] = '0'
end
local position = ''
if f[2] == 'queued' then
  local rank = redis.call('ZRANK', p .. 'jobs:waiting', id)
  if rank then position = rank + 1 end
end
return {f[2], f[3], f[4] or '', f[5] or '', f[6], f[7] or '0', f[8] or '', f[9] or '', f[10] or '', position}`;

const CANCELLED = `return redis.call('HGET', KEYS[1], 'cancel') == '1' and 1 or 0`;
const PUT_OWNED = `redis.call('HSET', KEYS[1], 'owner', ARGV[1], 'value', ARGV[2]) redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3])) return 'ok'`;
const GET_OWNED = `local v = redis.call('HMGET', KEYS[1], 'owner', 'value') if v[1] ~= ARGV[1] then return false end return v[2]`;
// A model write lands only for its owner and only over the revision the change was based on.
const PUT_MODEL = `
local v = redis.call('HMGET', KEYS[1], 'owner', 'revision')
if v[1] and v[1] ~= ARGV[1] then return 'not-owner' end
-- Records saved before revisions were tracked carry no revision field and are not checked.
if v[1] and ARGV[3] ~= '' and v[2] and v[2] ~= ARGV[3] then return 'stale' end
redis.call('HSET', KEYS[1], 'owner', ARGV[1], 'value', ARGV[2], 'revision', ARGV[4])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
return 'ok'`;
const DELETE_OWNED = `if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end return redis.call('DEL', KEYS[1])`;

const ID = /^[0-9a-f-]{36}$/;
/** Owned values: a diagram, a job's result, or the visitor's last task report (keyed by the owner hash). */
type OwnedKind = 'model' | 'result' | 'lasttask';
const IDEMPOTENCY = /^[\w:.-]{1,128}$/;

export function openHostedJobs({ url, token, prefix, ownerKey = token, now = () => Date.now(), call = redisRest(url, token) }: {
  url: string; token: string; prefix: string; ownerKey?: string; now?: () => number; call?: (command: (string | number)[]) => Promise<unknown>;
}) {
  if (!/^[a-z0-9-]+:$/.test(prefix)) throw new Error('The Redis prefix must be lowercase letters, digits or dashes, ending in a colon.');
  const id = (value: string) => { if (!ID.test(value)) throw new Error('Invalid job id.'); return value; };
  // A session id is a bearer credential: store only a keyed hash of it.
  const ownerOf = (sessionId: string) => createHmac('sha256', ownerKey).update(`${prefix}owner:${sessionId}`).digest('hex').slice(0, 32);
  const networkOf = (network: string | null | undefined) => network ? createHmac('sha256', ownerKey).update(`${prefix}network:${network}`).digest('hex').slice(0, 32) : '';
  const ownedKey = (kind: OwnedKind, key: string) => kind === 'lasttask' ? /^[0-9a-f]{32}$/.test(key) : ID.test(key);
  const run = (script: string, keys: string[], args: (string | number)[]) => call(['EVAL', script, keys.length, ...keys, ...args.map(String)]);
  const p = `${prefix}`;
  return {
    async admit(jobId: string, sessionId: string, kind: string, idempotencyKey: string | undefined, limits: HostedJobLimits, network?: string | null): Promise<AdmitResult> {
      if (idempotencyKey !== undefined && !IDEMPOTENCY.test(idempotencyKey)) throw new Error('Invalid idempotency key.');
      const [result, other] = await run(ADMIT, [], [p, now(), id(jobId), ownerOf(sessionId), idempotencyKey ?? '', kind, limits.maxWaiting, limits.waitMs, limits.runMs, RESULT_TTL_SECONDS, networkOf(network), limits.maxPerNetwork ?? 2]) as [string, string?];
      if (result === 'replay' || result === 'busy') return { kind: result, jobId: other! };
      return { kind: result as 'admitted' | 'queue-full' | 'network-busy' };
    },
    async claim(jobId: string, claimant: string, limits: HostedJobLimits): Promise<ClaimResult> {
      const [result, detail] = await run(CLAIM, [], [p, id(jobId), now(), limits.maxRunning, limits.runMs, claimant, limits.waitMs]) as [string, string | number | undefined];
      if (result === 'wait') return { kind: 'wait', position: Number(detail) };
      if (result === 'not-queued') return { kind: 'not-queued', status: String(detail) };
      return { kind: result as 'claimed' | 'expired' | 'gone' };
    },
    /** Record a claimed job's outcome. `stale` means it was cancelled or expired meanwhile; the outcome is discarded. */
    async finish(jobId: string, claimant: string, status: 'succeeded' | 'failed' | 'clarifying', error = '', fields: Record<string, string | number> = {}): Promise<'ok' | 'stale' | 'gone'> {
      return await run(FINISH, [], [p, id(jobId), claimant, status, error, ...Object.entries(fields).flat()]) as 'ok' | 'stale' | 'gone';
    },
    /** A job that never got a running slot ends as failed; nothing ran, so nothing was charged. */
    async abandon(jobId: string, error: string): Promise<string> {
      return await run(ABANDON, [], [p, id(jobId), error]) as string;
    },
    async cancel(jobId: string, sessionId: string): Promise<string> {
      if (!ID.test(jobId)) return 'not-found';
      return await run(CANCEL, [], [p, id(jobId), ownerOf(sessionId)]) as string;
    },
    async cancelRequested(jobId: string): Promise<boolean> {
      return await run(CANCELLED, [`${p}job:${id(jobId)}`], []) === 1;
    },
    async read(jobId: string, sessionId: string): Promise<HostedJobView | null> {
      if (!ID.test(jobId)) return null;
      const row = await run(READ, [], [p, jobId, ownerOf(sessionId), now(), EXPIRED_COPY]) as string[];
      if (!row.length) return null;
      const clarification = row[8] ? JSON.parse(row[8]) as { questions?: string[] } : null;
      return {
        status: row[0] as HostedJobStatus, kind: row[1]!, stage: row[2] || null, error: row[3] || null, deadlineAt: Number(row[4]),
        usagePending: row[5] === '1', modelId: row[6] || null, revision: row[7] ? Number(row[7]) : null,
        clarification, questions: clarification?.questions ?? [], queuePosition: row[9] === '' ? null : Number(row[9]),
      };
    },
    /** The job an earlier request with this key started, without admitting anything. */
    async replayOf(sessionId: string, idempotencyKey: string): Promise<string | null> {
      if (!IDEMPOTENCY.test(idempotencyKey)) return null;
      return await call(['GET', `${p}jobs:idem:${ownerOf(sessionId)}:${idempotencyKey}`]) as string | null;
    },
    /** An answered clarification's description must not outlive the diagram it produced. */
    async scrubClarification(jobId: string): Promise<void> {
      await call(['HDEL', `${p}job:${id(jobId)}`, 'clarification']);
    },
    /** Values readable only by the session that owns them, for 24 hours. */
    /** Save a diagram's current revision; `baseRevision` null writes unconditionally (a new diagram). */
    async putModel(modelId: string, sessionId: string, model: { revision: number; [field: string]: unknown }, baseRevision: number | null): Promise<'ok' | 'stale' | 'not-owner'> {
      if (!ID.test(modelId)) throw new Error('Invalid key.');
      return await run(PUT_MODEL, [`${p}model:${modelId}`], [ownerOf(sessionId), JSON.stringify(model), baseRevision === null ? '' : baseRevision, model.revision, RESULT_TTL_SECONDS]) as 'ok' | 'stale' | 'not-owner';
    },
    /** Whether a diagram id is free, this session's, or another visitor's, and this session's stored copy. */
    async modelState(modelId: string, sessionId: string): Promise<{ owner: 'absent' | 'self' | 'other'; model: { revision?: unknown } | null }> {
      if (!ID.test(modelId)) return { owner: 'other', model: null };
      const [owner, value] = await call(['HMGET', `${p}model:${modelId}`, 'owner', 'value']) as [string | null, string | null];
      if (owner === null) return { owner: 'absent', model: null };
      if (owner !== ownerOf(sessionId)) return { owner: 'other', model: null };
      return { owner: 'self', model: value ? JSON.parse(value) as { revision?: unknown } : null };
    },
    async putOwned(kind: OwnedKind, key: string, sessionId: string, value: unknown): Promise<void> {
      if (!ownedKey(kind, key)) throw new Error('Invalid key.');
      await run(PUT_OWNED, [`${p}${kind}:${key}`], [ownerOf(sessionId), JSON.stringify(value), RESULT_TTL_SECONDS]);
    },
    async getOwned<T>(kind: OwnedKind, key: string, sessionId: string): Promise<T | null> {
      if (!ownedKey(kind, key)) return null;
      const value = await run(GET_OWNED, [`${p}${kind}:${key}`], [ownerOf(sessionId)]) as string | null;
      return value ? JSON.parse(value) as T : null;
    },
    async deleteOwned(kind: OwnedKind, key: string, sessionId: string): Promise<boolean> {
      if (!ownedKey(kind, key)) return false;
      return await run(DELETE_OWNED, [`${p}${kind}:${key}`], [ownerOf(sessionId)]) === 1;
    },
    ownerOf,
  };
}
export type HostedJobs = ReturnType<typeof openHostedJobs>;
