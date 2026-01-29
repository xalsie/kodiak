import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Redis } from "ioredis";

jest.unstable_mockModule("fs", () => ({
    readFileSync: jest.fn().mockReturnValue("return 1"),
    default: { readFileSync: jest.fn().mockReturnValue("return 1") },
}));

const { RedisQueueRepository } = await import("../../src/infrastructure/redis/redis-queue.repository.js");

describe("Unit: moveWaitingToDelayed with sliding-window metadata", () => {
    let mockRedis: Partial<Redis> & { eval: jest.Mock; hset: jest.Mock };
    let repo: InstanceType<typeof RedisQueueRepository>;

    beforeEach(() => {
        mockRedis = {
            eval: jest.fn(),
            pipeline: jest.fn(),
            hset: jest.fn().mockResolvedValue("OK" as never),
            set: jest.fn(),
        } as unknown as Partial<Redis> & { eval: jest.Mock; hset: jest.Mock };

        repo = new RedisQueueRepository(
            "test-queue",
            mockRedis as unknown as Redis,
            "kodiak-test",
            {
                mode: "sliding-window",
                slidingWindow: { windowSizeMs: 60000, limit: 1, policy: "delay", delayMs: 500 },
            },
        );
    });

    it("moves a waiting job to delayed with metadata when sliding-window denies", async () => {
        const resetAt = Date.now() + 1000;
        const nextAttempt = Date.now() + 500;
        const meta = { reason: "rate_limit", resetAt };

        // First eval: sliding_window.lua -> denied
        mockRedis.eval.mockResolvedValueOnce(["0", "1", "1", String(resetAt)] as never);
        // Second eval: move_waiting_to_delayed.lua -> returns jobId, timestamp, meta
        mockRedis.eval.mockResolvedValueOnce(["job-42", String(nextAttempt), JSON.stringify(meta)] as never);

        const res = await repo.fetchNext();

        expect(res).toBeNull();

        // two eval calls: sliding window + move_waiting_to_delayed
        expect(mockRedis.eval).toHaveBeenCalledTimes(2);

        // hset should have been called to set delayed state and metadata
        expect(mockRedis.hset).toHaveBeenCalled();
        const callArgs = mockRedis.hset.mock.calls[0];
        // first arg is jobKey
        expect(String(callArgs[0])).toContain("kodiak-test:jobs:job-42");
        // the args should include delayed_meta and delayed_reason (or rate_limit_reset_at)
        const joined = callArgs.slice(1).map(String).join(" ");
        expect(joined).toContain("delayed_meta");
        expect(joined).toContain("rate_limit_reset_at");
    });
});
