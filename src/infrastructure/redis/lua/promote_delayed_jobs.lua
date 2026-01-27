-- Script to promote delayed jobs to waiting queue
-- KEYS[1]: Delayed Queue ZSet
-- KEYS[2]: Waiting Queue ZSet
-- KEYS[3]: Notification List
-- KEYS[4]: Job Key Prefix

-- ARGV[1]: Current Timestamp
-- ARGV[2]: Limit (Max jobs to move at once)

local delayedQueue = KEYS[1]
local waitingQueue = KEYS[2]
local notificationQueue = KEYS[3]
local jobKeyPrefix = KEYS[4]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

-- Get jobs ready to be processed
local jobs = redis.call('ZRANGEBYSCORE', delayedQueue, '-inf', now, 'LIMIT', 0, limit)

local moved = {}

if #jobs > 0 then
    for _, jobId in ipairs(jobs) do
        -- We avoid reading or writing the job hash inside this script because
        -- Redis scripts are only allowed to access keys provided in KEYS.
        -- To remain compatible with strict Redis key tracking, we will only
        -- move the ids between sorted sets and notify workers. The caller
        -- will update job hashes (state/updated_at) after the script returns.

        -- Default priority (no per-job hash access here)
        local priority = 0

        -- Move to waiting queue with priority as score
        redis.call('ZADD', waitingQueue, priority, jobId)

        -- Remove from delayed queue
        redis.call('ZREM', delayedQueue, jobId)

        -- Notify workers
        redis.call('LPUSH', notificationQueue, '1')

        table.insert(moved, jobId)
    end
end

-- Return list of moved job ids so caller can update job hashes atomically afterwards
return moved
