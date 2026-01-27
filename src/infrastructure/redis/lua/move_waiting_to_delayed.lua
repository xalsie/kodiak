-- Move the next job from waiting ZSET to delayed ZSET with a given timestamp
-- KEYS[1]: Waiting Queue ZSet
-- KEYS[2]: Delayed Queue ZSet
-- KEYS[3]: Job Key Prefix

-- ARGV[1]: Next attempt timestamp (ms)

local waiting = KEYS[1]
local delayed = KEYS[2]
local jobPrefix = KEYS[3]
local nextAttempt = tonumber(ARGV[1])

local res = redis.call('ZPOPMIN', waiting, 1)
if #res == 0 then
  return nil
end

local jobId = res[1]

-- Note: avoid accessing job hash from Lua to remain compatible with strict key declarations.
-- We'll only move the id to the delayed zset atomically; the caller will update the job hash.
redis.call('ZADD', delayed, nextAttempt, jobId)

-- Return jobId and scheduled timestamp so client can create timer
return {jobId, tostring(nextAttempt)}
