-- Script to atomically add a job
-- KEYS[1]: Waiting Queue ZSet
-- KEYS[2]: Delayed Queue ZSet
-- KEYS[3]: Job Data Hash
-- KEYS[4]: Notification List

-- ARGV[1]: Job ID
-- ARGV[2]: Score (priority/timestamp)
-- ARGV[3]: Is Delayed ('1' or '0')
-- ARGV[4...]: Field, Value pairs for Job Hash

local jobId = ARGV[1]
local score = ARGV[2]
local isDelayed = ARGV[3]

-- We explicitly set state to override any potential passed state, ensuring consistency
redis.call('HSET', KEYS[3], 'state', isDelayed == '1' and 'delayed' or 'waiting', unpack(ARGV, 4))

if isDelayed == '1' then
  redis.call('ZADD', KEYS[2], score, jobId)
else
  redis.call('ZADD', KEYS[1], score, jobId)
  -- Notify workers
  redis.call('LPUSH', KEYS[4], '1')
end

return jobId
