import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const mockExecute = jest.fn();
jest.unstable_mockModule('../../src/application/use-cases/add-job.use-case.js', () => ({
    AddJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockExecute
    }))
}));

const mockPromoteDelayedJobs = jest.fn().mockResolvedValue(0 as never);
jest.unstable_mockModule('../../src/infrastructure/redis/redis-queue.repository.js', () => ({
    RedisQueueRepository: jest.fn().mockImplementation(() => ({
        promoteDelayedJobs: mockPromoteDelayedJobs,
        add: jest.fn(),
    }))
}));

const { Queue } = await import('../../src/presentation/queue.js');
import { Kodiak } from '../../src/presentation/kodiak.js';

describe('Unit: Queue', () => {
    let mockKodiak: Kodiak;
    
    beforeEach(() => {
        jest.useFakeTimers();
        mockKodiak = {
            connection: {},
            prefix: 'test'
        } as Kodiak;
        mockPromoteDelayedJobs.mockClear();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should start a scheduler that calls promoteDelayedJobs periodically', async () => {
        const queue = new Queue('test-queue', mockKodiak);

        jest.advanceTimersByTime(5000);

        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(5000);

        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(2);

        await queue.close();
    });

    it('should stop the scheduler when closed', async () => {
        const queue = new Queue('test-queue', mockKodiak);

        jest.advanceTimersByTime(5000);
        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(1);

        await queue.close();

        jest.advanceTimersByTime(10000);
        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(1);
    });

    it('should handle errors in scheduler loop', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockPromoteDelayedJobs.mockRejectedValueOnce(new Error('Redis error') as never);

        const queue = new Queue('test-queue', mockKodiak);
        
        jest.advanceTimersByTime(5000);
        
        await Promise.resolve();

        expect(mockPromoteDelayedJobs).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Error promoting delayed jobs'),
            expect.any(Error)
        );

        consoleSpy.mockRestore();
        await queue.close();
    });

    it('should ignore startScheduler if already running', () => {
        const queue = new Queue('test-queue', mockKodiak);

        const intervalBefore = (queue as unknown as { schedulerInterval: NodeJS.Timeout | null }).schedulerInterval;

        (queue as unknown as { startScheduler: () => void }).startScheduler();

        const intervalAfter = (queue as unknown as { schedulerInterval: NodeJS.Timeout | null }).schedulerInterval;

        expect(intervalBefore).toBe(intervalAfter);
        
        queue.close();
    });

    it('should call AddJobUseCase when adding a job', async () => {
        const queue = new Queue('test-queue', mockKodiak);
        const data = { foo: 'bar' };
        
        await queue.add('job-1', data);

        expect(mockExecute).toHaveBeenCalledWith('job-1', data, undefined);
        
        await queue.close();
    });
});
