-- KEYS[1] = waiting zset
-- KEYS[2] = active zset
-- ARGV[1] = count
-- ARGV[2] = lock expiration timestamp

local count = tonumber(ARGV[1])
local lockExpiresAt = tonumber(ARGV[2])
local jobIds = {}

for i = 1, count do
    local results = redis.call('ZPOPMIN', KEYS[1], 1)
    if results and #results > 0 then
        local jobId = results[1]
        redis.call('ZADD', KEYS[2], lockExpiresAt, jobId)
        table.insert(jobIds, jobId)
    else
        break
    end
end

return jobIds
