import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Redis } from "ioredis";
import { Kodiak } from "./kodiak.js";
import { CompleteJobUseCase } from "../application/use-cases/complete-job.use-case.js";
import { FailJobUseCase } from "../application/use-cases/fail-job.use-case.js";
import { UpdateJobProgressUseCase } from "../application/use-cases/update-job-progress.use-case.js";
import { RedisQueueRepository } from "../infrastructure/redis/redis-queue.repository.js";
import { Semaphore } from "../utils/semaphore.js";
import { FetchJobsUseCase } from "../application/use-cases/fetch-jobs.use-case.js";
import type { WorkerOptions } from "../application/dtos/worker-options.dto.js";
import type { Job } from "../domain/entities/job.entity.js";

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
    private jobBuffers: Map<number, Job<T>[]> = new Map();
    private readonly bufferLock: Semaphore = new Semaphore(1);
    private processingPromises: Promise<void>[] = [];
    private ackQueueRepository: RedisQueueRepository<T>;
    private workerId: string;

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

        this.ackQueueRepository = ackQueueRepository;

        // Unique worker id used as lock owner token
        this.workerId = `${process.pid}-${randomUUID()}`;

        this.fetchJobsUseCase = new FetchJobsUseCase<T>(blockingQueueRepository);
        this.completeJobUseCase = new CompleteJobUseCase<T>(ackQueueRepository);
        this.failJobUseCase = new FailJobUseCase<T>(ackQueueRepository, opts?.backoffStrategies);
        this.updateJobProgressUseCase = new UpdateJobProgressUseCase<T>(ackQueueRepository);

        const concurrency = this.opts?.concurrency ?? 1;
        this.processingSemaphore = new Semaphore(concurrency);
    }

    public async start(): Promise<void> {
        if (this.isRunning) {
            throw new Error(`Worker "${this.name}" is already running`);
        }
        this.isRunning = true;
        this.emit("start");

        const concurrency = this.opts?.concurrency ?? 1;

        for (let i = 0; i < concurrency; i++) {
            this.jobBuffers.set(i, []);
            this.processingPromises.push(this.processNext(i));
        }
    }

    public async stop(): Promise<void> {
        this.isRunning = false;

        try {
            this.blockingConnection.disconnect();
        } catch (error) {
            this.emit("error", error);
        }

        const shutdownTimeout = this.opts?.gracefulShutdownTimeout ?? 30000;

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(shutdownTimeout).then(() => {
                reject(new Error(`Graceful shutdown timed out after ${shutdownTimeout}ms`));
            });
        });

        try {
            await Promise.race([Promise.all(this.processingPromises), timeoutPromise]);
        } catch (error) {
            this.emit("error", error);
        }

        try {
            this.ackConnection.disconnect();
        } catch (error) {
            this.emit("error", error);
        }

        this.emit("stop");
    }

    private async getJob(slotIndex: number, ownerToken: string): Promise<Job<T> | null> {
        const buffer = this.jobBuffers.get(slotIndex) ?? [];
        if (buffer.length > 0) {
            const job = buffer.shift();
            this.jobBuffers.set(slotIndex, buffer);
            return job ?? null;
        }

        await this.bufferLock.acquire();
        try {
            const prefetch = this.opts?.prefetch ?? 10;
            const lockDuration = this.opts?.lockDuration ?? 30_000;
            const jobs = await this.fetchJobsUseCase.execute(prefetch, lockDuration, ownerToken);

            if (jobs && jobs.length > 0) {
                // assign fetched jobs to this slot buffer
                const remaining = jobs.slice();
                const job = remaining.shift() as Job<T>;
                this.jobBuffers.set(slotIndex, remaining);
                return job ?? null;
            }

            return null;
        } finally {
            this.bufferLock.release();
        }
    }

    private async processNext(slotIndex: number): Promise<void> {
        const ownerToken = `${this.workerId}:${slotIndex}`;
        while (this.isRunning) {
            try {
                const job = await this.getJob(slotIndex, ownerToken);

                if (job) {
                    this.activeJobs++;

                    const updateProgress = async (progress: number) => {
                        await this.updateJobProgressUseCase.execute(job.id, progress);
                        job.progress = progress;
                        this.emit("progress", job, progress);
                    };
                    job.updateProgress = updateProgress;

                    let heartbeatTimer: NodeJS.Timeout | null = null;
                    try {
                        await this.processingSemaphore.acquire();

                        const lockDuration = this.opts?.lockDuration ?? 30_000;
                        const heartbeatEnabled = this.opts?.heartbeatEnabled ?? false;
                        if (heartbeatEnabled) {
                            const heartbeatInterval =
                                this.opts?.heartbeatInterval ?? Math.max(1000, Math.floor(lockDuration / 2));
                            heartbeatTimer = setInterval(async () => {
                                try {
                                    await this.ackQueueRepository.extendLock(
                                        job.id,
                                        Date.now() + lockDuration,
                                        ownerToken,
                                    );
                                } catch (error) {
                                    this.emit("error", error);
                                }
                            }, heartbeatInterval);
                        }

                        await this.processor(job);

                        await this.completeJobUseCase.execute(job.id);
                        job.status = "completed";
                        job.completedAt = new Date();
                        this.emit("completed", job);
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        await this.failJobUseCase.execute(job, err);
                        job.status = "failed";
                        job.failedAt = new Date();
                        job.error = err.message;
                        this.emit("failed", job, err);
                    } finally {
                        if (heartbeatTimer) clearInterval(heartbeatTimer);
                        this.processingSemaphore.release();
                        this.activeJobs--;
                    }
                } else {
                    await setTimeout(100);
                }
            } catch (error) {
                if (error instanceof Error) {
                    this.emit("error", error);
                }
            }
        }
    }
}
