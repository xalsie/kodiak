-- KEYS[1] = active zset
-- KEYS[2] = job hash key
-- ARGV[1] = jobId
-- ARGV[2] = new lock expiration timestamp (number)
-- ARGV[3] = ownerToken (optional, pass empty string if not used)

local active = KEYS[1]
local jobKey = KEYS[2]
local jobId = ARGV[1]
local newExpiry = tonumber(ARGV[2])
local ownerToken = ARGV[3]

-- Check if job is present in active set
local score = redis.call('ZSCORE', active, jobId)
if not score then
    return 0
end

-- If ownerToken provided, verify it matches job hash 'lock_owner'
if ownerToken and ownerToken ~= '' then
    local currentOwner = redis.call('HGET', jobKey, 'lock_owner')
    if not currentOwner or currentOwner ~= ownerToken then
        return 0
    end
end

redis.call('ZADD', active, newExpiry, jobId)
return 1
