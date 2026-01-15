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

if #jobs > 0 then
    for _, jobId in ipairs(jobs) do
        local jobKey = jobKeyPrefix .. jobId
        
        -- Get job priority to set the correct score in waiting queue
        -- Assuming priority is stored in the job hash. If not, we might need a default.
        local priority = tonumber(redis.call('HGET', jobKey, 'priority')) or 0
        
        -- Move to waiting queue with priority as score
        redis.call('ZADD', waitingQueue, priority, jobId)
        
        -- Update state
        redis.call('HSET', jobKey, 'state', 'waiting')
        
        -- Remove from delayed queue
        redis.call('ZREM', delayedQueue, jobId)
        
        -- Notify workers
        redis.call('LPUSH', notificationQueue, '1')
    end
end

return #jobs
