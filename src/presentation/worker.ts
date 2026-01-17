import { EventEmitter } from 'events';
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
        // console.log(`[Worker] Initializing worker "${name}"`);

        this.ackConnection = kodiak.connection.duplicate();
        this.blockingConnection = kodiak.connection.duplicate();

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
        // console.log(`[Worker] Starting worker "${this.name}"`);
        if (this.isRunning) {
            throw new Error(`Worker "${this.name}" is already running`);
        }
        this.isRunning = true;
        this.emit('start');
        
        const concurrency = this.opts?.concurrency ?? 1;

        for (let i = 0; i < concurrency; i++) {
            this.processingPromises.push(this.processNext(i));
        }
    }

    public async stop(): Promise<void> {
        // console.log(`[Worker] Stopping worker "${this.name}"`);
        this.isRunning = false;

        // console.log('[Worker] Waiting for active jobs to complete...', this.processingPromises.length);
        await Promise.all(this.processingPromises);

        try {
            // console.log('[Worker] Disconnecting blocking connection...');
            this.blockingConnection.disconnect();
        } catch (e) {
            console.error('Error during blocking connection disconnect:', e);
        }

        try {
            // console.log('[Worker] Disconnecting ack connection...');
            this.ackConnection.disconnect();
        } catch (e) {
            console.error('Error during ack connection disconnect:', e);
        }

        // console.log(`[Worker] Worker "${this.name}" stopped`);
        this.emit('stop');
    }

    private async getJob(): Promise<Job<T> | null> {
        if (this.jobBuffer.length > 0) {
            const job = this.jobBuffer.shift();
            // console.log(`[Worker] Got job ${job?.id} from buffer`);
            return job ? job : null;
        }
    
        await this.bufferLock.acquire();
        try {
            if (this.jobBuffer.length > 0) {
                const job = this.jobBuffer.shift();
                // console.log(`[Worker] Got job ${job?.id} from buffer after lock`);
                return job ? job : null;
            }
    
            const prefetch = this.opts?.prefetch ?? 10;
            // console.log(`[Worker] Buffer empty, fetching up to ${prefetch} new jobs...`);
            const jobs = await this.fetchJobsUseCase.execute(prefetch);
    
            if (jobs.length > 0) {
                // console.log(`[Worker] Fetched ${jobs.length} jobs`);
                this.jobBuffer.push(...jobs);
                const job = this.jobBuffer.shift();
                // console.log(`[Worker] Returning job ${job?.id} from new jobs`);
                return job ? job : null;
            }
    
            // console.log('[Worker] No new jobs found');
            return null;
        } finally {
            this.bufferLock.release();
        }
    }

    private async processNext(slotIndex: number): Promise<void> {
        while (this.isRunning) {
            try {
                // console.log(`[Worker slot ${slotIndex}] Waiting for job...`);
                const job = await this.getJob();

                if (job) {
                    this.activeJobs++;
                    // console.log(`[Worker slot ${slotIndex}] Starting job ${job.id}. Active jobs: ${this.activeJobs}`);
    
                    const updateProgress = async (progress: number) => {
                        await this.updateJobProgressUseCase.execute(job.id, progress);
                        job.progress = progress;
                        this.emit('progress', job, progress);
                    };
                    job.updateProgress = updateProgress;
    
                    try {
                        await this.processingSemaphore.acquire();
                        // console.log(`[Worker slot ${slotIndex}] Processing job ${job.id}`);
                        await this.processor(job);
    
                        await this.completeJobUseCase.execute(job.id);
                        job.status = 'completed';
                        job.completedAt = new Date();
                        // console.log(`[Worker slot ${slotIndex}] Completed job ${job.id}`);
                        this.emit('completed', job);
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        console.error(`[Worker slot ${slotIndex}] Failed job ${job.id}:`, err);
                        await this.failJobUseCase.execute(job, err);
                        job.status = 'failed';
                        job.failedAt = new Date();
                        job.error = err.message;
                        this.emit('failed', job, err);
                    } finally {
                        this.processingSemaphore.release();
                        this.activeJobs--;
                        // console.log(`[Worker slot ${slotIndex}] Finished job ${job.id}. Active jobs: ${this.activeJobs}`);
                    }
                } else {
                    // console.log(`[Worker slot ${slotIndex}] No job found, waiting...`);
                    await setTimeout(1);
                }
            } catch (error) {
                console.error(`[Worker slot ${slotIndex}] Error in processNext:`, error);
                if (error instanceof Error) {
                    this.emit('error', error);
                }
            }
        }
        console.log(`[Worker slot ${slotIndex}] Worker stopped.`);
    }
}
