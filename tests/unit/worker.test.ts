import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Kodiak } from '../../src/presentation/kodiak.js';
import type { Job } from '../../src/domain/entities/job.entity.js';

const mockFetchExecute = jest.fn();
const mockCompleteExecute = jest.fn();
const mockFailExecute = jest.fn();

jest.unstable_mockModule('../../src/infrastructure/redis/redis-queue.repository.js', () => ({
    RedisQueueRepository: jest.fn(),
}));

jest.unstable_mockModule('../../src/application/use-cases/fetch-job.use-case.js', () => ({
    FetchJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockFetchExecute,
    })),
}));

jest.unstable_mockModule('../../src/application/use-cases/complete-job.use-case.js', () => ({
    CompleteJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockCompleteExecute,
    })),
}));

jest.unstable_mockModule('../../src/application/use-cases/fail-job.use-case.js', () => ({
    FailJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockFailExecute,
    })),
}));

const { Worker } = await import('../../src/presentation/worker.js');
const { FetchJobUseCase } = await import('../../src/application/use-cases/fetch-job.use-case.js');
const { CompleteJobUseCase } = await import('../../src/application/use-cases/complete-job.use-case.js');
const { FailJobUseCase } = await import('../../src/application/use-cases/fail-job.use-case.js');

describe('Worker', () => {
    let mockKodiak: Kodiak;
    let processor: jest.MockedFunction<(job: unknown) => Promise<void>>;

    beforeEach(() => {
        mockKodiak = {
            connection: {
                duplicate: jest.fn().mockReturnValue({ quit: jest.fn() }),
            },
            prefix: 'kodiak-test',
        } as unknown as Kodiak;
        processor = jest.fn() as jest.MockedFunction<(job: unknown) => Promise<void>>;

        (FetchJobUseCase as unknown as jest.Mock).mockClear();
        (CompleteJobUseCase as unknown as jest.Mock).mockClear();
        (FailJobUseCase as unknown as jest.Mock).mockClear();

        mockFetchExecute.mockReset();
        mockFetchExecute.mockResolvedValue(null as never);

        mockCompleteExecute.mockReset();
        mockCompleteExecute.mockResolvedValue(undefined as never);

        mockFailExecute.mockReset();
        mockFailExecute.mockResolvedValue(undefined as never);
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
            .mockResolvedValueOnce(mockJob as never)
            .mockResolvedValueOnce(null as never);

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
            .mockResolvedValueOnce(mockJob as never)
            .mockResolvedValueOnce(null as never);

        processor.mockRejectedValue(testError);

        await worker.start();
        await new Promise(resolve => setTimeout(resolve, 300));

        expect(processor).toHaveBeenCalledWith(mockJob.data);

        expect(mockFailExecute).toHaveBeenCalledWith('job-123', testError);
        expect(failedEmitter).toHaveBeenCalledWith(mockJob, testError);

        await worker.stop();
    });

    it('should throw error if started while already running', async () => {
        const worker = new Worker('test-queue', processor, mockKodiak);
        await worker.start();
        
        await expect(worker.start()).rejects.toThrow('Worker "test-queue" is already running');
        
        await worker.stop();
    });

    it('should emit error event if fetchJob fails', async () => {
        const worker = new Worker('test-queue', processor, mockKodiak);
        const errorEmitter = jest.fn();
        worker.on('error', errorEmitter);

        const testError = new Error('Fetch failed');
        mockFetchExecute.mockRejectedValue(testError as never);

        await worker.start();
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(errorEmitter).toHaveBeenCalledWith(testError);
        
        await worker.stop();
    });

    it('should respect concurrency limit', () => {
        const worker = new Worker('test-queue', processor, mockKodiak, { concurrency: 1 });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyWorker = worker as any;

        anyWorker.isRunning = true;
        anyWorker.activeJobs = 1;
        
        mockFetchExecute.mockClear();
        const spy = jest.spyOn(global, 'setTimeout');
        
        anyWorker.processNext();
        
        // Should NOT wait (no backoff anymore)
        expect(spy).not.toHaveBeenCalled();
        // Should NOT fetch (max concurrency reached)
        expect(mockFetchExecute).not.toHaveBeenCalled();
        
        anyWorker.isRunning = false;
    });

    it('should handle non-Error objects thrown by processor', async () => {
        const worker = new Worker('test-queue', processor, mockKodiak);
        const failedEmitter = jest.fn();
        worker.on('failed', failedEmitter);

        const mockJob: Job<{ message: string }> = {
            id: 'job-string-error',
            data: { message: 'test' },
            status: 'active',
            priority: 10,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 3,
        };

        const stringError = 'I am not an Error object';

        mockFetchExecute
            .mockResolvedValueOnce(mockJob as never)
            .mockResolvedValueOnce(null as never);

        processor.mockRejectedValue(stringError);

        await worker.start();
        await new Promise(resolve => setTimeout(resolve, 300));

        expect(mockFailExecute).toHaveBeenCalledWith(
            'job-string-error', 
            expect.objectContaining({ message: stringError })
        );
        expect(failedEmitter).toHaveBeenCalledWith(
            mockJob, 
            expect.objectContaining({ message: stringError })
        );

        await worker.stop();
    });
});
