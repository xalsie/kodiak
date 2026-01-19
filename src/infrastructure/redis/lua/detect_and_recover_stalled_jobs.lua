-- File: src/infrastructure/redis/lua/detect_and_recover_stalled_jobs.lua
--
-- Atomically moves stalled jobs from the active ZSET back to the waiting list.
-- A job is considered stalled if its lock expiration timestamp (score) is in the past.
--
-- KEYS[1]: active zset (e.g., kodiak:queue:myqueue:active)
-- KEYS[2]: waiting list (e.g., kodiak:queue:myqueue:waiting)
-- KEYS[3]: job key prefix (e.g., kodiak:jobs:)
--
-- ARGV[1]: Current timestamp (Date.now())
--
-- Returns: A table of job IDs that were recovered.

local active_zset_key = KEYS[1]
local waiting_list_key = KEYS[2]
local job_key_prefix = KEYS[3]
local current_timestamp = tonumber(ARGV[1])

-- Find all jobs with a score (lock expiration) less than or equal to the current time.
-- The range is from 0 to current_timestamp.
local stalled_job_ids = redis.call('ZRANGEBYSCORE', active_zset_key, 0, current_timestamp)

if stalled_job_ids and #stalled_job_ids > 0 then
    for i, jobId in ipairs(stalled_job_ids) do
        -- Atomically remove the job from the active set.
        local removed = redis.call('ZREM', active_zset_key, jobId)
        
        if removed > 0 then
            local job_key = job_key_prefix .. jobId
            
            -- Increment the retry count for the job.
            redis.call('HINCRBY', job_key, 'retry_count', 1)
            
            -- Move the job back to the waiting list (at the front).
            redis.call('LPUSH', waiting_list_key, jobId)
        end
    end
    
    return stalled_job_ids
end

return {}
