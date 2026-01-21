import { jest } from "@jest/globals";
import { CompleteJobUseCase } from "../../src/application/use-cases/complete-job.use-case";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository";

describe("CompleteJobUseCase", () => {
    let completeJobUseCase: CompleteJobUseCase<unknown>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<unknown>>;

    beforeEach(() => {
        mockQueueRepository = {
            add: jest.fn(),
            fetchNext: jest.fn(),
            markAsCompleted: jest
                .fn<IQueueRepository<unknown>["markAsCompleted"]>()
                .mockResolvedValue(undefined),
            markAsFailed: jest.fn(),
            updateProgress: jest.fn(),
            fetchNextJobs: jest.fn(),
            promoteDelayedJobs: jest.fn(),
            recoverStalledJobs: jest.fn(),
        };
        completeJobUseCase = new CompleteJobUseCase(mockQueueRepository);
    });

    it("should call markAsCompleted on the repository", async () => {
        await completeJobUseCase.execute("job-123");

        expect(mockQueueRepository.markAsCompleted).toHaveBeenCalledWith(
            "job-123",
            expect.any(Date),
        );
    });

    it("should pass the current date to markAsCompleted", async () => {
        const beforeCall = new Date();
        await completeJobUseCase.execute("job-456");
        const afterCall = new Date();

        const calls = mockQueueRepository.markAsCompleted.mock.calls;
        const passedDate = calls[0][1] as Date;

        expect(passedDate.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
        expect(passedDate.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });
});
