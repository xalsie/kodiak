import type { IQueueRepository } from '../../domain/repositories/queue.repository.js';
import type { Job } from '../../domain/entities/job.entity.js';
import type { BackoffStrategy } from '../../domain/strategies/backoff.strategy.js';

export class FailJobUseCase<T> {
    constructor(
        private readonly queueRepository: IQueueRepository<T>,
        private readonly backoffStrategies: Record<string, BackoffStrategy> = {}
    ) {}

    async execute(job: Job<T>, error: Error): Promise<void> {
        let nextAttempt: Date | undefined;

        if (job.backoff) {
            const { type, delay } = job.backoff;
            const attemptsMade = job.retryCount + 1;
            
            let backoffDelay: number | null = null;

            if (type === 'fixed') {
                backoffDelay = delay;
            } else if (type === 'exponential') {
                backoffDelay = delay * Math.pow(2, attemptsMade - 1);
            } else if (this.backoffStrategies[type]) {
                backoffDelay = this.backoffStrategies[type](attemptsMade, delay);
            }

            if (backoffDelay !== null) {
                nextAttempt = new Date(Date.now() + backoffDelay);
            }
        }

        await this.queueRepository.markAsFailed(job.id, error.message, new Date(), nextAttempt);
    }
}
