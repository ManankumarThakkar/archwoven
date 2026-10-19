/** Bounds serialized temporary payloads, not Redis allocator/key overhead or spending records. */
export const HOSTED_STORAGE_LIMITS = { bytes: 32 * 1024 * 1024, records: 256 } as const;
export const HOSTED_MODEL_BYTES = 512 * 1024;
export const HOSTED_RESULT_BYTES = HOSTED_MODEL_BYTES + 64 * 1024;
export const HOSTED_REPORT_BYTES = 16 * 1024;
export const HOSTED_JOB_STORAGE_BYTES = HOSTED_MODEL_BYTES + HOSTED_RESULT_BYTES + HOSTED_REPORT_BYTES;
export const HOSTED_JOB_STORAGE_RECORDS = 3;
export type HostedStorageLimits = { bytes: number; records: number };
export type StorageWrite = 'ok' | 'storage-full' | 'too-large';

/**
 * Included in the existing atomic lifecycle scripts. Redis TIME keeps expiry accounting on the
 * same clock as Redis TTLs. The index contains at most the record cap plus admitted job holds.
 * Holds spend capacity, then transfer it to actual payloads; they never double-count a write.
 */
export const STORAGE_LUA = `
local function storageBudget(p, maxBytes, maxRecords)
  local expires, sizes, slots = p .. 'storage:expires', p .. 'storage:bytes', p .. 'storage:records'
  local t = redis.call('TIME')
  local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  local function keepIndex(ttlMs)
    for _, k in ipairs({expires, sizes, slots}) do
      redis.call('PEXPIRE', k, math.max(86460000, ttlMs + 60000, redis.call('PTTL', k)))
    end
  end
  local function amount(hash, key) return tonumber(redis.call('HGET', hash, key)) or 0 end
  local function drop(key)
    if not redis.call('ZSCORE', expires, key) then return end
    local bytes, records = amount(sizes, key), amount(slots, key)
    redis.call('HINCRBY', sizes, '_total', -bytes)
    redis.call('HINCRBY', slots, '_total', -records)
    redis.call('HDEL', sizes, key)
    redis.call('HDEL', slots, key)
    redis.call('ZREM', expires, key)
  end
  for _, key in ipairs(redis.call('ZRANGEBYSCORE', expires, '-inf', now)) do
    local ttl = redis.call('PTTL', key)
    if ttl == -2 then
      -- Holds have no payload key; a missing payload has also genuinely expired.
      drop(key)
    else
      -- An old deployment may have renewed a live copy without updating this index.
      -- Reconcile it instead of deleting the visitor's still-live diagram.
      local bytes = redis.call('HSTRLEN', key, 'value')
      redis.call('HINCRBY', sizes, '_total', bytes - amount(sizes, key))
      redis.call('HSET', sizes, key, bytes)
      local remaining = math.max(1, ttl == -1 and 86400000 or ttl)
      redis.call('ZADD', expires, now + remaining, key)
      keepIndex(remaining)
    end
  end
  local function take(key, bytes, records, ttlMs, hold)
    local deltaBytes, deltaRecords = bytes - amount(sizes, key), records - amount(slots, key)
    local creditBytes, creditRecords = 0, 0
    if hold and hold ~= '' then
      if not redis.call('ZSCORE', expires, hold) then return false end
      creditBytes = math.min(amount(sizes, hold), math.max(0, deltaBytes))
      creditRecords = math.min(amount(slots, hold), math.max(0, deltaRecords))
    end
    if amount(sizes, '_total') + deltaBytes - creditBytes > maxBytes
      or amount(slots, '_total') + deltaRecords - creditRecords > maxRecords then return false end
    redis.call('HINCRBY', sizes, '_total', deltaBytes - creditBytes)
    redis.call('HINCRBY', slots, '_total', deltaRecords - creditRecords)
    if creditBytes > 0 then redis.call('HINCRBY', sizes, hold, -creditBytes) end
    if creditRecords > 0 then redis.call('HINCRBY', slots, hold, -creditRecords) end
    redis.call('HSET', sizes, key, bytes)
    redis.call('HSET', slots, key, records)
    redis.call('ZADD', expires, now + ttlMs, key)
    -- No index can disappear while one of its payloads or holds is live.
    keepIndex(ttlMs)
    return true
  end
  return { take = take, drop = drop,
    usage = function() return {amount(sizes, '_total'), amount(slots, '_total')} end }
end
`;

export const STORAGE_USAGE_LUA = STORAGE_LUA + `return storageBudget(ARGV[1], 0, 0).usage()`;
