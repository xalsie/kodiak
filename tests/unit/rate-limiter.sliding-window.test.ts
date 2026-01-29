import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Redis } from "ioredis";

jest.unstable_mockModule("fs", () => ({
    readFileSync: jest.fn().mockReturnValue("return 1"),
    default: { readFileSync: jest.fn().mockReturnValue("return 1") },
}));

const { RedisQueueRepository } = await import("../../src/infrastructure/redis/redis-queue.repository.js");

describe("Unit: Sliding Window Rate Limiter integration", () => {
    let mockRedis: Partial<Redis> & { eval: jest.Mock };
    let repo: InstanceType<typeof RedisQueueRepository>;

    beforeEach(() => {
        mockRedis = {
            eval: jest.fn().mockResolvedValue(null as never),
            pipeline: jest.fn(),
        } as unknown as Partial<Redis> & { eval: jest.Mock };

        repo = new RedisQueueRepository(
            "test-queue",
            mockRedis as unknown as Redis,
            "kodiak-test",
            {
                mode: "sliding-window",
                slidingWindow: { windowSizeMs: 60000, limit: 5, policy: "delay", delayMs: 500 },
            },
        );
        jest.clearAllMocks();
    });

    it("should call the sliding-window Lua script with the sliding key and correct args", async () => {
        // call fetchNext which triggers consumeTokensIfAllowed -> eval
        await repo.fetchNext();

        expect(mockRedis.eval).toHaveBeenCalled();

        const firstCall = mockRedis.eval.mock.calls[0];
        // call signature: eval(script, numKeys, key1, ..., arg1, arg2...)
        expect(firstCall[1]).toBeDefined();
        const numKeys = firstCall[1] as number;
        expect(numKeys).toBe(1);

        // the key should contain ':ratelimit:' and ':sliding'
        const keyArg = firstCall[2];
        expect(String(keyArg)).toContain(":ratelimit:");
        expect(String(keyArg)).toContain(":sliding");

        // args should contain windowSizeMs, limit and requested (1)
        const argsStartIndex = 2 + numKeys;
        const args = firstCall.slice(argsStartIndex) as string[];
        // ARGV[1] = now, ARGV[2] = windowSizeMs, ARGV[3] = limit, ARGV[4] = requested
        expect(args.length).toBeGreaterThanOrEqual(4);
        expect(args[1]).toBe(String(60000));
        expect(args[2]).toBe(String(5));
        expect(args[3]).toBe(String(1));
    });
});
