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
        await redis.flushall();
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
            updateProgress: async () => Promise.resolve(),
        };
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

        await repository.add(jobLow.job, jobLow.score, false);
        await repository.add(jobNormal.job, jobNormal.score, false);
        await repository.add(jobHigh.job, jobHigh.score, false);

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

    it('should mark a job as completed', async () => {
        const { job, score } = createJob('job-completed');
        await repository.add(job, score, false);

        const fetched = await repository.fetchNext();
        expect(fetched?.id).toBe('job-completed');

        const activeCount = await redis.llen(`${prefix}:queue:${queueName}:active`);
        expect(activeCount).toBe(1);

        const completedAt = new Date();
        await repository.markAsCompleted('job-completed', completedAt);

        const activeCountAfter = await redis.llen(`${prefix}:queue:${queueName}:active`);
        expect(activeCountAfter).toBe(0);

        const state = await redis.hget(`${prefix}:jobs:job-completed`, 'state');
        expect(state).toBe('completed');
    });

    it('should mark a job as failed', async () => {
        const { job, score } = createJob('job-failed');
        await repository.add(job, score, false);

        await repository.fetchNext();

        const failedAt = new Date();
        const errorMsg = 'Something went wrong';
        await repository.markAsFailed('job-failed', errorMsg, failedAt);

        const activeCount = await redis.llen(`${prefix}:queue:${queueName}:active`);
        expect(activeCount).toBe(0);

        const state = await redis.hget(`${prefix}:jobs:job-failed`, 'state');
        const error = await redis.hget(`${prefix}:jobs:job-failed`, 'error');
        expect(state).toBe('failed');
        expect(error).toBe(errorMsg);
    });

    it('should retry a job if maxAttempts > 1', async () => {
        const { job, score } = createJob('job-retry', 10, 0);
        job.maxAttempts = 2;
        await repository.add(job, score, false);

        await repository.fetchNext();

        const failedAt = new Date();
        const errorMsg = 'First failure';
        await repository.markAsFailed('job-retry', errorMsg, failedAt);

        const state = await redis.hget(`${prefix}:jobs:job-retry`, 'state');
        expect(state).toBe('delayed');

        const retryCount = await redis.hget(`${prefix}:jobs:job-retry`, 'retry_count');
        expect(retryCount).toBe('1');

        const activeCount = await redis.llen(`${prefix}:queue:${queueName}:active`);
        expect(activeCount).toBe(0);

        const delayedScore = await redis.zscore(`${prefix}:queue:${queueName}:delayed`, 'job-retry');
        expect(delayedScore).not.toBeNull();
    });

    it('should reschedule a recurring job upon completion', async () => {
        const { job, score } = createJob('job-recurring', 10, 0);
        job.repeat = { every: 1000, count: 0, limit: 3 };
        
        await repository.add(job, score, false);

        await repository.fetchNext(); // Active
        await repository.markAsCompleted('job-recurring', new Date());

        let state = await redis.hget(`${prefix}:jobs:job-recurring`, 'state');
        expect(state).toBe('delayed');
        const repeatCount = await redis.hget(`${prefix}:jobs:job-recurring`, 'repeat_count');
        expect(repeatCount).toBe('1');

        const delayedScore = await redis.zscore(`${prefix}:queue:${queueName}:delayed`, 'job-recurring');
        expect(delayedScore).not.toBeNull();

        await redis.hset(`${prefix}:jobs:job-recurring`, 'repeat_count', '2');

        await redis.zrem(`${prefix}:queue:${queueName}:delayed`, 'job-recurring');
        await redis.lpush(`${prefix}:queue:${queueName}:active`, 'job-recurring');

        await repository.markAsCompleted('job-recurring', new Date());

        state = await redis.hget(`${prefix}:jobs:job-recurring`, 'state');
        expect(state).toBe('completed');
    });

    it('should return null if job data is missing (corrupted state)', async () => {
        const jobId = 'ghost-job';
        await redis.zadd(`${prefix}:queue:${queueName}:waiting`, 1000, jobId);

        const fetched = await repository.fetchNext();
        expect(fetched).toBeNull();
    });
});
