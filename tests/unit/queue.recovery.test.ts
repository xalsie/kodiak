import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockKodiak: any;

const mockPromoteDelayedJobs = jest.fn().mockResolvedValue(0 as never);
const mockRecoverStalledJobs = jest.fn().mockResolvedValue([] as never);

jest.unstable_mockModule("../../src/infrastructure/redis/redis-queue.repository.js", () => ({
    RedisQueueRepository: jest.fn().mockImplementation(() => ({
        promoteDelayedJobs: mockPromoteDelayedJobs,
        recoverStalledJobs: mockRecoverStalledJobs,
        add: jest.fn(),
    })),
}));

const { Queue } = await import("../../src/presentation/queue.js");
import { Kodiak } from "../../src/presentation/kodiak.js";

describe("Unit: Queue stalled recovery scheduler", () => {
    beforeEach(() => {
        jest.useFakeTimers();

        const mockConnection = {
            duplicate: jest.fn(() => mockConnection),
            quit: jest.fn().mockResolvedValue("OK" as never),
        };

        mockKodiak = {
            connection: mockConnection,
            prefix: "test",
        } as unknown as Kodiak;

        mockPromoteDelayedJobs.mockClear();
        mockRecoverStalledJobs.mockClear();
    });

    afterEach(async () => {
        jest.useRealTimers();
    });

    it("should call recoverStalledJobs periodically", async () => {
        const queue = new Queue("test-queue", mockKodiak);

        jest.advanceTimersByTime(5000);
        await Promise.resolve();

        expect(mockRecoverStalledJobs).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(5000);
        await Promise.resolve();

        expect(mockRecoverStalledJobs).toHaveBeenCalledTimes(2);

        await queue.close();
    });
});
