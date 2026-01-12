import { FailJobUseCase } from '../../src/application/use-cases/fail-job.use-case';
import type { IQueueRepository } from '../../src/domain/repositories/queue.repository';

describe('FailJobUseCase', () => {
    let failJobUseCase: FailJobUseCase<unknown>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<unknown>>;

    beforeEach(() => {
        mockQueueRepository = {
            add: jest.fn(),
            fetchNext: jest.fn(),
            markAsCompleted: jest.fn(),
            markAsFailed: jest.fn().mockResolvedValue(undefined),
        };
        failJobUseCase = new FailJobUseCase(mockQueueRepository);
    });

    it('should call markAsFailed on the repository', async () => {
        const error = new Error('Job processing failed');
        await failJobUseCase.execute('job-123', error);

        expect(mockQueueRepository.markAsFailed).toHaveBeenCalledWith(
            'job-123',
            'Job processing failed',
            expect.any(Date),
        );
    });

    it('should extract error message from Error object', async () => {
        const error = new Error('Custom error message');
        await failJobUseCase.execute('job-456', error);

        const calls = mockQueueRepository.markAsFailed.mock.calls;
        expect(calls[0][1]).toBe('Custom error message');
    });

    it('should pass the current date to markAsFailed', async () => {
        const error = new Error('Test error');
        const beforeCall = new Date();
        await failJobUseCase.execute('job-789', error);
        const afterCall = new Date();

        const calls = mockQueueRepository.markAsFailed.mock.calls;
        const passedDate = calls[0][2] as Date;

        expect(passedDate.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
        expect(passedDate.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });
});
