import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Redis } from "ioredis";

jest.unstable_mockModule("fs", () => ({
    readFileSync: jest.fn().mockReturnValue("return 1"),
    default: { readFileSync: jest.fn().mockReturnValue("return 1") },
}));

const { RedisQueueRepository } = await import("../../src/infrastructure/redis/redis-queue.repository.js");

describe("RedisQueueRepository extra coverage", () => {
    let mockRedis: Partial<Redis> & { pipeline: jest.Mock };
    let mockPipeline: any;
    let repo: InstanceType<typeof RedisQueueRepository>;

    beforeEach(() => {
        mockPipeline = {
            hset: jest.fn().mockReturnThis(),
            hgetall: jest.fn().mockReturnThis(),
            exec: jest.fn(),
        };

        mockRedis = {
            eval: jest.fn(),
            pipeline: jest.fn().mockReturnValue(mockPipeline),
        } as unknown as Partial<Redis> & { pipeline: jest.Mock };

        repo = new RedisQueueRepository("q", mockRedis as unknown as Redis, "pref");
        jest.clearAllMocks();
    });

    it("fetchNextJobs should call hset without lock_owner when ownerToken not provided", async () => {
        const jobIds = ["job-1"];
        const jobData = {
            data: JSON.stringify({ foo: "bar" }),
            priority: "1",
            retry_count: "0",
            max_attempts: "1",
            added_at: String(Date.now()),
            state: "active",
        };

        (mockRedis.eval as jest.Mock).mockResolvedValue(jobIds);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([ [null, "OK"], [null, jobData] ]);

        const jobs = await repo.fetchNextJobs(1, 1000);

        expect(jobs).toHaveLength(1);
        // hset should have been called without lock_owner arg (i.e., 4 args after key)
        expect(mockPipeline.hset).toHaveBeenCalled();
        const hsetArgs = (mockPipeline.hset as jest.Mock).mock.calls[0];
        // args: jobKey, 'state', 'active', 'started_at', now
        expect(hsetArgs.length).toBeGreaterThanOrEqual(5);
        expect(hsetArgs).not.toContain("lock_owner");
    });

    it("extendLock returns true/false and forwards ownerToken correctly", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce(1).mockResolvedValueOnce(0);

        const res1 = await repo.extendLock("job-1", Date.now() + 1000, "owner-1");
        expect(res1).toBe(true);
        const call1 = (mockRedis.eval as jest.Mock).mock.calls[0];
        // last argument should be owner token
        expect(call1[6]).toBe("owner-1");

        const res2 = await repo.extendLock("job-2", Date.now() + 1000);
        expect(res2).toBe(false);
        const call2 = (mockRedis.eval as jest.Mock).mock.calls[1];
        // when ownerToken omitted, last arg should be empty string
        expect(call2[6]).toBe("");
    });
});
