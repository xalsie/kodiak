-- Script to atomically fail a job
-- KEYS[1]: Active Queue List
-- KEYS[2]: Job Data Hash

-- ARGV[1]: Job ID
-- ARGV[2]: Error Message
-- ARGV[3]: Failed At Timestamp

local activeQueue = KEYS[1]
local jobKey = KEYS[2]
local jobId = ARGV[1]
local errorMsg = ARGV[2]
local failedAt = ARGV[3]

-- 1. Remove from active queue
redis.call('LREM', activeQueue, 1, jobId)

-- 2. Update job state
redis.call('HSET', jobKey, 'state', 'failed', 'failed_at', failedAt, 'error', errorMsg)

return 1
