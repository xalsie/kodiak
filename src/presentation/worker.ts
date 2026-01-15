import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { Kodiak } from './kodiak.js';
import { FetchJobUseCase } from '../application/use-cases/fetch-job.use-case.js';
import { CompleteJobUseCase } from '../application/use-cases/complete-job.use-case.js';
import { FailJobUseCase } from '../application/use-cases/fail-job.use-case.js';
import { RedisQueueRepository } from '../infrastructure/redis/redis-queue.repository.js';
import { Semaphore } from '../utils/semaphore.js';
import type { WorkerOptions } from '../application/dtos/worker-options.dto.js';
import type { Job } from '../domain/entities/job.entity.js';

export class Worker<T> extends EventEmitter {
    private fetchJobUseCases: FetchJobUseCase<T>[] = [];
    private readonly completeJobUseCase: CompleteJobUseCase<T>;
    private readonly failJobUseCase: FailJobUseCase<T>;
    private isRunning = false;
    private activeJobs = 0;
    private blockingConnections: Redis[] = [];
    private ackConnection: Redis;
    private slotErrors: number[] = [];
    private processingSemaphore: Semaphore | null = null;

    constructor(
        public readonly name: string,
        private processor: (job: T) => Promise<void>,
        private readonly kodiak: Kodiak,
        private opts?: WorkerOptions,
    ) {
        super();
        
        // Dedicated connection for acknowledgments (complete/fail)
        // prevents blocking the main application connection
        this.ackConnection = kodiak.connection.duplicate();

        const ackQueueRepository = new RedisQueueRepository<T>(
            name,
            this.ackConnection,
            kodiak.prefix,
        );

        this.completeJobUseCase = new CompleteJobUseCase<T>(ackQueueRepository);
        this.failJobUseCase = new FailJobUseCase<T>(ackQueueRepository);
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
        
        // Total slots = concurrency + prefetch
        // This means we can have 'totalSlots' jobs fetched and "Active" in Redis/Memory
        // But only 'concurrency' jobs are actually executing the processor function
        const totalSlots = concurrency + prefetch;

        this.processingSemaphore = new Semaphore(concurrency);

        // Reset error counters
        this.slotErrors = new Array(totalSlots).fill(0);

        // Create a dedicated blocking connection and use case for each slot
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
        // Wait for active jobs to complete
        while (this.activeJobs > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Close all blocking connections
        await Promise.all(this.blockingConnections.map(c => c.quit()));
        this.blockingConnections = [];
        this.fetchJobUseCases = [];

        // Close ack connection
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
        
        // Safety check to ensure we don't exceed total allowed active jobs
        if (this.fetchJobUseCases.length > totalSlots) {
            return;
        }

        const fetchUseCase = this.fetchJobUseCases[slotIndex];

        if (!fetchUseCase) {
             // Should not happen if logic is correct
            return;
        }

        fetchUseCase
            .execute(2) // Block for up to 2 seconds
            .then(async (job: Job<T> | null) => {
                // Success (or successful timeout) - reset error count
                this.slotErrors[slotIndex] = 0;

                if (job) {
                    this.activeJobs++;
                    try {
                        // Acquire semaphore before processing
                        // This implements the prefetch logic: we hold the job but wait for CPU slot
                        if (this.processingSemaphore) {
                            await this.processingSemaphore.acquire();
                        }
                        
                        // Call the user's processor function
                        await this.processor(job.data);

                        // Mark as completed
                        await this.completeJobUseCase.execute(job.id);
                        job.status = 'completed';
                        job.completedAt = new Date();
                        this.emit('completed', job);
                    } catch (error) {
                        // Mark as failed
                        const err = error instanceof Error ? error : new Error(String(error));
                        await this.failJobUseCase.execute(job.id, err);
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
                // Ignore connection closed error if we are stopping (caused by quit())
                if (!this.isRunning && (error.message === 'Connection is closed' || error.message.includes('Connection is closed'))) {
                    return;
                }
                
                this.emit('error', error);
                // Increment error count for this slot
                this.slotErrors[slotIndex]++;
            })
            .finally(() => {
                // Schedule the next iteration for THIS slot
                if (this.isRunning) {
                    const errorCount = this.slotErrors[slotIndex];
                    if (errorCount > 0) {
                        // Exponential backoff: 1s, 2s, 4s... max 30s
                        const delay = Math.min(1000 * Math.pow(2, errorCount - 1), 30000);
                        setTimeout(() => this.processNext(slotIndex), delay);
                    } else {
                        setImmediate(() => this.processNext(slotIndex));
                    }
                }
            });
    }
}
