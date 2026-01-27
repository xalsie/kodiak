-- Token Bucket rate limiter
-- KEYS[1] = bucket key
-- ARGV[1] = now (ms)
-- ARGV[2] = tokens requested (number)
-- ARGV[3] = rate (tokens per second)
-- ARGV[4] = capacity (max tokens)

local key = KEYS[1]
local now = tonumber(ARGV[1])
local requested = tonumber(ARGV[2])
local rate = tonumber(ARGV[3])
local capacity = tonumber(ARGV[4])

local vals = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(vals[1])
local last = tonumber(vals[2])

if not tokens or not last then
  tokens = capacity
  last = now
end

-- refill based on elapsed ms
local delta = math.max(0, now - last)
local refill = delta * (rate / 1000)
tokens = math.min(capacity, tokens + refill)

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tostring(tokens), 'last', tostring(now))
-- keep key for some time to allow metric inspection
redis.call('PEXPIRE', key, 3600000)

return allowed
