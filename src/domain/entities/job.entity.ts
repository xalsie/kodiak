export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

export interface Job<T> {
    id: string;
    data: T;
    status: JobStatus;
    priority: number;
    addedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    failedAt?: Date;
    retryCount: number;
    maxAttempts: number;
    backoff?: {
        type: 'fixed' | 'exponential' | string;
        delay: number;
    };
    repeat?: {
        every: number;
        limit?: number;
        count: number;
    };
    error?: string;
    processedAt?: Date;
}
