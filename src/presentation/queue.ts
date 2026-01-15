import { Kodiak } from './kodiak.js';
import { AddJobUseCase } from '../application/use-cases/add-job.use-case.js';
import { RedisQueueRepository } from '../infrastructure/redis/redis-queue.repository.js';
import type { Job } from '../domain/entities/job.entity.js';
import type { JobOptions } from '../application/dtos/job-options.dto.js';

export class Queue<T> {
    private readonly addJobUseCase: AddJobUseCase<T>;
    private readonly queueRepository: RedisQueueRepository<T>;
    private schedulerInterval: NodeJS.Timeout | null = null;

    constructor(
        public readonly name: string,
        private readonly kodiak: Kodiak,
    ) {
        this.queueRepository = new RedisQueueRepository<T>(name, kodiak.connection, kodiak.prefix);
        this.addJobUseCase = new AddJobUseCase<T>(this.queueRepository);
        
        // Start scheduler for delayed jobs
        this.startScheduler();
    }

    public async add(id: string, data: T, options?: JobOptions): Promise<Job<T>> {
        return this.addJobUseCase.execute(id, data, options);
    }

    private startScheduler() {
        if (this.schedulerInterval) return;

        // Check for delayed jobs every 5 seconds
        // In a real production environment, this should probably be configurable
        // or handled by a dedicated "Scheduler" component to avoid having too many timers
        // if many queues are created.
        this.schedulerInterval = setInterval(async () => {
            try {
                await this.queueRepository.promoteDelayedJobs();
            } catch (error) {
                console.error(`Error promoting delayed jobs for queue ${this.name}:`, error);
            }
        }, 5000);
    }

    public async close(): Promise<void> {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
    }
}
