-- Script to atomically add a job
-- KEYS[1]: Waiting Queue ZSet
-- KEYS[2]: Delayed Queue ZSet
-- KEYS[3]: Job Data Hash

-- ARGV[1]: Job ID
-- ARGV[2]: Score (priority/timestamp)
-- ARGV[3]: Job Payload (JSON)
-- ARGV[4]: Is Delayed ('1' or '0')

local jobId = ARGV[1]
local score = ARGV[2]
local payload = ARGV[3]
local isDelayed = ARGV[4]

-- 1. Store job data
redis.call('HSET', KEYS[3], 'data', payload, 'state', isDelayed == '1' and 'delayed' or 'waiting')

-- 2. Add to appropriate queue
if isDelayed == '1' then
  redis.call('ZADD', KEYS[2], score, jobId)
else
  redis.call('ZADD', KEYS[1], score, jobId)
end

return jobId
