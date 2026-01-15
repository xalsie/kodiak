-- Script to atomically complete a job
-- KEYS[1]: Active Queue List
-- KEYS[2]: Job Data Hash

-- ARGV[1]: Job ID
-- ARGV[2]: Completed At Timestamp

local activeQueue = KEYS[1]
local jobKey = KEYS[2]
local jobId = ARGV[1]
local completedAt = ARGV[2]

-- 1. Remove from active queue
redis.call('LREM', activeQueue, 1, jobId)

-- 2. Update job state
redis.call('HSET', jobKey, 'state', 'completed', 'completed_at', completedAt)

return 1
