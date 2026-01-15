import { Redis } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Job, JobStatus } from '../../domain/entities/job.entity.js';
import type { IQueueRepository } from '../../domain/repositories/queue.repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class RedisQueueRepository<T> implements IQueueRepository<T> {
    private readonly notificationQueueKey: string;
    private readonly waitingQueueKey: string;
    private readonly delayedQueueKey: string;
    private readonly activeQueueKey: string;
    private readonly jobKeyPrefix: string;
    private addJobScript: string;
    private moveJobScript: string;
    private completeJobScript: string;
    private failJobScript: string;
    private promoteDelayedJobsScript: string;

    constructor(
        private readonly queueName: string,
        private readonly connection: Redis,
        private readonly prefix: string,
    ) {
        this.waitingQueueKey = `${prefix}:queue:${queueName}:waiting`;
        this.delayedQueueKey = `${prefix}:queue:${queueName}:delayed`;
        this.activeQueueKey = `${prefix}:queue:${queueName}:active`;
        this.notificationQueueKey = `${prefix}:queue:${queueName}:notify`;
        this.jobKeyPrefix = `${prefix}:jobs:`;

        // Load Lua scripts
        // Note: In production, ensure these files are copied to dist/
        this.addJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'add_job.lua'), 'utf8');
        this.moveJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'move_job.lua'), 'utf8');
        this.completeJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'complete_job.lua'), 'utf8');
        this.failJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'fail_job.lua'), 'utf8');
        this.promoteDelayedJobsScript = fs.readFileSync(path.join(__dirname, 'lua', 'promote_delayed_jobs.lua'), 'utf8');
    }

    async add(job: Job<T>, score: number, isDelayed: boolean): Promise<void> {
        const jobKey = `${this.jobKeyPrefix}${job.id}`;

        const jobFields = [
            'data',
            JSON.stringify(job.data),
            'priority',
            String(job.priority),
            'retry_count',
            String(job.retryCount),
            'max_attempts',
            String(job.maxAttempts),
            'added_at',
            String(job.addedAt.getTime()),
        ];

        if (job.backoff) {
            jobFields.push('backoff_type', job.backoff.type);
            jobFields.push('backoff_delay', String(job.backoff.delay));
        }

        await this.connection.eval(
            this.addJobScript,
            4,
            this.waitingQueueKey,
            this.delayedQueueKey,
            jobKey,
            this.notificationQueueKey,
            job.id,
            String(score),
            isDelayed ? '1' : '0',
            ...jobFields,
        );
    }

    async fetchNext(timeout?: number): Promise<Job<T> | null> {
        if (timeout && timeout > 0) {
            const result = await this.connection.brpop(this.notificationQueueKey, timeout);
            if (!result) return null;
        }

        const now = Date.now();

        const result = (await this.connection.eval(
            this.moveJobScript,
            2,
            this.waitingQueueKey,
            this.activeQueueKey,
            String(now),
            this.jobKeyPrefix,
        )) as [string, string[] | null] | null;

        if (!result) return null;

        const [jobId, rawData] = result;
        const jobKey = `${this.jobKeyPrefix}${jobId}`;

        let jobData: Record<string, string>;

        if (rawData) {
            // Optimization success: Data fetched in Lua
            jobData = {};
            for (let i = 0; i < rawData.length; i += 2) {
                jobData[rawData[i]] = rawData[i + 1];
            }
        } else {
            // Fallback: Lua couldn't access key, do it in Node
            // Pipeline the update and the fetch for performance
            const results = await this.connection
                .pipeline()
                .hset(jobKey, 'state', 'active', 'started_at', now)
                .hgetall(jobKey)
                .exec();

            if (!results) return null;

            // results[1] is the result of hgetall. It is [error, data]
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [err, data] = results[1] as [Error | null, any];

            if (err || !data) return null;
            jobData = data;
        }

        if (!jobData.data) return null;

        // Parse the job data (now stored as separate fields)
        const jobEntity: Job<T> = {
            id: jobId,
            data: JSON.parse(jobData.data),
            priority: Number(jobData.priority),
            status: jobData.state as JobStatus,
            retryCount: Number(jobData.retry_count),
            maxAttempts: Number(jobData.max_attempts),
            addedAt: new Date(Number(jobData.added_at)),
            // started_at is set by move_job.lua
            startedAt: jobData.started_at ? new Date(Number(jobData.started_at)) : new Date(now),
        };

        return jobEntity;
    }

    async markAsCompleted(jobId: string, completedAt: Date): Promise<void> {
        const jobKey = `${this.jobKeyPrefix}${jobId}`;
        
        await this.connection.eval(
            this.completeJobScript,
            2,
            this.activeQueueKey,
            jobKey,
            jobId,
            String(completedAt.getTime())
        );
    }

    async markAsFailed(jobId: string, error: string, failedAt: Date): Promise<void> {
        const jobKey = `${this.jobKeyPrefix}${jobId}`;
        
        await this.connection.eval(
            this.failJobScript,
            3,
            this.activeQueueKey,
            jobKey,
            this.delayedQueueKey,
            jobId,
            error,
            String(failedAt.getTime())
        );
    }

    async promoteDelayedJobs(limit: number = 50): Promise<number> {
        const now = Date.now();
        const result = await this.connection.eval(
            this.promoteDelayedJobsScript,
            4,
            this.delayedQueueKey,
            this.waitingQueueKey,
            this.notificationQueueKey,
            this.jobKeyPrefix,
            String(now),
            String(limit)
        );
        return Number(result);
    }
}
