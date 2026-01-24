import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { Kodiak } from "./kodiak.js";
import { AddJobUseCase } from "../application/use-cases/add-job.use-case.js";
import { RedisQueueRepository } from "../infrastructure/redis/redis-queue.repository.js";
import type { Job } from "../domain/entities/job.entity.js";
import type { JobOptions } from "../application/dtos/job-options.dto.js";

export class Queue<T> extends EventEmitter {
    private readonly addJobUseCase: AddJobUseCase<T>;
    private readonly queueRepository: RedisQueueRepository<T>;
    private schedulerInterval: NodeJS.Timeout | null = null;
    private recoveringStalledJobs = false;
    private readonly connection: Redis;

    constructor(
        public readonly name: string,
        private readonly kodiak: Kodiak,
    ) {
        super();

        this.connection = this.kodiak.connection.duplicate();
        this.queueRepository = new RedisQueueRepository<T>(
            name,
            this.connection,
            this.kodiak.prefix,
        );
        this.addJobUseCase = new AddJobUseCase<T>(this.queueRepository);

        this.startScheduler();
    }

    public async add(id: string, data: T, options?: JobOptions): Promise<Job<T>> {
        return this.addJobUseCase.execute(id, data, options);
    }

    private startScheduler() {
        if (this.schedulerInterval) return;

        this.schedulerInterval = setInterval(async () => {
            try {
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
    }

    public async close(): Promise<void> {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
        await this.connection.quit();
    }
}
