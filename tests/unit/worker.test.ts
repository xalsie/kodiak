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
        mockFetchExecute.mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 10)); // Simulate Redis latency/blocking
            return null;
        });

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

        expect(mockFailExecute).toHaveBeenCalledWith(mockJob, testError);
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

    it('should respect semaphore concurrency (prefetch logic)', async () => {
        // Concurrency 1, Prefetch 1 => 2 Fetchers.
        const worker = new Worker('test-queue', processor, mockKodiak, { concurrency: 1, prefetch: 1 });

        const job1: Job<unknown> = {
            id: 'job-1',
            data: { id: 1 },
            status: 'active',
            priority: 10,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 3,
        };
        const job2: Job<unknown> = {
            id: 'job-2',
            data: { id: 2 },
            status: 'active',
            priority: 10,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 3,
        };

        mockFetchExecute
            .mockResolvedValueOnce(job1 as never)
            .mockResolvedValueOnce(job2 as never);

        let releaseJob1: (value: void) => void = () => {};
        const job1Blocker = new Promise<void>((resolve) => {
            releaseJob1 = resolve;
        });

        processor.mockImplementation(async (data: unknown) => {
            if ((data as { id: number }).id === 1) {
                await job1Blocker;
            }
        });

        await worker.start();

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(processor).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
        expect(processor).not.toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));

        releaseJob1();

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(processor).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));

        await worker.stop();
    });

    it('should not process if slot index is invalid', () => {
        const worker = new Worker('test-queue', processor, mockKodiak);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyWorker = worker as any;

        anyWorker.isRunning = true;
        anyWorker.processNext(999);

        expect(mockFetchExecute).not.toHaveBeenCalled();
    });

    it('should handle missing semaphore (defensive programming)', async () => {
        const worker = new Worker('test-queue', processor, mockKodiak);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyWorker = worker as any;

        anyWorker.isRunning = true;
        anyWorker.activeJobs = 0;
        anyWorker.processingSemaphore = null; 

        const mockJob = { id: 'j1', data: {}, status: 'active', priority: 1, addedAt: new Date(), retryCount: 0, maxAttempts: 1 };
        mockFetchExecute.mockResolvedValueOnce(mockJob as never);
        
        processor.mockResolvedValue(undefined);

        anyWorker.fetchJobUseCases = [{ execute: mockFetchExecute }];
        
        await anyWorker.processNext(0);

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(processor).toHaveBeenCalled();
        expect(mockCompleteExecute).toHaveBeenCalled();
    });

    it('should abort if fetchJobUseCases exceeds totalSlots (defensive check)', () => {
        const worker = new Worker('test-queue', processor, mockKodiak, { concurrency: 1 });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyWorker = worker as any;

        anyWorker.isRunning = true;
        anyWorker.fetchJobUseCases = [{}, {}, {}]; 
        anyWorker.processNext(0);

        expect(mockFetchExecute).not.toHaveBeenCalled();
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
            mockJob, 
            expect.objectContaining({ message: stringError })
        );
        expect(failedEmitter).toHaveBeenCalledWith(
            mockJob, 
            expect.objectContaining({ message: stringError })
        );

        await worker.stop();
    });
});
