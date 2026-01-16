import type { IQueueRepository } from '../../domain/repositories/queue.repository.js';

export class UpdateJobProgressUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    async execute(jobId: string, progress: number): Promise<void> {
        await this.queueRepository.updateProgress(jobId, progress);
    }
}
