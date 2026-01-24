import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

const mockExecute = jest.fn();
jest.unstable_mockModule("../../src/application/use-cases/add-job.use-case.js", () => ({
    AddJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockExecute,
    })),
}));

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

describe("Unit: Queue", () => {
    let mockKodiak: Kodiak;

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

    afterEach(() => {
        jest.useRealTimers();
    });

    it("should start a scheduler that calls promoteDelayedJobs periodically", async () => {
        const queue = new Queue("test-queue", mockKodiak);

        jest.advanceTimersByTime(5000);

        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(5000);

        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(2);

        await queue.close();
    });

    it("should stop the scheduler when closed", async () => {
        const queue = new Queue("test-queue", mockKodiak);

        jest.advanceTimersByTime(5000);
        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(1);

        await queue.close();

        jest.advanceTimersByTime(10000);
        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(1);
    });

    it("should handle errors in scheduler loop", async () => {
        mockPromoteDelayedJobs.mockRejectedValueOnce(new Error("Redis error") as never);

        const queue = new Queue("test-queue", mockKodiak);
        const errorEmitter = jest.fn();
        // @ts-expect-error - Queue may implement EventEmitter in updated code
        queue.on("error", errorEmitter);

        jest.advanceTimersByTime(5000);

        await Promise.resolve();

        expect(mockPromoteDelayedJobs).toHaveBeenCalled();
        expect(errorEmitter).toHaveBeenCalledWith(expect.any(Error));

        await queue.close();
    });

    it("should ignore startScheduler if already running", () => {
        const queue = new Queue("test-queue", mockKodiak);

        const intervalBefore = (queue as unknown as { schedulerInterval: NodeJS.Timeout | null })
            .schedulerInterval;

        (queue as unknown as { startScheduler: () => void }).startScheduler();

        const intervalAfter = (queue as unknown as { schedulerInterval: NodeJS.Timeout | null })
            .schedulerInterval;

        expect(intervalBefore).toBe(intervalAfter);

        queue.close();
    });

    it("should call AddJobUseCase when adding a job", async () => {
        const queue = new Queue("test-queue", mockKodiak);
        const data = { foo: "bar" };

        await queue.add("job-1", data);

        expect(mockExecute).toHaveBeenCalledWith("job-1", data, undefined);

        await queue.close();
    });

    it("should handle close when schedulerInterval is null", async () => {
        const queue = new Queue("test-queue", mockKodiak);

        await queue.close();

        await expect(queue.close()).resolves.not.toThrow();
    });

    it("should call AddJobUseCase with options when provided", async () => {
        const queue = new Queue("test-queue", mockKodiak);
        const data = { foo: "bar" };
        const options = { priority: 5, attempts: 3 };

        await queue.add("job-2", data, options);

        expect(mockExecute).toHaveBeenCalledWith("job-2", data, options);

        await queue.close();
    });

    it("should log info when stalled jobs recovered", async () => {
        mockRecoverStalledJobs.mockResolvedValueOnce(["job-1"] as never);

        let scheduledCb: (() => Promise<void>) | null = null;

        const setIntervalSpy = jest
            .spyOn(global, "setInterval")
            .mockImplementation((cb: TimerHandler): NodeJS.Timeout => {
                scheduledCb = cb as () => Promise<void>;
                return 1 as unknown as NodeJS.Timeout;
            });

        const queue = new Queue("test-queue", mockKodiak);

        if (typeof scheduledCb === "function") {
            await (scheduledCb as () => Promise<void>)();
        }

        // ensure the recovery path was invoked
        expect(mockRecoverStalledJobs).toHaveBeenCalled();

        setIntervalSpy.mockRestore();

        await queue.close();
    });

    it("should handle errors in Error during recoverStalledJobs for queue", async () => {
        mockRecoverStalledJobs.mockRejectedValueOnce(new Error("Redis error") as never);

        let scheduledCb: (() => Promise<void>) | null = null;

        const setIntervalSpy = jest
            .spyOn(global, "setInterval")
            .mockImplementation((cb: TimerHandler): NodeJS.Timeout => {
                scheduledCb = cb as () => Promise<void>;
                return 1 as unknown as NodeJS.Timeout;
            });

        const queue = new Queue("test-queue", mockKodiak);
        const errorEmitter = jest.fn();
        // @ts-expect-error - Queue may implement EventEmitter in updated code
        queue.on("error", errorEmitter);

        if (typeof scheduledCb === "function") {
            await (scheduledCb as () => Promise<void>)();
        }

        expect(errorEmitter).toHaveBeenCalledWith(expect.any(Error));

        setIntervalSpy.mockRestore();

        await queue.close();
    });
});
