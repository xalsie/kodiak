-- Script to atomically complete a job and reschedule if recurring
-- KEYS[1]: Active Queue ZSet
-- KEYS[2]: Job Data Hash
-- KEYS[3]: Delayed Queue ZSet (For recurrence)

-- ARGV[1]: Job ID
-- ARGV[2]: Completed At Timestamp (Current Time)

local activeQueue = KEYS[1]
local jobKey = KEYS[2]
local delayedQueue = KEYS[3]

local jobId = ARGV[1]
local completedAt = tonumber(ARGV[2])

-- Get job recurring info
local jobData = redis.call('HMGET', jobKey, 'repeat_every', 'repeat_limit', 'repeat_count')
local repeatEvery = tonumber(jobData[1])
local repeatLimit = tonumber(jobData[2])
local repeatCount = tonumber(jobData[3]) or 0

-- Remove from active queue
redis.call('ZREM', activeQueue, jobId)

-- Check if we should reschedule
local shouldReschedule = false
if repeatEvery and repeatEvery > 0 then
    -- If no limit, always reschedule
    -- If limit exists, check if current execution count (repeatCount) is less than limit - 1
    -- Example: Limit 3.
    -- Exec 1 (Count 0): 0 < 2 -> Reschedule. (Count becomes 1)
    -- Exec 2 (Count 1): 1 < 2 -> Reschedule. (Count becomes 2)
    -- Exec 3 (Count 2): 2 < 2 -> False. Complete.
    if not repeatLimit or repeatCount < (repeatLimit - 1) then
        shouldReschedule = true
    end
end

if shouldReschedule then
    -- RESCHEDULE THE JOB
    local newRepeatCount = repeatCount + 1
    local nextRun = completedAt + repeatEvery

    -- Update job state to 'delayed' instead of 'completed'
    -- We reuse the same job ID for simplicity in this phase, creating a loop.
    -- (In future phases, we might want to create a clone to keep history)
    redis.call('HSET', jobKey, 'state', 'delayed', 'repeat_count', newRepeatCount, 'completed_at', completedAt)
    
    -- Add to delayed queue
    redis.call('ZADD', delayedQueue, nextRun, jobId)
    
    return 0 -- Indicates job was rescheduled
else
    -- COMPLETE THE JOB PERMANENTLY
    redis.call('HSET', jobKey, 'state', 'completed', 'completed_at', completedAt)
    return 1 -- Indicates job finished permanently
end
