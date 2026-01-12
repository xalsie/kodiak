import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Kodiak } from '../../src/presentation/kodiak.js';
import type { Job } from '../../src/domain/entities/job.entity.js';

// Mocks must be defined before imports
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

// Import modules under test after mocks
const { Worker } = await import('../../src/presentation/worker.js');
const { FetchJobUseCase } = await import('../../src/application/use-cases/fetch-job.use-case.js');
const { CompleteJobUseCase } = await import('../../src/application/use-cases/complete-job.use-case.js');
const { FailJobUseCase } = await import('../../src/application/use-cases/fail-job.use-case.js');

describe('Worker', () => {
    let mockKodiak: Kodiak;
    let processor: any;

    beforeEach(() => {
        mockKodiak = {
            connection: {},
            prefix: 'kodiak-test',
        } as unknown as Kodiak;
        processor = jest.fn();
        
        // Reset the mock classes
        (FetchJobUseCase as unknown as jest.Mock).mockClear();
        (CompleteJobUseCase as unknown as jest.Mock).mockClear();
        (FailJobUseCase as unknown as jest.Mock).mockClear();

        // Reset the mock methods
        mockFetchExecute.mockReset();
        mockFetchExecute.mockResolvedValue(null);

        mockCompleteExecute.mockReset();
        mockCompleteExecute.mockResolvedValue(undefined);

        mockFailExecute.mockReset();
        mockFailExecute.mockResolvedValue(undefined);
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
