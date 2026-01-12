import IORedis from 'ioredis';
import { RedisQueueRepository } from '../../src/infrastructure/redis/redis-queue.repository';
import type { Job } from '../../src/domain/entities/job.entity';

interface TestPayload {
    foo: string;
}

describe('Integration: RedisQueueRepository', () => {
    let redis: IORedis;
    let repository: RedisQueueRepository<TestPayload>;
    const queueName = 'integration-test-queue';
    const prefix = 'kodiak-test';

    beforeAll(() => {
        redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: 1 });
    });

    afterAll(async () => {
        await redis.quit();
    });

    beforeEach(async () => {
        await redis.flushall(); // Clean slate
        repository = new RedisQueueRepository<TestPayload>(queueName, redis, prefix);
    });

    const createJob = (
        id: string,
        priority = 10,
        delay = 0,
    ): { job: Job<TestPayload>; score: number } => {
        const job: Job<TestPayload> = {
            id,
            data: { foo: 'bar' },
            status: delay > 0 ? 'delayed' : 'waiting',
            priority,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 1,
        };
        // Logic from UseCase (duplicated here for direct repo testing)
        const score = priority * 10000000000000 + (Date.now() + delay);
        return { job, score };
    };

    it('should add a job and fetch it back', async () => {
        const { job, score } = createJob('job-1');
        await repository.add(job, score, false);

        const fetchedJob = await repository.fetchNext();

        expect(fetchedJob).not.toBeNull();
        expect(fetchedJob?.id).toBe('job-1');
        expect(fetchedJob?.status).toBe('active');
        expect(fetchedJob?.data).toEqual({ foo: 'bar' });
    });

    it('should fetch high priority jobs first', async () => {
        const jobLow = createJob('low', 100);
        const jobHigh = createJob('high', 1);
        const jobNormal = createJob('normal', 10);

        // Add in random order
        await repository.add(jobLow.job, jobLow.score, false);
        await repository.add(jobNormal.job, jobNormal.score, false);
        await repository.add(jobHigh.job, jobHigh.score, false);

        // Fetch order should be High -> Normal -> Low
        const first = await repository.fetchNext();
        const second = await repository.fetchNext();
        const third = await repository.fetchNext();

        expect(first?.id).toBe('high');
        expect(second?.id).toBe('normal');
        expect(third?.id).toBe('low');
    });

    it('should not fetch delayed jobs immediately', async () => {
        const { job, score } = createJob('delayed-1', 10, 5000);
        await repository.add(job, score, true);

        const fetched = await repository.fetchNext();
        expect(fetched).toBeNull();

        // Check it is in delayed ZSET
        const delayedScore = await redis.zscore(
            `${prefix}:queue:${queueName}:delayed`,
            'delayed-1',
        );
        expect(delayedScore).not.toBeNull();
    });

    it('should return null when queue is empty', async () => {
        const fetched = await repository.fetchNext();
        expect(fetched).toBeNull();
    });
});
