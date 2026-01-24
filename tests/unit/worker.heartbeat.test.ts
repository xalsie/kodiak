import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { Redis } from "ioredis";
import type { Kodiak } from "../../src/presentation/kodiak.js";

const mockExtendLock = jest.fn();
const mockFetchExecute = jest.fn();

jest.unstable_mockModule("../../src/infrastructure/redis/redis-queue.repository.js", () => ({
    RedisQueueRepository: jest.fn().mockImplementation(() => ({
        updateProgress: jest.fn(),
        fetchNextJobs: jest.fn(),
        extendLock: mockExtendLock,
        markAsFailed: jest.fn().mockResolvedValue(undefined as never),
        markAsCompleted: jest.fn().mockResolvedValue(undefined as never),
    })),
}));

jest.unstable_mockModule("../../src/application/use-cases/fetch-jobs.use-case.js", () => ({
    FetchJobsUseCase: jest.fn().mockImplementation(() => ({
        execute: mockFetchExecute,
    })),
}));

const { Worker } = await import("../../src/presentation/worker.js");

describe("Worker heartbeat", () => {
    let mockKodiak: Kodiak;
    let processor: jest.MockedFunction<(job: unknown) => Promise<void>>;

    beforeEach(() => {
        mockExtendLock.mockReset();
        mockFetchExecute.mockReset();

        const mockRedisConnection = {
            duplicate: jest.fn().mockReturnThis(),
            quit: jest.fn(),
            disconnect: jest.fn(),
            brpop: jest.fn(),
        };

        mockKodiak = {
            connection: mockRedisConnection as unknown as Redis,
            prefix: "kodiak-test",
        } as unknown as Kodiak;
        processor = jest.fn() as jest.MockedFunction<(job: unknown) => Promise<void>>;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("calls extendLock periodically when heartbeatEnabled", async () => {
        jest.useRealTimers();

        const job = {
            id: "hb-job",
            data: { foo: "bar" },
            priority: 1,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
            status: "active",
            updateProgress: async () => {},
        };

        // first call returns one job, then no jobs
        mockFetchExecute.mockResolvedValueOnce([job] as never).mockResolvedValueOnce([] as never);

        processor.mockImplementation(async () => {
            return new Promise((resolve) => setTimeout(resolve, 50));
        });

        const worker = new Worker("test-queue", processor, mockKodiak, {
            heartbeatEnabled: true,
            heartbeatInterval: 10,
            lockDuration: 100,
            concurrency: 1,
        });

        await worker.start();

        // wait enough time for the heartbeat to trigger at least once
        await new Promise((resolve) => setTimeout(resolve, 120));

        await worker.stop();

        expect(mockExtendLock).toHaveBeenCalled();
        const callArgs = mockExtendLock.mock.calls[0];
        expect(callArgs[0]).toBe("hb-job");
        expect(typeof callArgs[1]).toBe("number");
        expect(typeof callArgs[2]).toBe("string");
    });

    it("emits error when extendLock throws inside heartbeat", async () => {
        jest.useRealTimers();

        const job = {
            id: "hb-job",
            data: { foo: "bar" },
            priority: 1,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
            status: "active",
            updateProgress: async () => {},
        };

        mockFetchExecute.mockResolvedValueOnce([job] as never).mockResolvedValueOnce([] as never);

        const testError = new Error("heartbeat error");
        mockExtendLock.mockRejectedValueOnce(testError as never);

        processor.mockImplementation(async () => {
            return new Promise((resolve) => setTimeout(resolve, 50));
        });

        const worker = new Worker("test-queue", processor, mockKodiak, {
            heartbeatEnabled: true,
            heartbeatInterval: 10,
            lockDuration: 100,
            concurrency: 1,
        });

        const errorEmitter = jest.fn();
        worker.on("error", errorEmitter);

        await worker.start();

        await new Promise((resolve) => setTimeout(resolve, 120));


        await worker.stop();

        expect(errorEmitter).toHaveBeenCalledWith(testError);
    });
});
