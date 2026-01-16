import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { FailJobUseCase } from '../../src/application/use-cases/fail-job.use-case.js';
import type { IQueueRepository } from '../../src/domain/repositories/queue.repository.js';
import type { Job } from '../../src/domain/entities/job.entity.js';

describe('FailJobUseCase', () => {
    let failJobUseCase: FailJobUseCase<unknown>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<unknown>>;

    beforeEach(() => {
        mockQueueRepository = {
            add: jest.fn(),
            fetchNext: jest.fn(),
            markAsCompleted: jest.fn(),
            markAsFailed: jest.fn<IQueueRepository<unknown>['markAsFailed']>().mockResolvedValue(undefined),
        };
        failJobUseCase = new FailJobUseCase(mockQueueRepository);
    });

    const createMockJob = (overrides: Partial<Job<unknown>> = {}): Job<unknown> => ({
        id: 'job-123',
        data: {},
        status: 'active',
        priority: 0,
        addedAt: new Date(),
        retryCount: 0,
        maxAttempts: 3,
        ...overrides,
    });

    it('should call markAsFailed on the repository without nextAttempt when no backoff configured', async () => {
        const job = createMockJob();
        const error = new Error('Job processing failed');
        
        await failJobUseCase.execute(job.id, error);

        expect(mockQueueRepository.markAsFailed).toHaveBeenCalledWith(
            job.id,
            'Job processing failed',
            expect.any(Date)
        );
    });

    it('should calculate fixed backoff correctly', async () => {
        const job = createMockJob({
            retryCount: 0,
            backoff: { type: 'fixed', delay: 1000 }
        });
        const error = new Error('Error');
        
        const now = Date.now();
        jest.useFakeTimers({ now });

        await failJobUseCase.execute(job.id, error);

        expect(mockQueueRepository.markAsFailed).toHaveBeenCalledWith(
            job.id,
            error.message,
            expect.any(Date)
        );

        jest.useRealTimers();
    });

    it('should calculate exponential backoff correctly', async () => {
        // Retry 1 (attemptsMade = 1): 1000 * 2^0 = 1000
        const job1 = createMockJob({ retryCount: 0, backoff: { type: 'exponential', delay: 1000 } });
        // Retry 2 (attemptsMade = 2): 1000 * 2^1 = 2000
        const job2 = createMockJob({ retryCount: 1, backoff: { type: 'exponential', delay: 1000 } });
        // Retry 3 (attemptsMade = 3): 1000 * 2^2 = 4000
        const job3 = createMockJob({ retryCount: 2, backoff: { type: 'exponential', delay: 1000 } });

        const now = Date.now();
        jest.useFakeTimers({ now });

        await failJobUseCase.execute(job1.id, new Error('E1'));
        expect(mockQueueRepository.markAsFailed).toHaveBeenLastCalledWith(
            job1.id, 'E1', expect.any(Date)
        );

        await failJobUseCase.execute(job2.id, new Error('E2'));
        expect(mockQueueRepository.markAsFailed).toHaveBeenLastCalledWith(
            job2.id, 'E2', expect.any(Date)
        );

        await failJobUseCase.execute(job3.id, new Error('E3'));
        expect(mockQueueRepository.markAsFailed).toHaveBeenLastCalledWith(
            job3.id, 'E3', expect.any(Date)
        );

        jest.useRealTimers();
    });
});
