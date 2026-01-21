import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { Redis } from "ioredis";
import type { Kodiak } from "../../src/presentation/kodiak.js";
import type { Job } from "../../src/domain/entities/job.entity.js";

const mockFetchExecute = jest.fn();
const mockCompleteExecute = jest.fn();
const mockFailExecute = jest.fn();

jest.unstable_mockModule("../../src/infrastructure/redis/redis-queue.repository.js", () => ({
    RedisQueueRepository: jest.fn().mockImplementation(() => ({
        updateProgress: jest.fn(),
        fetchNextJobs: jest.fn(),
    })),
}));

jest.unstable_mockModule("../../src/application/use-cases/fetch-jobs.use-case.js", () => ({
    FetchJobsUseCase: jest.fn().mockImplementation(() => ({
        execute: mockFetchExecute,
    })),
}));

jest.unstable_mockModule("../../src/application/use-cases/complete-job.use-case.js", () => ({
    CompleteJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockCompleteExecute,
    })),
}));

jest.unstable_mockModule("../../src/application/use-cases/fail-job.use-case.js", () => ({
    FailJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockFailExecute,
    })),
}));

const { Worker } = await import("../../src/presentation/worker.js");
const { FetchJobsUseCase } = await import("../../src/application/use-cases/fetch-jobs.use-case.js");
const { CompleteJobUseCase } =
    await import("../../src/application/use-cases/complete-job.use-case.js");
const { FailJobUseCase } = await import("../../src/application/use-cases/fail-job.use-case.js");

describe("Worker", () => {
    let mockKodiak: Kodiak;
    let processor: jest.MockedFunction<(job: unknown) => Promise<void>>;

    beforeEach(() => {
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

        (FetchJobsUseCase as unknown as jest.Mock).mockClear();
        (CompleteJobUseCase as unknown as jest.Mock).mockClear();
        (FailJobUseCase as unknown as jest.Mock).mockClear();

        mockFetchExecute.mockReset();
        mockFetchExecute.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return [];
        });

        mockCompleteExecute.mockReset();
        mockCompleteExecute.mockResolvedValue(undefined as never);

        mockFailExecute.mockReset();
        mockFailExecute.mockResolvedValue(undefined as never);
    });

    const createMockJob = (overrides: Partial<Job<unknown>> = {}): Job<unknown> => ({
        id: "job-123",
        data: {},
        status: "active",
        priority: 0,
        addedAt: new Date(),
        retryCount: 0,
        maxAttempts: 3,
        updateProgress: async () => Promise.resolve(),
        ...overrides,
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("should create a worker instance", () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        expect(worker.name).toBe("test-queue");
    });

    it("should emit start event when started", async () => {
        jest.useFakeTimers();
        const worker = new Worker("test-queue", processor, mockKodiak);
        const startEmitter = jest.fn();
        worker.on("start", startEmitter);

        await worker.start();
        await jest.advanceTimersByTimeAsync(100);

        expect(startEmitter).toHaveBeenCalled();

        await worker.stop();
    });

    it("should emit stop event when stopped", async () => {
        jest.useFakeTimers();
        const worker = new Worker("test-queue", processor, mockKodiak);
        const stopEmitter = jest.fn();
        worker.on("stop", stopEmitter);

        await worker.start();
        await jest.advanceTimersByTimeAsync(100);
        await worker.stop();

        expect(stopEmitter).toHaveBeenCalled();
    });

    it("should process a job and emit completed event on success", async () => {
        const worker = new Worker<{ message: string }>("test-queue", processor, mockKodiak);
        const completedEmitter = jest.fn();
        worker.on("completed", completedEmitter);

        const mockJob = createMockJob({
            data: { message: "test" },
            priority: 10,
        });

        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        processor.mockResolvedValue(undefined);

        await worker.start();

        await new Promise(process.nextTick);
        await new Promise(process.nextTick);

        expect(processor).toHaveBeenCalledWith(mockJob);

        expect(mockCompleteExecute).toHaveBeenCalledWith(mockJob.id);
        expect(completedEmitter).toHaveBeenCalledWith(mockJob);

        await worker.stop();
    });

    it("should process a job and emit failed event on error", async () => {
        const worker = new Worker<{ message: string }>("test-queue", processor, mockKodiak);
        const failedEmitter = jest.fn();
        worker.on("failed", failedEmitter);

        const mockJob = createMockJob({
            data: { message: "test" },
            priority: 10,
        });

        const testError = new Error("Processing failed");

        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        processor.mockRejectedValue(testError);

        await worker.start();

        await new Promise(process.nextTick);
        await new Promise(process.nextTick);

        expect(processor).toHaveBeenCalledWith(mockJob);

        expect(mockFailExecute).toHaveBeenCalledWith(mockJob, testError);
        expect(failedEmitter).toHaveBeenCalledWith(mockJob, testError);

        await worker.stop();
    });

    it("should throw error if started while already running", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        await worker.start();

        await expect(worker.start()).rejects.toThrow("Worker \"test-queue\" is already running");

        await worker.stop();
    });

    it("should respect semaphore concurrency (prefetch logic)", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak, {
            concurrency: 1,
            prefetch: 1,
        });

        const job1 = createMockJob({
            id: "job-1",
            data: { id: 1 },
            priority: 10,
        });
        const job2 = createMockJob({
            id: "job-2",
            data: { id: 2 },
            priority: 10,
        });

        mockFetchExecute
            .mockResolvedValueOnce([job1] as never)
            .mockResolvedValueOnce([job2] as never);

        let releaseJob1: (value: void) => void = () => {};
        const job1Blocker = new Promise<void>((resolve) => {
            releaseJob1 = resolve;
        });

        processor.mockImplementation(async (job: unknown) => {
            const j = job as Job<{ id: number }>;
            if (j?.data?.id === 1) {
                await job1Blocker;
            }
        });

        await worker.start();

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(processor).toHaveBeenCalledWith(job1);
        expect(processor).not.toHaveBeenCalledWith(job2);

        releaseJob1();

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(processor).toHaveBeenCalledWith(job2);

        await worker.stop();
    });

    it("should handle non-Error objects thrown by processor", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        const failedEmitter = jest.fn();
        worker.on("failed", failedEmitter);

        const mockJob = createMockJob({
            id: "job-string-error",
            data: { message: "test" },
            priority: 10,
        });

        const stringError = "I am not an Error object";

        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        processor.mockRejectedValue(stringError);

        await worker.start();

        await new Promise(process.nextTick);
        await new Promise(process.nextTick);

        expect(mockFailExecute).toHaveBeenCalledWith(
            mockJob,
            expect.objectContaining({ message: stringError }),
        );
        expect(failedEmitter).toHaveBeenCalledWith(
            mockJob,
            expect.objectContaining({ message: stringError }),
        );

        await worker.stop();
    });

    it("should update progress and emit progress event", async () => {
        const progressEmitter = jest.fn();
        const mockJob = createMockJob({
            id: "job-progress",
            data: { message: "test" },
            priority: 10,
        });

        const processorWithProgress = jest.fn().mockImplementation(async (job: unknown) => {
            const j = job as Job<{ message: string }>;
            if (j.updateProgress) {
                await j.updateProgress(50);
            }
        }) as jest.MockedFunction<(job: unknown) => Promise<void>>;

        const worker = new Worker<{ message: string }>(
            "test-queue",
            processorWithProgress,
            mockKodiak,
        );
        worker.on("progress", progressEmitter);

        mockFetchExecute.mockResolvedValueOnce([mockJob] as never);

        await worker.start();

        await new Promise(process.nextTick);
        await new Promise(process.nextTick);

        expect(processorWithProgress).toHaveBeenCalledWith(mockJob);
        expect(progressEmitter).toHaveBeenCalledWith(mockJob, 50);

        await worker.stop();
    });

    it("should handle graceful shutdown timeout", async () => {
        jest.useFakeTimers();
        const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const worker = new Worker("test-queue", processor, mockKodiak, {
            gracefulShutdownTimeout: 10,
        });

        const mockJob = createMockJob();
        mockFetchExecute.mockResolvedValueOnce([mockJob] as never);

        processor.mockImplementation(async () => {
            return new Promise((resolve) => setTimeout(resolve, 200));
        });

        await worker.start();
        await jest.advanceTimersByTimeAsync(50);
        await worker.stop();

        expect(consoleSpy).toHaveBeenCalledWith(
            "[Worker] Graceful shutdown failed:",
            expect.any(Error),
        );

        consoleSpy.mockRestore();
    });

    it("should handle errors during Redis connection disconnect", async () => {
        const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const disconnectError = new Error("Disconnect failed");

        const mockRedisConnection = {
            duplicate: jest.fn().mockReturnThis(),
            disconnect: jest.fn().mockImplementation(() => {
                throw disconnectError;
            }),
        };

        (mockKodiak as any).connection = mockRedisConnection as unknown as Redis;

        const worker = new Worker("test-queue", processor, mockKodiak);

        await worker.start();
        await worker.stop();

        expect(consoleSpy).toHaveBeenCalledWith(
            "Error during blocking connection disconnect:",
            disconnectError,
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            "Error during ack connection disconnect:",
            disconnectError,
        );

        consoleSpy.mockRestore();
    });

    it("should emit error if getJob fails", async () => {
        jest.useFakeTimers();
        const errorEmitter = jest.fn();
        const testError = new Error("Fetch failed");
        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("error", errorEmitter);
        mockFetchExecute.mockRejectedValueOnce(testError as never);

        await worker.start();
        await jest.advanceTimersByTimeAsync(100);
        expect(errorEmitter).toHaveBeenCalledWith(testError);
        await worker.stop();
    });

    it("should get job from buffer after lock", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        const job1 = createMockJob({ id: "j1" });
        const job2 = createMockJob({ id: "j2" });

        // @ts-expect-error - Accès privé pour le test
        const bufferLock = worker.bufferLock as {
            acquire: () => Promise<void>;
            release: () => void;
            waiters: unknown[];
        };

        // @ts-expect-error - Accès privé pour le test
        worker.jobBuffer = [job1];

        await bufferLock.acquire();

        // @ts-expect-error - Accès privé pour le test
        const getJobPromise = worker.getJob();

        // @ts-expect-error - Accès privé pour le test
        worker.jobBuffer.push(job2);
        bufferLock.release();

        const result = await getJobPromise;

        expect(result?.id).toBe("j1");

        await worker.stop();
    });

    it("should get job from buffer if available before fetching", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        const jobInBuffer = createMockJob({ id: "buffered-job" });

        // @ts-expect-error - Accès privé pour le test
        worker.jobBuffer = [jobInBuffer];

        const getJobResult = await (worker as any).getJob();
        expect(getJobResult?.id).toBe("buffered-job");
        await worker.stop();
    });

    it("should handle error during ack connection disconnect", async () => {
        const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const disconnectError = new Error("ACK Disconnect failed");

        const mockAckConnection = {
            disconnect: jest.fn(() => {
                throw disconnectError;
            }),
        };
        const mockBlockingConnection = { disconnect: jest.fn() };
        (mockKodiak.connection.duplicate as jest.Mock)
            .mockReturnValueOnce(mockAckConnection)
            .mockReturnValueOnce(mockBlockingConnection);

        const worker = new Worker("test-queue", processor, mockKodiak);
        await worker.stop();

        expect(consoleSpy).toHaveBeenCalledWith(
            "Error during ack connection disconnect:",
            disconnectError,
        );
        expect(consoleSpy).not.toHaveBeenCalledWith(
            "Error during blocking connection disconnect:",
            expect.any(Error),
        );

        consoleSpy.mockRestore();
    });

    it("should return null if job from buffer is falsy", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);

        // @ts-expect-error - Pushing undefined to test falsy path
        worker.jobBuffer = [undefined];

        const job = await (worker as any).getJob();
        expect(job).toBeNull();

        await worker.stop();
    });

    it("should ignore non-Error objects thrown in main process loop", async () => {
        const errorEmitter = jest.fn();
        const nonError = "some string error";

        mockFetchExecute.mockRejectedValueOnce(nonError as never);

        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("error", errorEmitter);

        await worker.start();

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(errorEmitter).not.toHaveBeenCalled();

        await worker.stop();
    });
});
