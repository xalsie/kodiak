import type { IQueueRepository } from '../../domain/repositories/queue.repository';

export class FailJobUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    async execute(jobId: string, error: Error): Promise<void> {
        await this.queueRepository.markAsFailed(jobId, error.message, new Date());
    }
}
