-- Sliding window rate limiter (supports requesting multiple slots)
-- KEYS[1] = zset key for the queue
-- ARGV[1] = now (ms)
-- ARGV[2] = windowSizeMs (number)
-- ARGV[3] = limit (number)
-- ARGV[4] = requested (number)
-- ARGV[5] = memberBase (string) -- base used to generate unique members

local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local memberBase = ARGV[5]

if not requested or requested < 1 then
  requested = 1
end

-- compute cutoff (inclusive)
local cutoff = now - window + 1

-- remove old entries
redis.call('ZREMRANGEBYSCORE', key, 0, cutoff - 1)

local current = tonumber(redis.call('ZCARD', key))

if (current + requested) <= limit then
  -- allow: add `requested` members with same timestamp
  for i = 1, requested do
    local member = memberBase .. ':' .. tostring(now) .. ':' .. tostring(i) .. ':' .. tostring(math.random(1000000))
    redis.call('ZADD', key, now, member)
  end
  -- keep key alive a bit longer than the window to allow inspection
  redis.call('PEXPIRE', key, window + 1000)

  -- earliest timestamp after insert
  local earliest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local earliestTs = tonumber(earliest[2])
  local resetAt = earliestTs + window

  return {1, tostring(current + requested), tostring(limit), tostring(resetAt)}
else
  -- denied: compute reset time (when the oldest entry will exit the window)
  local earliest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local earliestTs = tonumber(earliest[2])
  local resetAt = earliestTs + window
  return {0, tostring(current), tostring(limit), tostring(resetAt)}
end
