import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Redis } from "ioredis";
import type { Job } from "../../src/domain/entities/job.entity.js";

jest.unstable_mockModule("fs", () => ({
    readFileSync: jest.fn().mockReturnValue("return 1"),
    default: {
        readFileSync: jest.fn().mockReturnValue("return 1"),
    },
}));

const { RedisQueueRepository } =
    await import("../../src/infrastructure/redis/redis-queue.repository.js");

describe("Unit: RedisQueueRepository", () => {
    let repository: InstanceType<typeof RedisQueueRepository>;
    let mockRedis: Redis;
    let mockPipeline: Record<string, jest.Mock>;

    beforeEach(() => {
        mockPipeline = {
            hset: jest.fn().mockReturnThis(),
            hgetall: jest.fn().mockReturnThis(),
            lrem: jest.fn().mockReturnThis(),
            hincrby: jest.fn().mockReturnThis(),
            exec: jest.fn(),
        };

        mockRedis = {
            eval: jest.fn(),
            pipeline: jest.fn().mockReturnValue(mockPipeline),
        } as unknown as Redis;

        repository = new RedisQueueRepository("test-queue", mockRedis, "kodiak-test");
        jest.clearAllMocks();
    });

    it("should return null if pipeline execution returns null", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue("job-123" as never);

        (mockPipeline.exec as jest.Mock).mockResolvedValue(null as never);

        const result = await repository.fetchNext();

        expect(result).toBeNull();
    });

    it("should return null if brpop times out", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(null as never);
        const brpopMock = jest.fn().mockResolvedValue(null as never);
        mockRedis.brpop = brpopMock as Redis["brpop"];

        const result = await repository.fetchNext(2);

        expect(brpopMock).toHaveBeenCalledWith(expect.stringContaining(":notify"), 2);
        expect(result).toBeNull();
    });

    it("should ignore timeout if <= 0", async () => {
        await repository.fetchNext(0);
        expect(mockRedis.eval).toHaveBeenCalled();
    });

    it("should use Lua script to mark job as completed", async () => {
        const jobId = "job-123";
        const completedAt = new Date();

        await repository.markAsCompleted(jobId, completedAt);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            3,
            expect.stringContaining(":active"),
            expect.stringContaining(`:jobs:${jobId}`),
            expect.stringContaining(":delayed"),
            jobId,
            String(completedAt.getTime()),
        );
    });

    it("should use Lua script to mark job as failed", async () => {
        const jobId = "job-456";
        const failedAt = new Date();
        const errorMsg = "Oops";

        await repository.markAsFailed(jobId, errorMsg, failedAt);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            3,
            expect.stringContaining(":active"),
            expect.stringContaining(`:jobs:${jobId}`),
            expect.stringContaining(":delayed"),
            jobId,
            errorMsg,
            String(failedAt.getTime()),
            "-1",
        );
    });

    it("should pass backoff options to Lua script when adding a job", async () => {
        const job: Job<{ foo: string }> = {
            id: "job-with-backoff",
            data: { foo: "bar" },
            priority: 1,
            retryCount: 0,
            maxAttempts: 3,
            addedAt: new Date(),
            status: "waiting" as const,
            backoff: {
                type: "exponential" as const,
                delay: 5000,
            },
            updateProgress: async () => Promise.resolve(),
        };

        await repository.add(job, 1, false);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            4,
            expect.stringContaining(":waiting"),
            expect.stringContaining(":delayed"),
            expect.stringContaining(`:jobs:${job.id}`),
            expect.stringContaining(":notify"),
            job.id,
            "1",
            "0",
            "data",
            JSON.stringify(job.data),
            "priority",
            String(job.priority),
            "retry_count",
            String(job.retryCount),
            "max_attempts",
            String(job.maxAttempts),
            "added_at",
            String(job.addedAt.getTime()),
            "backoff_type",
            "exponential",
            "backoff_delay",
            "5000",
        );
    });

    it("should call promoteDelayedJobs Lua script", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(5 as never);

        const count = await repository.promoteDelayedJobs(100);

        expect(count).toBe(5);
        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            4,
            expect.stringContaining(":delayed"),
            expect.stringContaining(":waiting"),
            expect.stringContaining(":notify"),
            expect.stringContaining(":jobs:"),
            expect.any(String),
            "100",
        );
    });

    it("should pass repeat options to Lua script when adding a job", async () => {
        const job: Job<{ foo: string }> = {
            id: "job-with-repeat",
            data: { foo: "bar" },
            priority: 1,
            retryCount: 0,
            maxAttempts: 3,
            addedAt: new Date(),
            status: "waiting" as const,
            repeat: {
                every: 60000,
                count: 0,
            },
            updateProgress: async () => Promise.resolve(),
        };

        await repository.add(job, 1, false);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            4,
            expect.stringContaining(":waiting"),
            expect.stringContaining(":delayed"),
            expect.stringContaining(`:jobs:${job.id}`),
            expect.stringContaining(":notify"),
            job.id,
            "1",
            "0",
            "data",
            JSON.stringify(job.data),
            "priority",
            String(job.priority),
            "retry_count",
            String(job.retryCount),
            "max_attempts",
            String(job.maxAttempts),
            "added_at",
            String(job.addedAt.getTime()),
            "repeat_every",
            "60000",
            "repeat_count",
            "0",
        );
    });

    it("should pass repeat options with limit to Lua script when adding a job", async () => {
        const job: Job<{ foo: string }> = {
            id: "job-with-repeat-limit",
            data: { foo: "bar" },
            priority: 1,
            retryCount: 0,
            maxAttempts: 3,
            addedAt: new Date(),
            status: "waiting" as const,
            repeat: {
                every: 60000,
                count: 0,
                limit: 10,
            },
            updateProgress: async () => Promise.resolve(),
        };

        await repository.add(job, 1, false);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            4,
            expect.stringContaining(":waiting"),
            expect.stringContaining(":delayed"),
            expect.stringContaining(`:jobs:${job.id}`),
            expect.stringContaining(":notify"),
            job.id,
            "1",
            "0",
            "data",
            JSON.stringify(job.data),
            "priority",
            String(job.priority),
            "retry_count",
            String(job.retryCount),
            "max_attempts",
            String(job.maxAttempts),
            "added_at",
            String(job.addedAt.getTime()),
            "repeat_every",
            "60000",
            "repeat_count",
            "0",
            "repeat_limit",
            "10",
        );
    });

    it("should call recoverStalledJobs Lua script", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(["job-1", "job-2"] as never);

        const recoveredJobs = await repository.recoverStalledJobs();

        expect(recoveredJobs).toEqual(["job-1", "job-2"]);
        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            2,
            expect.stringContaining(":active"),
            expect.stringContaining(":waiting"),
            expect.any(String),
        );
    });

    it("should call updateProgress Lua script", async () => {
        const jobId = "job-123";
        const progress = 50;

        await repository.updateProgress(jobId, progress);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            1,
            expect.stringContaining(`:jobs:${jobId}`),
            "50",
        );
    });

    it("should fetch multiple jobs with fetchNextJobs", async () => {
        const jobIds = ["job-1", "job-2"];
        const jobData1 = {
            data: JSON.stringify({ message: "test1" }),
            priority: "1",
            retry_count: "0",
            max_attempts: "3",
            added_at: String(Date.now()),
            state: "active",
        };
        const jobData2 = {
            data: JSON.stringify({ message: "test2" }),
            priority: "2",
            retry_count: "0",
            max_attempts: "3",
            added_at: String(Date.now()),
            state: "active",
        };

        (mockRedis.eval as jest.Mock).mockResolvedValue(jobIds as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [null, jobData1],
            [null, "OK"],
            [null, jobData2],
        ] as never);

        const jobs = await repository.fetchNextJobs(2, 30000);

        expect(jobs).toHaveLength(2);
        expect(jobs[0].id).toBe("job-1");
        expect(jobs[1].id).toBe("job-2");
        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            2,
            expect.stringContaining(":waiting"),
            expect.stringContaining(":active"),
            "2",
            expect.any(String),
        );
    });

    it("should return empty array when fetchNextJobs returns no job ids", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue([] as never);

        const jobs = await repository.fetchNextJobs(10, 30000);

        expect(jobs).toEqual([]);
    });

    it("should return empty array when fetchNextJobs pipeline returns null", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(["job-1"] as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue(null as never);

        const jobs = await repository.fetchNextJobs(1, 30000);

        expect(jobs).toEqual([]);
    });

    it("should skip jobs with errors in fetchNextJobs", async () => {
        const jobIds = ["job-1", "job-2"];
        const jobData2 = {
            data: JSON.stringify({ message: "test2" }),
            priority: "2",
            retry_count: "0",
            max_attempts: "3",
            added_at: String(Date.now()),
            state: "active",
        };

        (mockRedis.eval as jest.Mock).mockResolvedValue(jobIds as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [new Error("Redis error"), null],
            [null, "OK"],
            [null, jobData2],
        ] as never);

        const jobs = await repository.fetchNextJobs(2, 30000);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].id).toBe("job-2");
    });

    it("should skip jobs with missing data in fetchNextJobs", async () => {
        const jobIds = ["job-1", "job-2"];
        const invalidJobData = {
            priority: "1",
            retry_count: "0",
            max_attempts: "3",
            added_at: String(Date.now()),
            state: "active",
        };
        const jobData2 = {
            data: JSON.stringify({ message: "test2" }),
            priority: "2",
            retry_count: "0",
            max_attempts: "3",
            added_at: String(Date.now()),
            state: "active",
        };

        (mockRedis.eval as jest.Mock).mockResolvedValue(jobIds as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [null, invalidJobData],
            [null, "OK"],
            [null, jobData2],
        ] as never);

        const jobs = await repository.fetchNextJobs(2, 30000);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].id).toBe("job-2");
    });

    it("should call updateProgress when job.updateProgress is called", async () => {
        const jobIds = ["job-1"];
        const jobData = {
            data: JSON.stringify({ message: "test" }),
            priority: "1",
            retry_count: "0",
            max_attempts: "3",
            added_at: String(Date.now()),
            state: "active",
        };

        (mockRedis.eval as jest.Mock).mockResolvedValue(jobIds as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [null, jobData],
        ] as never);

        const jobs = await repository.fetchNextJobs(1, 30000);

        expect(jobs).toHaveLength(1);

        (mockRedis.eval as jest.Mock).mockClear();

        await jobs[0].updateProgress(75);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            1,
            expect.stringContaining(":jobs:job-1"),
            "75",
        );
    });

    it("should handle fetchNext with brpop returning a result", async () => {
        const jobData = {
            data: JSON.stringify({ message: "test" }),
            priority: "1",
            retry_count: "0",
            max_attempts: "3",
            added_at: String(Date.now()),
            state: "active",
        };

        (mockRedis.eval as jest.Mock)
            .mockResolvedValueOnce(null as never)
            .mockResolvedValueOnce(["job-1", Object.entries(jobData).flat()] as never);

        const brpopMock = jest.fn().mockResolvedValue(["notify-key", "job-1"] as never);
        mockRedis.brpop = brpopMock as Redis["brpop"];

        const result = await repository.fetchNext(5);

        expect(result).not.toBeNull();
        expect(result?.id).toBe("job-1");
        expect(brpopMock).toHaveBeenCalledWith(expect.stringContaining(":notify"), 5);
    });

    it("should handle fetchNext with optimistic result", async () => {
        const jobData = {
            data: JSON.stringify({ message: "test" }),
            priority: "1",
            retry_count: "0",
            max_attempts: "3",
            added_at: String(Date.now()),
            state: "active",
        };

        (mockRedis.eval as jest.Mock).mockResolvedValue([
            "job-1",
            Object.entries(jobData).flat(),
        ] as never);

        const result = await repository.fetchNext();

        expect(result).not.toBeNull();
        expect(result?.id).toBe("job-1");
    });

    it("should return null when brpop succeeds but second eval returns null", async () => {
        (mockRedis.eval as jest.Mock)
            .mockResolvedValueOnce(null as never)
            .mockResolvedValueOnce(null as never);

        const brpopMock = jest.fn().mockResolvedValue(["notify-key", "job-1"] as never);
        mockRedis.brpop = brpopMock as Redis["brpop"];

        const result = await repository.fetchNext(5);

        expect(result).toBeNull();
        expect(brpopMock).toHaveBeenCalledWith(expect.stringContaining(":notify"), 5);
        expect(mockRedis.eval).toHaveBeenCalledTimes(2);
    });

    it("should handle fetchNext when rawData is not present", async () => {
        const jobId = "job-1";
        (mockRedis.eval as jest.Mock).mockResolvedValue([jobId, null] as never);
        const jobData = { data: JSON.stringify({ message: "test" }), priority: "1" };
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [null, jobData],
        ] as never);
        const job = await repository.fetchNext();
        expect(job?.id).toBe(jobId);
    });

    it("should return null in processFetchResult if pipeline exec returns null (when no rawData)", async () => {
        const jobId = "job-no-rawdata-no-exec";
        (mockRedis.eval as jest.Mock).mockResolvedValue([jobId, null] as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue(null as never);

        const job = await repository.fetchNext();
        expect(job).toBeNull();
    });

    it("should use existing progress if present in job data", async () => {
        const jobIds = ["job-with-progress"];
        const jobData = {
            data: JSON.stringify({ message: "test" }),
            priority: "1",
            progress: "50",
            state: "active",
        };
        (mockRedis.eval as jest.Mock).mockResolvedValue(jobIds as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [null, jobData],
        ] as never);

        const jobs = await repository.fetchNextJobs(1, 30000);
        expect(jobs).toHaveLength(1);
        expect(jobs[0].progress).toBe(50);
    });

    it("should return empty array when recoverStalledJobs Lua script returns null", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(null as never);
        const recoveredJobs = await repository.recoverStalledJobs();
        expect(recoveredJobs).toEqual([]);
    });

    it("should return 0 when promoteDelayedJobs Lua script returns null", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(null as never);
        const count = await repository.promoteDelayedJobs(50);
        expect(count).toBe(0);
    });

    it("should pass isDelayed=true to Lua script when adding a delayed job", async () => {
        const job: Job<{ foo: string }> = {
            id: "delayed-job",
            data: { foo: "bar" },
            priority: 1,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
            status: "delayed",
            updateProgress: async () => {},
        };

        await repository.add(job, Date.now() + 5000, true);

        const mockCall = (mockRedis.eval as jest.Mock).mock.calls[0];

        expect(mockCall[8]).toBe("1");
    });

    it("should use existing started_at if present in job data when fetching multiple jobs", async () => {
        const jobIds = ["job-1"];
        const startedAt = new Date(Date.now() - 1000);
        const jobDataWithStartedAt = {
            data: JSON.stringify({ message: "test" }),
            priority: "5",
            retry_count: "1",
            max_attempts: "3",
            added_at: String(Date.now()),
            state: "active",
            started_at: String(startedAt.getTime()),
        };

        (mockRedis.eval as jest.Mock).mockResolvedValue(jobIds as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [null, jobDataWithStartedAt],
        ] as never);

        const jobs = await repository.fetchNextJobs(1, 30000);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].startedAt?.getTime()).toBe(startedAt.getTime());
    });

    it("should pass nextAttempt timestamp to Lua script when provided in markAsFailed", async () => {
        const jobId = "job-789";
        const failedAt = new Date();
        const nextAttempt = new Date(failedAt.getTime() + 5000);
        const errorMsg = "Retry scheduled";

        await repository.markAsFailed(jobId, errorMsg, failedAt, nextAttempt);

        expect((mockRedis.eval as jest.Mock).mock.calls[0]).toEqual(
            expect.arrayContaining([
                expect.any(String),
                3,
                expect.stringContaining(":active"),
                expect.stringContaining(`:jobs:${jobId}`),
                expect.stringContaining(":delayed"),
                jobId,
                errorMsg,
                String(failedAt.getTime()),
                String(nextAttempt.getTime()),
            ]),
        );
    });

    it("should use default limit when promoting delayed jobs with no arg", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(7 as never);
        const count = await repository.promoteDelayedJobs();
        expect(count).toBe(7);
        expect((mockRedis.eval as jest.Mock).mock.calls[0][7]).toBe("50");
    });

    it("should return null in processFetchResult if hgetall returns an error (when no rawData)", async () => {
        const jobId = "job-hgetall-error";
        (mockRedis.eval as jest.Mock).mockResolvedValue([jobId, null] as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [new Error("HGETALL failed"), null],
        ] as never);

        const job = await repository.fetchNext();
        expect(job).toBeNull();
    });
});
