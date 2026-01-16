-- Script to atomically fetch the next job (Wait -> Active)
-- KEYS[1]: Waiting Queue ZSet
-- KEYS[2]: Active Queue List
-- KEYS[3]: Notification List

-- ARGV[1]: Current timestamp
-- ARGV[2]: Job Key Prefix
-- ARGV[3]: Should Pop Token ('1' = yes, '0' = no)

-- 1. Get the highest priority job (lowest score)
local result = redis.call('ZPOPMIN', KEYS[1], 1)

if #result == 0 then
    return nil
end

local jobId = result[1]
-- result[2] is the score, we don't need it for the active list

-- 2. Push to active list
redis.call('LPUSH', KEYS[2], jobId)

-- 3. Pop notification token if requested (Optimistic fetch)
if ARGV[3] == '1' and KEYS[3] then
    redis.call('LPOP', KEYS[3])
end

-- 4. Update Job Data safely
local jobKey = ARGV[2] .. jobId

-- Use pcall to handle potential "undeclared key" errors in strict environments
local ok, _ = pcall(redis.call, 'HSET', jobKey, 'state', 'active', 'started_at', ARGV[1])

if not ok then
    -- If we can't access the key inside Lua, return just the ID and nil data
    -- The client will handle the update/fetch
    return {jobId, nil}
end

-- 4. Get Job Data
local jobData = redis.call('HGETALL', jobKey)

return {jobId, jobData}
