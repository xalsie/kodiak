export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

export interface Job<T> {
    id: string;
    data: T;
    status: JobStatus;
    priority: number; // 1 (High) to 10 (Normal) to 100 (Low)
    addedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    failedAt?: Date;
    retryCount: number;
    maxAttempts: number;
    error?: string;
    processedAt?: Date;
}
