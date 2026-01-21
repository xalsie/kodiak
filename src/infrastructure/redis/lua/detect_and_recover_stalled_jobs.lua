-- File: src/infrastructure/redis/lua/detect_and_recover_stalled_jobs.lua
--
-- Atomically moves stalled jobs from the active ZSET back to the waiting list.
-- A job is considered stalled if its lock expiration timestamp (score) is in the past.
--
-- KEYS[1]: active zset (e.g., kodiak:queue:myqueue:active)
-- KEYS[2]: waiting list (e.g., kodiak:queue:myqueue:waiting)
--
-- ARGV[1]: Current timestamp (Date.now())
-- ARGV[2]: job key prefix (e.g., kodiak:jobs:)
--
-- Returns: A table of job IDs that were recovered.

local active = KEYS[1]
local waiting = KEYS[2]
local now = tonumber(ARGV[1])

local stalled = redis.call('ZRANGEBYSCORE', active, 0, now)
if stalled and #stalled > 0 then
    for _, id in ipairs(stalled) do
        redis.call('ZREM', active, id)
        redis.call('LPUSH', waiting, id)
    end
    return stalled
end
return {}
