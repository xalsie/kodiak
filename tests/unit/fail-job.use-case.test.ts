import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { FailJobUseCase } from '../../src/application/use-cases/fail-job.use-case.js';
import type { IQueueRepository } from '../../src/domain/repositories/queue.repository.js';
import type { Job } from '../../src/domain/entities/job.entity.js';
import { BackoffStrategy } from '../../src/domain/strategies/backoff.strategy.js';

describe('FailJobUseCase', () => {
    let failJobUseCase: FailJobUseCase<unknown>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<unknown>>;

    beforeEach(() => {
        mockQueueRepository = {
            add: jest.fn(),
            fetchNext: jest.fn(),
            markAsCompleted: jest.fn(),
            markAsFailed: jest.fn<IQueueRepository<unknown>['markAsFailed']>().mockResolvedValue(undefined),
            updateProgress: jest.fn<IQueueRepository<unknown>['updateProgress']>().mockResolvedValue(undefined),
            fetchNextJobs: jest.fn(),
            promoteDelayedJobs: jest.fn(),
            recoverStalledJobs: jest.fn(),
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
        updateProgress: async () => Promise.resolve(),
    });

    it('should call markAsFailed on the repository without nextAttempt when no backoff configured', async () => {
        const job = createMockJob();
        const error = new Error('Job processing failed');
        
        await failJobUseCase.execute(job, error);

        expect(mockQueueRepository.markAsFailed).toHaveBeenCalledWith(
            job.id,
            'Job processing failed',
            expect.any(Date),
            undefined
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

        await failJobUseCase.execute(job, error);

        expect(mockQueueRepository.markAsFailed).toHaveBeenCalledWith(
            job.id,
            error.message,
            expect.any(Date),
            new Date(now + 1000)
        );

        jest.useRealTimers();
    });

    it('should calculate exponential backoff correctly', async () => {
        const job1 = createMockJob({ retryCount: 0, backoff: { type: 'exponential', delay: 1000 } });
        const job2 = createMockJob({ retryCount: 1, backoff: { type: 'exponential', delay: 1000 } });
        const job3 = createMockJob({ retryCount: 2, backoff: { type: 'exponential', delay: 1000 } });

        const now = Date.now();
        jest.useFakeTimers({ now });

        await failJobUseCase.execute(job1, new Error('E1'));
        expect(mockQueueRepository.markAsFailed).toHaveBeenLastCalledWith(
            job1.id, 'E1', expect.any(Date), new Date(now + 1000)
        );

        await failJobUseCase.execute(job2, new Error('E2'));
        expect(mockQueueRepository.markAsFailed).toHaveBeenLastCalledWith(
            job2.id, 'E2', expect.any(Date), new Date(now + 2000)
        );

        await failJobUseCase.execute(job3, new Error('E3'));
        expect(mockQueueRepository.markAsFailed).toHaveBeenLastCalledWith(
            job3.id, 'E3', expect.any(Date), new Date(now + 4000)
        );

        jest.useRealTimers();
    });

    it('should use custom backoff strategy if provided', async () => {
        const customStrategy: BackoffStrategy = (attempts, delay) => {
            return delay * attempts * 10;
        };

        failJobUseCase = new FailJobUseCase(mockQueueRepository, {
            'custom-linear': customStrategy
        });

        const job = createMockJob({ 
            retryCount: 0, 
            backoff: { type: 'custom-linear', delay: 100 } 
        });

        const now = Date.now();
        jest.useFakeTimers({ now });

        await failJobUseCase.execute(job, new Error('E'));

        expect(mockQueueRepository.markAsFailed).toHaveBeenCalledWith(
            job.id,
            'E',
            expect.any(Date),
            new Date(now + 1000)
        );

        jest.useRealTimers();
    });

    it('should fallback to default behavior (no nextAttempt) if custom strategy not found', async () => {
        const job = createMockJob({ 
            retryCount: 0, 
            backoff: { type: 'unknown-strategy', delay: 100 } 
        });

        await failJobUseCase.execute(job, new Error('E'));

        expect(mockQueueRepository.markAsFailed).toHaveBeenCalledWith(
            job.id,
            'E',
            expect.any(Date),
            undefined
        );
    });
});
