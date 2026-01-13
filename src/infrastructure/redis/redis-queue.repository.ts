import { Redis } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Job } from '../../domain/entities/job.entity.js';
import type { IQueueRepository } from '../../domain/repositories/queue.repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class RedisQueueRepository<T> implements IQueueRepository<T> {
    private readonly waitingQueueKey: string;
    private readonly delayedQueueKey: string;
    private readonly activeQueueKey: string;
    private readonly jobKeyPrefix: string;
    private addJobScript: string;
    private moveJobScript: string;

    constructor(
        private readonly queueName: string,
        private readonly connection: Redis,
        private readonly prefix: string,
    ) {
        this.waitingQueueKey = `${prefix}:queue:${queueName}:waiting`;
        this.delayedQueueKey = `${prefix}:queue:${queueName}:delayed`;
        this.activeQueueKey = `${prefix}:queue:${queueName}:active`;
        this.jobKeyPrefix = `${prefix}:jobs:`;

        // Load Lua scripts
        // Note: In production, ensure these files are copied to dist/
        this.addJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'add_job.lua'), 'utf8');
        this.moveJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'move_job.lua'), 'utf8');
    }

    async add(job: Job<T>, score: number, isDelayed: boolean): Promise<void> {
        const jobKey = `${this.jobKeyPrefix}${job.id}`;

        await this.connection.eval(
            this.addJobScript,
            3,
            this.waitingQueueKey,
            this.delayedQueueKey,
            jobKey,
            job.id,
            String(score),
            JSON.stringify(job),
            isDelayed ? '1' : '0',
        );
    }

    async fetchNext(): Promise<Job<T> | null> {
        const now = Date.now();
        const jobId = (await this.connection.eval(
            this.moveJobScript,
            2,
            this.waitingQueueKey,
            this.activeQueueKey,
            String(now),
        )) as string | null;

        if (!jobId) return null;

        const jobKey = `${this.jobKeyPrefix}${jobId}`;

        // Update state manually since we can't do it in Lua (undeclared key issue)
        // Pipeline the update and the fetch for performance
        const results = await this.connection
            .pipeline()
            .hset(jobKey, 'state', 'active', 'started_at', now)
            .hgetall(jobKey)
            .exec();

        if (!results) return null;

        // results[1] is the result of hgetall. It is [error, data]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [err, jobData] = results[1] as [Error | null, any];

        if (err || !jobData || !jobData.data) return null;

        // Parse the original job data
        const jobEntity = JSON.parse(jobData.data) as Job<T>;

        // Update status from Redis state (truth)
        jobEntity.status = 'active';
        jobEntity.startedAt = new Date(now);

        return jobEntity;
    }

    async markAsCompleted(jobId: string, completedAt: Date): Promise<void> {
        const jobKey = `${this.jobKeyPrefix}${jobId}`;
        // Remove from active queue and update job state to completed
        await this.connection
            .pipeline()
            .lrem(this.activeQueueKey, 1, jobId)
            .hset(jobKey, 'state', 'completed', 'completed_at', completedAt.getTime())
            .exec();
    }

    async markAsFailed(jobId: string, error: string, failedAt: Date): Promise<void> {
        const jobKey = `${this.jobKeyPrefix}${jobId}`;
        // Remove from active queue and update job state to failed
        await this.connection
            .pipeline()
            .lrem(this.activeQueueKey, 1, jobId)
            .hset(jobKey, 'state', 'failed', 'failed_at', failedAt.getTime(), 'error', error)
            .exec();
    }
}
