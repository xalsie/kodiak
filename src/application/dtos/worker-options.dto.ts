import { BackoffStrategy } from '../../domain/strategies/backoff.strategy.js';

export interface WorkerOptions {
    concurrency?: number;
    prefetch?: number;
    backoffStrategies?: Record<string, BackoffStrategy>;
}
