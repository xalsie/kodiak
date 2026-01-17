-- File: src/infrastructure/redis/lua/move_to_active.lua
--
-- Atomically moves up to 'max_jobs' from the waiting queue to the active queue.
-- It handles both list (for non-prioritized jobs) and zset (for prioritized jobs).
--
-- KEYS[1]: waiting queue key (list or zset)
-- KEYS[2]: active queue key (list)
--
-- ARGV[1]: Maximum number of jobs to move.
--
-- Returns: A table of job IDs that were moved.

local max_jobs = tonumber(ARGV[1])
local job_ids = {}

-- Check the type of the waiting queue
local queue_type = redis.call('type', KEYS[1]).ok

if queue_type == 'zset' then
    local zpopped = redis.call('zpopmin', KEYS[1], max_jobs)
    if zpopped and #zpopped > 0 then
        for i = 1, #zpopped, 2 do
            table.insert(job_ids, zpopped[i])
        end
    end
elseif queue_type == 'list' then
    local lpopped = redis.call('lpop', KEYS[1], max_jobs)
    if lpopped and #lpopped > 0 then
        job_ids = lpopped
    end
end

if job_ids and #job_ids > 0 then
    -- Move job ids to active queue
    redis.call('rpush', KEYS[2], unpack(job_ids))
end

return job_ids
