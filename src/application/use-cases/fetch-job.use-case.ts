import type { Job } from "../../domain/entities/job.entity.js";
import type { IQueueRepository } from "../../domain/repositories/queue.repository.js";

export class FetchJobUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    async execute(timeout?: number): Promise<Job<T> | null> {
        return this.queueRepository.fetchNext(timeout);
    }
}
