import type { Job } from '../../domain/entities/job.entity';
import type { IQueueRepository } from '../../domain/repositories/queue.repository';

export class FetchJobUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    async execute(): Promise<Job<T> | null> {
        return this.queueRepository.fetchNext();
    }
}
