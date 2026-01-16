import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { Kodiak } from './kodiak.js';
import { FetchJobUseCase } from '../application/use-cases/fetch-job.use-case.js';
import { CompleteJobUseCase } from '../application/use-cases/complete-job.use-case.js';
import { FailJobUseCase } from '../application/use-cases/fail-job.use-case.js';
import { UpdateJobProgressUseCase } from '../application/use-cases/update-job-progress.use-case.js';
import { RedisQueueRepository } from '../infrastructure/redis/redis-queue.repository.js';
import { Semaphore } from '../utils/semaphore.js';
import type { WorkerOptions } from '../application/dtos/worker-options.dto.js';
import type { Job } from '../domain/entities/job.entity.js';

export class Worker<T> extends EventEmitter {
    private fetchJobUseCases: FetchJobUseCase<T>[] = [];
    private readonly completeJobUseCase: CompleteJobUseCase<T>;
    private readonly failJobUseCase: FailJobUseCase<T>;
    private readonly updateJobProgressUseCase: UpdateJobProgressUseCase<T>;
    private isRunning = false;
    private activeJobs = 0;
    private blockingConnections: Redis[] = [];
    private ackConnection: Redis;
    private slotErrors: number[] = [];
    private processingSemaphore: Semaphore | null = null;

    constructor(
        public readonly name: string,
        private processor: (job: Job<T>) => Promise<void>,
        private readonly kodiak: Kodiak,
        private opts?: WorkerOptions,
    ) {
        super();

        this.ackConnection = kodiak.connection.duplicate();

        const ackQueueRepository = new RedisQueueRepository<T>(
            name,
            this.ackConnection,
            kodiak.prefix,
        );

        this.completeJobUseCase = new CompleteJobUseCase<T>(ackQueueRepository);
        this.failJobUseCase = new FailJobUseCase<T>(
            ackQueueRepository,
            opts?.backoffStrategies
        );
        this.updateJobProgressUseCase = new UpdateJobProgressUseCase<T>(ackQueueRepository);
    }

    /**
     * Start the worker processing loop.
     * Continuously fetches and processes jobs until stop() is called.
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            throw new Error(`Worker "${this.name}" is already running`);
        }
        this.isRunning = true;
        this.emit('start');
        
        const concurrency = this.opts?.concurrency ?? 1;
        const prefetch = this.opts?.prefetch ?? 0;

        const totalSlots = concurrency + prefetch;

        this.processingSemaphore = new Semaphore(concurrency);

        this.slotErrors = new Array(totalSlots).fill(0);

        for (let i = 0; i < totalSlots; i++) {
            const blockingConnection = this.kodiak.connection.duplicate();
            this.blockingConnections.push(blockingConnection);

            const blockingQueueRepository = new RedisQueueRepository<T>(
                this.name,
                blockingConnection,
                this.kodiak.prefix,
            );

            this.fetchJobUseCases.push(new FetchJobUseCase<T>(blockingQueueRepository));
            this.processNext(i);
        }
    }

    /**
     * Stop the worker gracefully.
     * Wait for active jobs to complete before returning.
     */
    public async stop(): Promise<void> {
        this.isRunning = false;

        while (this.activeJobs > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        await Promise.all(this.blockingConnections.map(c => c.quit()));
        this.blockingConnections = [];
        this.fetchJobUseCases = [];

        await this.ackConnection.quit();

        this.emit('stop');
    }

    /**
     * Internal: Process the next job in the queue.
     * Called recursively to form a continuous loop.
     */
    private processNext(slotIndex: number): void {
        if (!this.isRunning) {
            return;
        }

        const concurrency = this.opts?.concurrency ?? 1;
        const prefetch = this.opts?.prefetch ?? 0;
        const totalSlots = concurrency + prefetch;
        
        if (this.fetchJobUseCases.length > totalSlots) {
            return;
        }

        const fetchUseCase = this.fetchJobUseCases[slotIndex];

        if (!fetchUseCase) {
            return;
        }

        fetchUseCase
            .execute(2)
            .then(async (job: Job<T> | null) => {
                this.slotErrors[slotIndex] = 0;

                if (job) {
                    this.activeJobs++;

                    const updateProgress = async (progress: number) => {
                        await this.updateJobProgressUseCase.execute(job.id, progress);
                        job.progress = progress;
                        this.emit('progress', job, progress);
                    };
                    job.updateProgress = updateProgress;

                    try {
                        if (this.processingSemaphore) {
                            await this.processingSemaphore.acquire();
                        }
                        
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
                        if (this.processingSemaphore) {
                            this.processingSemaphore.release();
                        }
                        this.activeJobs--;
                    }
                } else {
                    // No job available, loop again immediately (checking isRunning)
                    // We already blocked for 2s, so no need to sleep more
                }
            })
            .catch((error: Error) => {
                if (!this.isRunning && (error.message === 'Connection is closed' || error.message.includes('Connection is closed'))) {
                    return;
                }
                
                this.slotErrors[slotIndex]++;
                this.emit('error', error);
            })
            .finally(() => {
                if (this.isRunning) {
                    const errorCount = this.slotErrors[slotIndex];
                    if (errorCount > 0) {
                        const delay = Math.min(1000 * Math.pow(2, errorCount - 1), 30000);
                        setTimeout(() => this.processNext(slotIndex), delay);
                    } else {
                        // Use setImmediate to avoid stack overflow and allow GC
                        setImmediate(() => this.processNext(slotIndex));
                    }
                }
            });
    }
}
