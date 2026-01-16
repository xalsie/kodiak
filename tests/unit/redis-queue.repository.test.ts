import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Redis } from 'ioredis';

jest.unstable_mockModule('fs', () => ({
    readFileSync: jest.fn().mockReturnValue('return 1'),
    default: {
        readFileSync: jest.fn().mockReturnValue('return 1'),
    },
}));

const { RedisQueueRepository } = await import('../../src/infrastructure/redis/redis-queue.repository.js');

describe('Unit: RedisQueueRepository', () => {
    let repository: InstanceType<typeof RedisQueueRepository>;
    let mockRedis: Redis;
    let mockPipeline: Record<string, jest.Mock>;

    beforeEach(() => {
        mockPipeline = {
            hset: jest.fn().mockReturnThis(),
            hgetall: jest.fn().mockReturnThis(),
            lrem: jest.fn().mockReturnThis(),
            exec: jest.fn(),
        };

        mockRedis = {
            eval: jest.fn(),
            pipeline: jest.fn().mockReturnValue(mockPipeline),
        } as unknown as Redis;

        repository = new RedisQueueRepository('test-queue', mockRedis, 'kodiak-test');
        jest.clearAllMocks();
    });

    it('should return null if pipeline execution returns null', async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue('job-123' as never);

        (mockPipeline.exec as jest.Mock).mockResolvedValue(null as never);

        const result = await repository.fetchNext();

        expect(result).toBeNull();
    });

    it('should return null if brpop times out', async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(null as never);
        const brpopMock = jest.fn().mockResolvedValue(null as never);
        mockRedis.brpop = brpopMock as Redis['brpop'];

        const result = await repository.fetchNext(2);

        expect(brpopMock).toHaveBeenCalledWith(expect.stringContaining(':notify'), 2);
        expect(result).toBeNull();
    });

    it('should ignore timeout if <= 0', async () => {
        await repository.fetchNext(0);
        expect(mockRedis.eval).toHaveBeenCalled();
    });

    it('should use Lua script to mark job as completed', async () => {
        const jobId = 'job-123';
        const completedAt = new Date();

        await repository.markAsCompleted(jobId, completedAt);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            3,
            expect.stringContaining(':active'),
            expect.stringContaining(`:jobs:${jobId}`),
            expect.stringContaining(':delayed'),
            jobId,
            String(completedAt.getTime())
        );
    });

    it('should use Lua script to mark job as failed', async () => {
        const jobId = 'job-456';
        const failedAt = new Date();
        const errorMsg = 'Oops';

        await repository.markAsFailed(jobId, errorMsg, failedAt);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            3,
            expect.stringContaining(':active'),
            expect.stringContaining(`:jobs:${jobId}`),
            expect.stringContaining(':delayed'),
            jobId,
            errorMsg,
            String(failedAt.getTime()),
            '-1'
        );
    });

    it('should pass backoff options to Lua script when adding a job', async () => {
        const job = {
            id: 'job-with-backoff',
            data: { foo: 'bar' },
            priority: 1,
            retryCount: 0,
            maxAttempts: 3,
            addedAt: new Date(),
            status: 'waiting' as const,
            backoff: {
                type: 'exponential' as const,
                delay: 5000
            }
        };

        await repository.add(job, 1, false);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            4,
            expect.stringContaining(':waiting'),
            expect.stringContaining(':delayed'),
            expect.stringContaining(`:jobs:${job.id}`),
            expect.stringContaining(':notify'),
            job.id,
            '1',
            '0',
            'data', JSON.stringify(job.data),
            'priority', String(job.priority),
            'retry_count', String(job.retryCount),
            'max_attempts', String(job.maxAttempts),
            'added_at', String(job.addedAt.getTime()),
            'backoff_type', 'exponential',
            'backoff_delay', '5000'
        );
    });

    it('should call promoteDelayedJobs Lua script', async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(5 as never);

        const count = await repository.promoteDelayedJobs(100);

        expect(count).toBe(5);
        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            4,
            expect.stringContaining(':delayed'),
            expect.stringContaining(':waiting'),
            expect.stringContaining(':notify'),
            expect.stringContaining(':jobs:'),
            expect.any(String),
            '100'
        );
    });
});
