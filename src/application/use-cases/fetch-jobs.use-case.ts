import type { Job } from '../../domain/entities/job.entity.js';
import type { IQueueRepository } from '../../domain/repositories/queue.repository.js';

export class FetchJobsUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    async execute(count: number): Promise<Job<T>[]> {
        return this.queueRepository.fetchNextJobs(count);
    }
}
