-- Script to atomically fail a job with retry support
-- KEYS[1]: Active Queue ZSet
-- KEYS[2]: Job Data Hash
-- KEYS[3]: Delayed Queue ZSet (For retries)

-- ARGV[1]: Job ID
-- ARGV[2]: Error Message
-- ARGV[3]: Failed At Timestamp (Current Time)


local activeQueue = KEYS[1]
local jobKey = KEYS[2]
local delayedQueue = KEYS[3]
-- optional: KEYS[4] = delayed timer key prefix

local jobId = ARGV[1]
local errorMsg = ARGV[2]
local failedAt = tonumber(ARGV[3])
local forcedNextAttempt = tonumber(ARGV[4]) or -1

-- Get job retry info
local jobData = redis.call('HMGET', jobKey, 'retry_count', 'max_attempts', 'backoff_type', 'backoff_delay')
local retryCount = tonumber(jobData[1]) or 0
local maxAttempts = tonumber(jobData[2]) or 1
local backoffType = jobData[3]
local backoffDelay = tonumber(jobData[4]) or 0

-- Remove from active queue regardless of outcome
redis.call('ZREM', activeQueue, jobId)

-- Check if we should retry
-- We retry if the current retry_count is less than max_attempts - 1
-- Example: max_attempts = 1. retry_count = 0. 0 < 0 is false -> No retry.
-- Example: max_attempts = 3. retry_count = 0. 0 < 2 -> Retry.
-- Example: max_attempts = 3. retry_count = 2. 2 < 2 -> No retry (This was the 3rd attempt).
if retryCount < (maxAttempts - 1) then
    -- RETRY THE JOB
    local newRetryCount = retryCount + 1
    local nextAttempt = failedAt

    if forcedNextAttempt > 0 then
        nextAttempt = forcedNextAttempt
    else
        -- Calculate backoff (fallback if not provided by application)
        if backoffType == 'fixed' then
            nextAttempt = failedAt + backoffDelay
        elseif backoffType == 'exponential' then
            nextAttempt = failedAt + (backoffDelay * (2 ^ (newRetryCount - 1)))
        else
            -- Default to immediate retry or small delay if no backoff specified
            nextAttempt = failedAt
        end
    end

    -- Update job state
    redis.call('HSET', jobKey, 'state', 'delayed', 'retry_count', newRetryCount, 'error', errorMsg, 'failed_at', failedAt)

    -- Add to delayed queue
    redis.call('ZADD', delayedQueue, nextAttempt, jobId)

    -- Return the scheduled nextAttempt so caller can create timer key outside the script
    return tostring(nextAttempt)
else
    -- FAIL THE JOB PERMANENTLY
    -- Increment retry_count to reflect this final attempt so the counter
    -- represents total attempts performed (optional behavior).
    local finalRetryCount = retryCount + 1
    redis.call('HSET', jobKey, 'state', 'failed', 'failed_at', failedAt, 'error', errorMsg, 'retry_count', finalRetryCount)
    return tostring(-1)
end
