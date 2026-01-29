import IORedis from "ioredis";
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "@jest/globals";
import { RedisQueueRepository } from "../../src/infrastructure/redis/redis-queue.repository";
import type { Job } from "../../src/domain/entities/job.entity";

interface Payload { foo: string }

describe("Integration: Sliding Window Rate Limiter", () => {
    let redis: IORedis;
    let repo: RedisQueueRepository<Payload>;
    const queueName = "sw-queue";
    const prefix = `kodiak-sw-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(() => {
        redis = new IORedis({ host: "localhost", port: 6379, maxRetriesPerRequest: 1 });
    });

    afterAll(async () => {
        const keys = await redis.keys(`${prefix}:*`);
        if (keys.length > 0) await redis.del(...keys);
        await redis.quit();
    });

    beforeEach(async () => {
        const keys = await redis.keys(`${prefix}:*`);
        if (keys.length > 0) await redis.del(...keys);
        // Configure sliding window: allow 1 event per window
        repo = new RedisQueueRepository<Payload>(queueName, redis, prefix, {
            mode: "sliding-window",
            slidingWindow: { windowSizeMs: 60000, limit: 1, policy: "delay", delayMs: 100 },
        });
    });

    const createJob = (id: string, priority = 10, delay = 0): { job: Job<Payload>; score: number } => {
        const job: Job<Payload> = {
            id,
            data: { foo: "bar" },
            status: delay > 0 ? "delayed" : "waiting",
            priority,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 1,
            updateProgress: async () => Promise.resolve(),
        };
        const score = priority * 10000000000000 + (Date.now() + delay);
        return { job, score };
    };

    it("moves next waiting job to delayed when limit exceeded and persists metadata", async () => {
        const a = createJob("job-a", 1);
        const b = createJob("job-b", 2);

        await repo.add(a.job, a.score, false);
        await repo.add(b.job, b.score, false);

        // First fetch should succeed
        const first = await repo.fetchNext();
        expect(first).not.toBeNull();
        expect(first?.id).toBe("job-a");

        // Second fetch should be rate-limited and move next job to delayed
        const second = await repo.fetchNext();
        expect(second).toBeNull();

        // job-b should be in delayed zset
        const delayedScore = await redis.zscore(`${prefix}:queue:${queueName}:delayed`, "job-b");
        expect(delayedScore).not.toBeNull();

        // job hash should contain delayed_meta and rate_limit_reset_at
        const delayedMeta = await redis.hget(`${prefix}:jobs:job-b`, "delayed_meta");
        const resetAt = await redis.hget(`${prefix}:jobs:job-b`, "rate_limit_reset_at");
        expect(delayedMeta).not.toBeNull();
        expect(resetAt).not.toBeNull();
    }, 20000);
});
