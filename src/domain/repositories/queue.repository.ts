import type { Job } from '../entities/job.entity.js';

export interface IQueueRepository<T> {
    add(job: Job<T>, score: number, isDelayed: boolean): Promise<void>;
    fetchNext(): Promise<Job<T> | null>;
    markAsCompleted(jobId: string, completedAt: Date): Promise<void>;
    markAsFailed(jobId: string, error: string, failedAt: Date): Promise<void>;
}
