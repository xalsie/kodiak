import { Kodiak } from './kodiak';
import { AddJobUseCase } from '../application/use-cases/add-job.use-case';
import { RedisQueueRepository } from '../infrastructure/redis/redis-queue.repository';
import type { Job } from '../domain/entities/job.entity';
import type { JobOptions } from '../application/dtos/job-options.dto';

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
