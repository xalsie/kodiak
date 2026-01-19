import { EventEmitter } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { Redis } from 'ioredis';
import { Kodiak } from './kodiak.js';
import { CompleteJobUseCase } from '../application/use-cases/complete-job.use-case.js';
import { FailJobUseCase } from '../application/use-cases/fail-job.use-case.js';
import { UpdateJobProgressUseCase } from '../application/use-cases/update-job-progress.use-case.js';
import { RedisQueueRepository } from '../infrastructure/redis/redis-queue.repository.js';
import { Semaphore } from '../utils/semaphore.js';
import type { WorkerOptions } from '../application/dtos/worker-options.dto.js';
import type { Job } from '../domain/entities/job.entity.js';
import { FetchJobsUseCase } from '../application/use-cases/fetch-jobs.use-case.js';

export class Worker<T> extends EventEmitter {
    private readonly fetchJobsUseCase: FetchJobsUseCase<T>;
    private readonly completeJobUseCase: CompleteJobUseCase<T>;
    private readonly failJobUseCase: FailJobUseCase<T>;
    private readonly updateJobProgressUseCase: UpdateJobProgressUseCase<T>;
    private isRunning = false;
    private activeJobs = 0;
    private blockingConnection: Redis;
    private ackConnection: Redis;
    private processingSemaphore: Semaphore;
    private jobBuffer: Job<T>[] = [];
    private readonly bufferLock: Semaphore = new Semaphore(1);
    private processingPromises: Promise<void>[] = [];

    constructor(
        public readonly name: string,
        private processor: (job: Job<T>) => Promise<void>,
        private readonly kodiak: Kodiak,
        private opts?: WorkerOptions,
    ) {
        super();

        this.ackConnection = this.kodiak.connection.duplicate();
        this.blockingConnection = this.kodiak.connection.duplicate();

        const ackQueueRepository = new RedisQueueRepository<T>(
            name,
            this.ackConnection,
            kodiak.prefix,
        );
        const blockingQueueRepository = new RedisQueueRepository<T>(
            name,
            this.blockingConnection,
            kodiak.prefix,
        );

        this.fetchJobsUseCase = new FetchJobsUseCase<T>(blockingQueueRepository);
        this.completeJobUseCase = new CompleteJobUseCase<T>(ackQueueRepository);
        this.failJobUseCase = new FailJobUseCase<T>(
            ackQueueRepository,
            opts?.backoffStrategies
        );
        this.updateJobProgressUseCase = new UpdateJobProgressUseCase<T>(ackQueueRepository);

        const concurrency = this.opts?.concurrency ?? 1;
        this.processingSemaphore = new Semaphore(concurrency);
    }

    public async start(): Promise<void> {
        if (this.isRunning) {
            throw new Error(`Worker "${this.name}" is already running`);
        }
        this.isRunning = true;
        this.emit('start');
        
        const concurrency = this.opts?.concurrency ?? 1;

        for (let i = 0; i < concurrency; i++) {
            this.processingPromises.push(this.processNext());
        }
    }

    public async stop(): Promise<void> {
        this.isRunning = false;

        try {
            this.blockingConnection.disconnect();
        } catch (e) {
            console.error('Error during blocking connection disconnect:', e);
        }

        const shutdownTimeout = this.opts?.gracefulShutdownTimeout ?? 30000;

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(shutdownTimeout).then(() => {
                reject(new Error(`Graceful shutdown timed out after ${shutdownTimeout}ms`));
            });
        });

        try {
            await Promise.race([
                Promise.all(this.processingPromises),
                timeoutPromise,
            ]);
        } catch (error) {
            console.error('[Worker] Graceful shutdown failed:', error);
        }

        try {
            this.ackConnection.disconnect();
        } catch (e) {
            console.error('Error during ack connection disconnect:', e);
        }

        this.emit('stop');
    }

    private async getJob(): Promise<Job<T> | null> {
        if (this.jobBuffer.length > 0) {
            const job = this.jobBuffer.shift();
            return job ? job : null;
        }

        await this.bufferLock.acquire();
        try {
            const prefetch = this.opts?.prefetch ?? 10;
            const lockDuration = this.opts?.lockDuration ?? 30000;
            const jobs = await this.fetchJobsUseCase.execute(prefetch, lockDuration);
    
            if (jobs && jobs.length > 0) {
                this.jobBuffer.push(...jobs);
                this.jobBuffer.shift();
            }

            return jobs.length > 0 ? jobs[0] : null;
        } finally {
            this.bufferLock.release();
        }
    }

    private async processNext(): Promise<void> {
        while (this.isRunning) {
            try {
                const job = await this.getJob();

                if (job) {
                    this.activeJobs++;
    
                    const updateProgress = async (progress: number) => {
                        await this.updateJobProgressUseCase.execute(job.id, progress);
                        job.progress = progress;
                        this.emit('progress', job, progress);
                    };
                    job.updateProgress = updateProgress;
    
                    try {
                        await this.processingSemaphore.acquire();
                        await this.processor(job);
    
                        await this.completeJobUseCase.execute(job.id);
                        job.status = 'completed';
                        job.completedAt = new Date();
                        this.emit('completed', job);
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        await this.failJobUseCase.execute(job, err);
                        job.status = 'failed';
                        job.failedAt = new Date();
                        job.error = err.message;
                        this.emit('failed', job, err);
                    } finally {
                        this.processingSemaphore.release();
                        this.activeJobs--;
                    }
                } else {
                    await setTimeout(100);
                }
            } catch (error) {
                if (error instanceof Error) {
                    this.emit('error', error);
                }
            }
        }
    }
}
