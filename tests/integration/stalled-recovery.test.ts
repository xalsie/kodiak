import IORedis from "ioredis";
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "@jest/globals";
import { RedisQueueRepository } from "../../src/infrastructure/redis/redis-queue.repository.js";

interface Payload {
    foo: string;
}

describe("Integration: stalled jobs recovery", () => {
    let redis: IORedis;
    let repository: RedisQueueRepository<Payload>;
    const queueName = "stalled-recovery-queue";
    const prefix = `kodiak-test-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(() => {
        redis = new IORedis({ host: "localhost", port: 6379, maxRetriesPerRequest: 1 });
    });

    afterAll(async () => {
        const keys = await redis.keys(`${prefix}:*`);
        if (keys.length > 0) {
            await redis.del(...keys);
        }

        await redis.quit();
    });

    beforeEach(async () => {
        const keys = await redis.keys(`${prefix}:*`);
        if (keys.length > 0) await redis.del(...keys);
        repository = new RedisQueueRepository<Payload>(queueName, redis, prefix);
    });

    it("should move an expired active job back to waiting and increment retry_count", async () => {
        const jobId = "stalled-job-1";
        const jobKey = `${prefix}:jobs:${jobId}`;

        await redis.hset(
            jobKey,
            "data",
            JSON.stringify({ foo: "bar" }),
            "priority",
            "10",
            "retry_count",
            "0",
            "max_attempts",
            "3",
            "added_at",
            String(Date.now()),
        );

        const expiredScore = Date.now() - 1000;
        await redis.zadd(`${prefix}:queue:${queueName}:active`, expiredScore, jobId);

        const activeCheckCount = await redis.zcard(`${prefix}:queue:${queueName}:active`);
        expect(activeCheckCount).toBe(1);

        const waitingCount = await redis.llen(`${prefix}:queue:${queueName}:waiting`);
        expect(waitingCount).toBe(0);

        const recoveredJobs = await repository.recoverStalledJobs();
        expect(recoveredJobs).toEqual([jobId]);

        const activeCount = await redis.zcard(`${prefix}:queue:${queueName}:active`);
        expect(activeCount).toBe(0);

        const waiting = await redis.lrange(`${prefix}:queue:${queueName}:waiting`, 0, -1);
        expect(waiting).toContain(jobId);

        const retry = await redis.hget(jobKey, "retry_count");
        expect(retry).toBe("1");
    });
});
