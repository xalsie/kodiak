import type { Job } from '../entities/job.entity.js';

export interface IQueueRepository<T> {
    add(job: Job<T>, score: number, isDelayed: boolean): Promise<void>;
    fetchNext(timeout?: number): Promise<Job<T> | null>;
    fetchNextJobs(count: number): Promise<Job<T>[]>;
    markAsCompleted(jobId: string, completedAt: Date): Promise<void>;
    markAsFailed(jobId: string, error: string, failedAt: Date, nextAttempt?: Date): Promise<void>;
    updateProgress(jobId: string, progress: number): Promise<void>;
}
