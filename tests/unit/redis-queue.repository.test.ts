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
});
