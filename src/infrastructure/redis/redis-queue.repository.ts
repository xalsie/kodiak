import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
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
    private updateProgressScript: string;
    private moveToActiveScript: string;
    private recoverStalledJobsScript: string;

    constructor(
        private readonly queueName: string,
        private readonly connection: Redis,
        private readonly prefix: string,
    ) {
        this.waitingQueueKey = `${this.prefix}:queue:${this.queueName}:waiting`;
        this.delayedQueueKey = `${this.prefix}:queue:${this.queueName}:delayed`;
        this.activeQueueKey = `${this.prefix}:queue:${this.queueName}:active`;
        this.notificationQueueKey = `${this.prefix}:queue:${this.queueName}:notify`;
        this.jobKeyPrefix = `${this.prefix}:jobs:`;

        // Load Lua scripts
        this.addJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'add_job.lua'), 'utf8');
        this.moveJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'move_job.lua'), 'utf8');
        this.completeJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'complete_job.lua'), 'utf8');
        this.failJobScript = fs.readFileSync(path.join(__dirname, 'lua', 'fail_job.lua'), 'utf8');
        this.promoteDelayedJobsScript = fs.readFileSync(path.join(__dirname, 'lua', 'promote_delayed_jobs.lua'), 'utf8');
        this.updateProgressScript = fs.readFileSync(path.join(__dirname, 'lua', 'update_progress.lua'), 'utf8');
        this.moveToActiveScript = fs.readFileSync(path.join(__dirname, 'lua', 'move_to_active.lua'), 'utf8');
        this.recoverStalledJobsScript = fs.readFileSync(path.join(__dirname, 'lua', 'detect_and_recover_stalled_jobs.lua'), 'utf8');
    }

    async recoverStalledJobs(): Promise<string[]> {
        const ids = (await this.connection.eval(
            this.recoverStalledJobsScript,
            2,
            this.activeQueueKey,
            this.waitingQueueKey,
            String(Date.now())
        )) as string[];

        if (!ids || ids.length === 0) return [];

        const now = Date.now();
        const pipeline = this.connection.pipeline();
        for (const id of ids) {
            const jobKey = `${this.jobKeyPrefix}${id}`;
            pipeline.hincrby(jobKey, 'retry_count', 1);
            pipeline.hset(jobKey, 'state', 'waiting', 'updated_at', String(now));
        }
        await pipeline.exec();
        return ids;
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

        if (job.repeat) {
            jobFields.push('repeat_every', String(job.repeat.every));
            jobFields.push('repeat_count', String(job.repeat.count));
            if (job.repeat.limit) {
                jobFields.push('repeat_limit', String(job.repeat.limit));
            }
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
        const now = Date.now();

        const optimisticResult = (await this.connection.eval(
            this.moveJobScript,
            3,
            this.waitingQueueKey,
            this.activeQueueKey,
            this.notificationQueueKey,
            String(now),
            this.jobKeyPrefix,
            '1'
        )) as [string, string[] | null] | null;

        if (optimisticResult) {
            return this.processFetchResult(optimisticResult, now);
        }

        if (timeout && timeout > 0) {
            const popResult = await this.connection.brpop(this.notificationQueueKey, timeout);
            if (!popResult) return null;
        } else {
            return null;
        }

        const result = (await this.connection.eval(
            this.moveJobScript,
            3,
            this.waitingQueueKey,
            this.activeQueueKey,
            this.notificationQueueKey,
            String(now),
            this.jobKeyPrefix,
            '0'
        )) as [string, string[] | null] | null;

        if (result) {
            return this.processFetchResult(result, now);
        }

        return null;
    }

    async fetchNextJobs(count: number, lockDuration: number): Promise<Job<T>[]> {
        const now = Date.now();
        const lockExpiresAt = now + lockDuration;
    
        const jobIds = (await this.connection.eval(
            this.moveToActiveScript,
            2,
            this.waitingQueueKey,
            this.activeQueueKey,
            String(count),
            String(lockExpiresAt)
        )) as string[];
    
        if (!jobIds || jobIds.length === 0) {
            return [];
        }
    
        const pipeline = this.connection.pipeline();
        for (const jobId of jobIds) {
            const jobKey = `${this.jobKeyPrefix}${jobId}`;
            pipeline.hset(jobKey, 'state', 'active', 'started_at', now);
            pipeline.hgetall(jobKey);
        }
        const results = await pipeline.exec();
    
        if (!results) {
            return [];
        }
    
        const jobs: Job<T>[] = [];
        for (let i = 0; i < results.length; i += 2) {
            const [hgetallError, jobData] = results[i + 1] as [Error | null, Record<string, string>];
            const jobId = jobIds[i / 2];
    
            if (!hgetallError && jobData) {
                const job = this.buildJobEntityFromRecord(jobId, jobData, now);
                if (job) {
                    jobs.push(job);
                }
            }
        }
    
        return jobs;
    }

    private buildJobEntityFromRecord(jobId: string, jobData: Record<string, string>, now: number): Job<T> | null {
        if (!jobData.data) return null;

        const jobEntity: Job<T> = {
            id: jobId,
            data: JSON.parse(jobData.data),
            priority: Number(jobData.priority),
            status: jobData.state as JobStatus,
            retryCount: Number(jobData.retry_count),
            maxAttempts: Number(jobData.max_attempts),
            addedAt: new Date(Number(jobData.added_at)),
            startedAt: jobData.started_at ? new Date(Number(jobData.started_at)) : new Date(now),
            progress: jobData.progress ? Number(jobData.progress) : 0,
            updateProgress: async (progress: number) => {
                await this.updateProgress(jobId, progress);
            }
        };

        return jobEntity;
    }

    private async processFetchResult(result: [string, string[] | null], now: number): Promise<Job<T> | null> {
        const [jobId, rawData] = result;
        const jobKey = `${this.jobKeyPrefix}${jobId}`;

        let jobData: Record<string, string>;

        if (rawData) {
            jobData = {};
            for (let i = 0; i < rawData.length; i += 2) {
                jobData[rawData[i]] = rawData[i + 1];
            }
        } else {
            const results = await this.connection
                .pipeline()
                .hset(jobKey, 'state', 'active', 'started_at', now)
                .hgetall(jobKey)
                .exec();

            if (!results) return null;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [err, data] = results[1] as [Error | null, any];

            if (err || !data) return null;
            jobData = data;
        }

        if (!jobData.data) return null;

        return this.buildJobEntityFromRecord(jobId, jobData, now);
    }

    async markAsCompleted(jobId: string, completedAt: Date): Promise<void> {
        const jobKey = `${this.jobKeyPrefix}${jobId}`;
        
        await this.connection.eval(
            this.completeJobScript,
            3,
            this.activeQueueKey,
            jobKey,
            this.delayedQueueKey,
            jobId,
            String(completedAt.getTime())
        );
    }

    async markAsFailed(jobId: string, error: string, failedAt: Date, nextAttempt?: Date): Promise<void> {
        const jobKey = `${this.jobKeyPrefix}${jobId}`;
        
        await this.connection.eval(
            this.failJobScript,
            3,
            this.activeQueueKey,
            jobKey,
            this.delayedQueueKey,
            jobId,
            error,
            String(failedAt.getTime()),
            nextAttempt ? String(nextAttempt.getTime()) : '-1'
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

    async updateProgress(jobId: string, progress: number): Promise<void> {
        const jobKey = `${this.jobKeyPrefix}${jobId}`;
        await this.connection.eval(
            this.updateProgressScript,
            1,
            jobKey,
            String(progress)
        );
    }
}
