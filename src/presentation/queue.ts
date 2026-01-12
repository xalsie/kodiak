import { Kodiak } from './kodiak.js';
import { AddJobUseCase } from '../application/use-cases/add-job.use-case.js';
import { RedisQueueRepository } from '../infrastructure/redis/redis-queue.repository.js';
import type { Job } from '../domain/entities/job.entity.js';
import type { JobOptions } from '../application/dtos/job-options.dto.js';

export class Queue<T> {
    private readonly addJobUseCase: AddJobUseCase<T>;

    constructor(
        public readonly name: string,
        private readonly kodiak: Kodiak,
    ) {
        const queueRepository = new RedisQueueRepository<T>(name, kodiak.connection, kodiak.prefix);
        this.addJobUseCase = new AddJobUseCase<T>(queueRepository);
    }

    public async add(id: string, data: T, options?: JobOptions): Promise<Job<T>> {
        return this.addJobUseCase.execute(id, data, options);
    }
}
