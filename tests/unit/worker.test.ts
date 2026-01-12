import { Worker } from '../../src/presentation/worker';
import { Kodiak } from '../../src/presentation/kodiak';
import { FetchJobUseCase } from '../../src/application/use-cases/fetch-job.use-case';
import { CompleteJobUseCase } from '../../src/application/use-cases/complete-job.use-case';
import { FailJobUseCase } from '../../src/application/use-cases/fail-job.use-case';
import type { Job } from '../../src/domain/entities/job.entity';

jest.mock('../../src/infrastructure/redis/redis-queue.repository');
jest.mock('../../src/application/use-cases/fetch-job.use-case');
jest.mock('../../src/application/use-cases/complete-job.use-case');
jest.mock('../../src/application/use-cases/fail-job.use-case');

describe('Worker', () => {
    let mockKodiak: Kodiak;
    let processor: jest.Mock;
    let mockFetchExecute: jest.Mock;
    let mockCompleteExecute: jest.Mock;
    let mockFailExecute: jest.Mock;

    beforeEach(() => {
        mockKodiak = {
            connection: {},
            prefix: 'kodiak-test',
        } as unknown as Kodiak;
        processor = jest.fn();
        
        (FetchJobUseCase as jest.Mock).mockClear();
        (CompleteJobUseCase as jest.Mock).mockClear();
        (FailJobUseCase as jest.Mock).mockClear();

        mockFetchExecute = jest.fn().mockResolvedValue(null);
        (FetchJobUseCase as jest.Mock).mockImplementation(() => ({
            execute: mockFetchExecute,
        }));

        mockCompleteExecute = jest.fn().mockResolvedValue(undefined);
        (CompleteJobUseCase as jest.Mock).mockImplementation(() => ({
            execute: mockCompleteExecute,
        }));

        mockFailExecute = jest.fn().mockResolvedValue(undefined);
        (FailJobUseCase as jest.Mock).mockImplementation(() => ({
            execute: mockFailExecute,
        }));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should create a worker instance', () => {
        const worker = new Worker('test-queue', processor, mockKodiak);
        expect(worker.name).toBe('test-queue');
    });

    it('should emit start event when started', async () => {
        const worker = new Worker('test-queue', processor, mockKodiak);
        const startEmitter = jest.fn();
        worker.on('start', startEmitter);

        await worker.start();
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(startEmitter).toHaveBeenCalled();

        await worker.stop();
    });

    it('should emit stop event when stopped', async () => {
        const worker = new Worker('test-queue', processor, mockKodiak);
        const stopEmitter = jest.fn();
        worker.on('stop', stopEmitter);

        await worker.start();
        await new Promise(resolve => setTimeout(resolve, 100));
        await worker.stop();

        expect(stopEmitter).toHaveBeenCalled();
    });

    it('should process a job and emit completed event on success', async () => {
        const worker = new Worker<{ message: string }>('test-queue', processor, mockKodiak);
        const completedEmitter = jest.fn();
        worker.on('completed', completedEmitter);

        const mockJob: Job<{ message: string }> = {
            id: 'job-123',
            data: { message: 'test' },
            status: 'active',
            priority: 10,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 3,
        };

        mockFetchExecute
            .mockResolvedValueOnce(mockJob)
            .mockResolvedValueOnce(null);

        processor.mockResolvedValue(undefined);

        await worker.start();
        await new Promise(resolve => setTimeout(resolve, 300));

        expect(processor).toHaveBeenCalledWith(mockJob.data);

        expect(mockCompleteExecute).toHaveBeenCalledWith('job-123');
        expect(completedEmitter).toHaveBeenCalledWith(mockJob);

        await worker.stop();
    });

    it('should process a job and emit failed event on error', async () => {
        const worker = new Worker<{ message: string }>('test-queue', processor, mockKodiak);
        const failedEmitter = jest.fn();
        worker.on('failed', failedEmitter);

        const mockJob: Job<{ message: string }> = {
            id: 'job-123',
            data: { message: 'test' },
            status: 'active',
            priority: 10,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 3,
        };

        const testError = new Error('Processing failed');

        mockFetchExecute
            .mockResolvedValueOnce(mockJob)
            .mockResolvedValueOnce(null);

        processor.mockRejectedValue(testError);

        await worker.start();
        await new Promise(resolve => setTimeout(resolve, 300));

        expect(processor).toHaveBeenCalledWith(mockJob.data);

        expect(mockFailExecute).toHaveBeenCalledWith('job-123', testError);
        expect(failedEmitter).toHaveBeenCalledWith(mockJob, testError);

        await worker.stop();
    });
});
