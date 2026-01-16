import type { Job } from '../../domain/entities/job.entity.js';
import type { IQueueRepository } from '../../domain/repositories/queue.repository.js';
import type { JobOptions } from '../dtos/job-options.dto.js';

export class AddJobUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    async execute(id: string, data: T, options?: JobOptions): Promise<Job<T>> {
        const priority = options?.priority ?? 10;
        const delay =
            options?.delay ?? (options?.waitUntil ? options.waitUntil.getTime() - Date.now() : 0);

        const job: Job<T> = {
            id,
            data,
            status: delay > 0 ? 'delayed' : 'waiting',
            priority,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: options?.attempts ?? 1,
        };

        const now = Date.now();
        const score = priority * 10000000000000 + (now + delay);

        await this.queueRepository.add(job, score, delay > 0);
        return job;
    }
}
