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
local score = tonumber(ARGV[2])
local isDelayed = ARGV[3]

-- We explicitly set state to override any potential passed state, ensuring consistency
if #ARGV > 3 then
  -- fields are ARGV[4] .. ARGV[#ARGV]
  local fieldArgs = {}
  for i = 4, #ARGV do
    table.insert(fieldArgs, ARGV[i])
  end
  redis.call('HSET', KEYS[3], 'state', isDelayed == '1' and 'delayed' or 'waiting', unpack(fieldArgs))
else
  redis.call('HSET', KEYS[3], 'state', isDelayed == '1' and 'delayed' or 'waiting')
end

if isDelayed == '1' then
  redis.call('ZADD', KEYS[2], score, jobId)
  -- compute timestamp part from score (score = priority * 10000000000000 + timestamp)
  local timestamp = score % 10000000000000
  return tostring(timestamp)
else
  redis.call('ZADD', KEYS[1], score, jobId)
  -- Notify workers
  redis.call('LPUSH', KEYS[4], '1')
  return tostring(-1)
end
