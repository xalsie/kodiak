-- Script to atomically fetch the next job (Wait -> Active)
-- KEYS[1]: Waiting Queue ZSet
-- KEYS[2]: Active Queue List

-- ARGV[1]: Current timestamp

-- 1. Get the highest priority job (lowest score)
local result = redis.call('ZPOPMIN', KEYS[1], 1)

if #result == 0 then
    return nil
end

local jobId = result[1]
-- result[2] is the score, we don't need it for the active list

-- 2. Push to active list
redis.call('LPUSH', KEYS[2], jobId)

return jobId
