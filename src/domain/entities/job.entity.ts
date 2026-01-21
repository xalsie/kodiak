export type JobStatus = "waiting" | "active" | "completed" | "failed" | "delayed";

export type BackoffStrategy = "fixed" | "exponential" | string;

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
        type: BackoffStrategy;
        delay: number;
    };
    repeat?: {
        every: number;
        limit?: number;
        count: number;
    };
    error?: string;
    progress?: number;
    processedAt?: Date;
    updateProgress: (progress: number) => Promise<void>;
}
