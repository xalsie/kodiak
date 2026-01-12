import type { IQueueRepository } from '../../domain/repositories/queue.repository.js';

export class CompleteJobUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    async execute(jobId: string): Promise<void> {
        await this.queueRepository.markAsCompleted(jobId, new Date());
    }
}
