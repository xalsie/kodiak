import { jest } from '@jest/globals';
import { UpdateJobProgressUseCase } from '../../src/application/use-cases/update-job-progress.use-case';
import type { IQueueRepository } from '../../src/domain/repositories/queue.repository';

describe('UpdateJobProgressUseCase', () => {
    let updateJobProgressUseCase: UpdateJobProgressUseCase<unknown>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<unknown>>;

    beforeEach(() => {
        mockQueueRepository = {
            add: jest.fn(),
            fetchNext: jest.fn(),
            markAsCompleted: jest.fn(),
            markAsFailed: jest.fn(),
            updateProgress: jest.fn<IQueueRepository<unknown>['updateProgress']>().mockResolvedValue(undefined),
        } as unknown as jest.Mocked<IQueueRepository<unknown>>;
        updateJobProgressUseCase = new UpdateJobProgressUseCase(mockQueueRepository);
    });

    it('should call updateProgress on the repository', async () => {
        await updateJobProgressUseCase.execute('job-123', 50);

        expect(mockQueueRepository.updateProgress).toHaveBeenCalledWith(
            'job-123',
            50
        );
    });
});
