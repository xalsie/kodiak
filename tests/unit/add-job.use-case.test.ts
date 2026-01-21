import { jest } from "@jest/globals";
import { AddJobUseCase } from "../../src/application/use-cases/add-job.use-case";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository";

// Score calculation multiplier from AddJobUseCase implementation
const PRIORITY_MULTIPLIER = 10000000000000;

describe("AddJobUseCase", () => {
    let addJobUseCase: AddJobUseCase<{ message: string }>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<{ message: string }>>;

    beforeEach(() => {
        mockQueueRepository = {
            add: jest
                .fn<IQueueRepository<{ message: string }>["add"]>()
                .mockResolvedValue(undefined),
            fetchNext: jest.fn(),
            markAsCompleted: jest.fn(),
            markAsFailed: jest.fn(),
            updateProgress: jest
                .fn<IQueueRepository<unknown>["updateProgress"]>()
                .mockResolvedValue(undefined),
            fetchNextJobs: jest.fn(),
            promoteDelayedJobs: jest.fn(),
            recoverStalledJobs: jest.fn(),
        };
        addJobUseCase = new AddJobUseCase(mockQueueRepository);
    });

    it("should create a job with default options and add to repository", async () => {
        const id = "job-123";
        const data = { message: "test message" };

        const result = await addJobUseCase.execute(id, data);

        expect(mockQueueRepository.add).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            id,
            data,
            status: "waiting",
            priority: 10,
            retryCount: 0,
            maxAttempts: 1,
        });
        expect(result.addedAt).toBeInstanceOf(Date);
    });

    it("should create a job with custom priority", async () => {
        const id = "job-456";
        const data = { message: "high priority" };
        const options = { priority: 1 };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.priority).toBe(1);
        expect(result.status).toBe("waiting");
    });

    it("should create a delayed job when delay option is provided", async () => {
        const id = "job-789";
        const data = { message: "delayed job" };
        const options = { delay: 5000 };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.status).toBe("delayed");
        expect(mockQueueRepository.add).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Number),
            true,
        );
    });

    it("should create a delayed job when waitUntil option is provided", async () => {
        const id = "job-abc";
        const data = { message: "wait until job" };
        const futureDate = new Date(Date.now() + 10000);
        const options = { waitUntil: futureDate };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.status).toBe("delayed");
        expect(mockQueueRepository.add).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Number),
            true,
        );
    });

    it("should set maxAttempts from options", async () => {
        const id = "job-def";
        const data = { message: "retry job" };
        const options = { attempts: 5 };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.maxAttempts).toBe(5);
    });

    it("should calculate score based on priority and timestamp", async () => {
        const id = "job-ghi";
        const data = { message: "score test" };
        const options = { priority: 2 };

        const beforeCall = Date.now();
        await addJobUseCase.execute(id, data, options);
        const afterCall = Date.now();

        const minExpectedScore = 2 * PRIORITY_MULTIPLIER + beforeCall;
        const maxExpectedScore = 2 * PRIORITY_MULTIPLIER + afterCall;

        expect(mockQueueRepository.add).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Number),
            false,
        );

        const [, actualScore] = mockQueueRepository.add.mock.calls[0];
        expect(actualScore).toBeGreaterThanOrEqual(minExpectedScore);
        expect(actualScore).toBeLessThanOrEqual(maxExpectedScore);
    });

    it("should calculate score with delay included", async () => {
        const id = "job-jkl";
        const data = { message: "delayed score test" };
        const delay = 5000;
        const options = { priority: 1, delay };

        const beforeCall = Date.now();
        await addJobUseCase.execute(id, data, options);
        const afterCall = Date.now();

        const minExpectedScore = 1 * PRIORITY_MULTIPLIER + beforeCall + delay;
        const maxExpectedScore = 1 * PRIORITY_MULTIPLIER + afterCall + delay;

        const [, actualScore] = mockQueueRepository.add.mock.calls[0];
        expect(actualScore).toBeGreaterThanOrEqual(minExpectedScore);
        expect(actualScore).toBeLessThanOrEqual(maxExpectedScore);
    });

    it("should ensure higher priority (lower number) has lower score", async () => {
        const data = { message: "priority comparison" };

        await addJobUseCase.execute("job-high", data, { priority: 1 });
        const highPriorityScore = mockQueueRepository.add.mock.calls[0][1] as number;

        await addJobUseCase.execute("job-low", data, { priority: 10 });
        const lowPriorityScore = mockQueueRepository.add.mock.calls[1][1] as number;

        expect(highPriorityScore).toBeLessThan(lowPriorityScore);
    });

    it("should ensure FIFO ordering within same priority", async () => {
        const data = { message: "fifo test" };
        const priority = 5;

        jest.useFakeTimers();
        const baseTime = Date.now();
        jest.setSystemTime(baseTime);

        await addJobUseCase.execute("job-first", data, { priority });
        const firstScore = mockQueueRepository.add.mock.calls[0][1] as number;

        jest.setSystemTime(baseTime + 10);

        await addJobUseCase.execute("job-second", data, { priority });
        const secondScore = mockQueueRepository.add.mock.calls[1][1] as number;

        expect(firstScore).toBeLessThan(secondScore);

        jest.useRealTimers();
    });

    it("should return the created job", async () => {
        const id = "job-return-test";
        const data = { message: "return test" };

        const result = await addJobUseCase.execute(id, data);

        expect(result.id).toBe(id);
        expect(result.data).toEqual(data);
        expect(result).toHaveProperty("addedAt");
        expect(result).toHaveProperty("status");
        expect(result).toHaveProperty("priority");
    });

    it("should include updateProgress function in created job", async () => {
        const id = "job-update-progress-test";
        const data = { message: "update progress test" };

        const result = await addJobUseCase.execute(id, data);

        expect(result.updateProgress).toBeDefined();
        expect(typeof result.updateProgress).toBe("function");
        await expect(result.updateProgress(100)).resolves.toBeUndefined();
    });

    it("should include backoff strategy when provided", async () => {
        const id = "job-backoff-test";
        const data = { message: "backoff test" };
        const backoff = { type: "exponential" as const, delay: 1000 };
        const options = { backoff };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.backoff).toEqual(backoff);
    });
});
