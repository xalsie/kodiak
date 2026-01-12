import { EventEmitter } from 'events';
import { Kodiak } from './kodiak';
import { FetchJobUseCase } from '../application/use-cases/fetch-job.use-case';
import { CompleteJobUseCase } from '../application/use-cases/complete-job.use-case';
import { FailJobUseCase } from '../application/use-cases/fail-job.use-case';
import { RedisQueueRepository } from '../infrastructure/redis/redis-queue.repository';
import type { WorkerOptions } from '../application/dtos/worker-options.dto';
import type { Job } from '../domain/entities/job.entity';

export class Worker<T> extends EventEmitter {
    private readonly fetchJobUseCase: FetchJobUseCase<T>;
    private readonly completeJobUseCase: CompleteJobUseCase<T>;
    private readonly failJobUseCase: FailJobUseCase<T>;
    private isRunning = false;
    private activeJobs = 0;

    constructor(
        public readonly name: string,
        private processor: (job: T) => Promise<void>,
        private readonly kodiak: Kodiak,
        private opts?: WorkerOptions,
    ) {
        super();
        const queueRepository = new RedisQueueRepository<T>(
            name,
            kodiak.connection,
            kodiak.prefix,
        );
        this.fetchJobUseCase = new FetchJobUseCase<T>(queueRepository);
        this.completeJobUseCase = new CompleteJobUseCase<T>(queueRepository);
        this.failJobUseCase = new FailJobUseCase<T>(queueRepository);
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
        this.processNext();
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
        this.emit('stop');
    }

    /**
     * Internal: Process the next job in the queue.
     * Called recursively to form a continuous loop.
     */
    private processNext(): void {
        if (!this.isRunning) {
            return;
        }

        const maxConcurrency = this.opts?.concurrency ?? 1;
        if (this.activeJobs >= maxConcurrency) {
            // Wait a bit before trying again
            setTimeout(() => this.processNext(), 100);
            return;
        }

        this.activeJobs++;

        this.fetchJobUseCase
            .execute()
            .then(async (job: Job<T> | null) => {
                if (job) {
                    try {
                        // Call the user's processor function
                        await this.processor(job.data);

                        // Mark as completed
                        await this.completeJobUseCase.execute(job.id);
                        this.emit('completed', job);
                    } catch (error) {
                        // Mark as failed
                        const err = error instanceof Error ? error : new Error(String(error));
                        await this.failJobUseCase.execute(job.id, err);
                        this.emit('failed', job, err);
                    }
                } else {
                    // No job available, wait a bit before polling again
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            })
            .catch((error: Error) => {
                this.emit('error', error);
            })
            .finally(() => {
                this.activeJobs--;
                // Schedule the next iteration
                if (this.isRunning) {
                    setImmediate(() => this.processNext());
                }
            });
    }
}
