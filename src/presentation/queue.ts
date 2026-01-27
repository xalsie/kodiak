import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { Kodiak } from "./kodiak.js";
import { AddJobUseCase } from "../application/use-cases/add-job.use-case.js";
import { RedisQueueRepository } from "../infrastructure/redis/redis-queue.repository.js";
import type { Job } from "../domain/entities/job.entity.js";
import type { JobOptions } from "../application/dtos/job-options.dto.js";
import type { QueueOptions } from "../application/dtos/queue-options.dto.js";

export class Queue<T> extends EventEmitter {
    private readonly addJobUseCase: AddJobUseCase<T>;
    private readonly queueRepository: RedisQueueRepository<T>;
    private schedulerInterval: NodeJS.Timeout | null = null;
    private recoveringStalledJobs = false;
    private subscriber: Redis | null = null;
    private delayedTimers: Map<string, NodeJS.Timeout> = new Map();
    private readonly connection: Redis;

    constructor(
        public readonly name: string,
        private readonly kodiak: Kodiak,
        opts?: QueueOptions,
    ) {
        super();

        this.connection = this.kodiak.connection.duplicate();
        this.queueRepository = new RedisQueueRepository<T>(
            name,
            this.connection,
            this.kodiak.prefix,
            opts?.rateLimiter,
        );
        this.addJobUseCase = new AddJobUseCase<T>(this.queueRepository);

        this.startScheduler();

        // Listen for repository events to schedule local timers when delayed jobs are scheduled
        this.queueRepository.on("delayedScheduled", (jobId: string, scheduledTs: number) => {
            try {
                const now = Date.now();
                const delay = Math.max(0, scheduledTs - now);
                console.log(new Date().toISOString(), `[queue] scheduling local timer for job=${jobId} delay=${delay}ms (scheduledTs=${scheduledTs})`);
                // clear existing timer for this job if present
                const existing = this.delayedTimers.get(jobId);
                if (existing) {
                    clearTimeout(existing);
                }
                const t = setTimeout(async () => {
                    console.log(new Date().toISOString(), `[queue] local timer fired for job=${jobId}`);
                    try {
                        // Promote delayed jobs when timer fires
                        await this.queueRepository.promoteDelayedJobs();
                        console.log(new Date().toISOString(), `[queue] promoteDelayedJobs called by local timer for job=${jobId}`);
                    } catch (err) {
                        this.emit("error", err as Error);
                    } finally {
                        this.delayedTimers.delete(jobId);
                    }
                }, delay);
                this.delayedTimers.set(jobId, t);
            } catch (err) {
                this.emit("debug", "failed to schedule local delayed timer", err as Error);
            }
        });
    }

    public async add(id: string, data: T, options?: JobOptions): Promise<Job<T>> {
        return this.addJobUseCase.execute(id, data, options);
    }

    private startScheduler() {
        if (this.schedulerInterval) return;

        this.schedulerInterval = setInterval(async () => {
            try {
                console.log(new Date().toISOString(), "[queue] periodic scheduler calling promoteDelayedJobs");
                await this.queueRepository.promoteDelayedJobs();
            } catch (error) {
                this.emit("error", error);
            }

            if (this.recoveringStalledJobs) return;
            this.recoveringStalledJobs = true;
            try {
                const recovered = await this.queueRepository.recoverStalledJobs();
                if (recovered && Array.isArray(recovered) && recovered.length > 0) {
                    this.emit("info",
                        `[Queue:${this.name}] Recovered ${recovered.length} stalled job(s): ${recovered.join(", ")}`,
                    );
                }
            } catch (error) {
                this.emit("error", error);
            } finally {
                this.recoveringStalledJobs = false;
            }
        }, 5000);

        // Start a subscriber to keyspace expired events so we can promote delayed
        // jobs immediately when their per-job timer key expires. This requires
        // Redis 'notify-keyspace-events' to include 'Ex' (expired events).
        try {
            this.subscriber = this.kodiak.connection.duplicate();
            this.subscriber.psubscribe("__keyevent@*__:expired");

            this.subscriber.on("pmessage", async (_pattern: string, _channel: string, message: string) => {
                try {
                    console.log(new Date().toISOString(), "[queue] keyspace expired message", message);
                    const timerPrefix = `${this.kodiak.prefix}:delayed:timer:`;
                    if (typeof message === "string" && message.startsWith(timerPrefix)) {
                        // A timer for a delayed job expired — promote delayed jobs now
                        await this.queueRepository.promoteDelayedJobs();
                        console.log(new Date().toISOString(), `[queue] promoteDelayedJobs called by keyspace event for ${message}`);
                    }
                } catch (err) {
                    this.emit("error", err as Error);
                }
            });
        } catch (err) {
            // Not fatal — we keep the periodic scheduler as fallback
            this.emit("info", `[Queue:${this.name}] keyspace subscriber not started: ${String(err)}`);
        }
    }

    public async close(): Promise<void> {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
        if (this.subscriber) {
            try {
                await this.subscriber.quit();
            } catch (_) {
                try {
                    (this.subscriber as any).disconnect();
                } catch (_) {
                    // ignore
                }
            }
            this.subscriber = null;
        }
        // clear any local delayed timers
        for (const t of this.delayedTimers.values()) {
            try {
                clearTimeout(t);
            } catch (_) {
                // ignore
            }
        }
        this.delayedTimers.clear();
        await this.connection.quit();
    }
}
