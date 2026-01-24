import type { Job } from "../entities/job.entity.js";

export interface IQueueRepository<T> {
    add(job: Job<T>, score: number, isDelayed: boolean): Promise<void>;
    fetchNext(timeout?: number): Promise<Job<T> | null>;
    fetchNextJobs(count: number, lockDuration: number, ownerToken?: string): Promise<Job<T>[]>;
    markAsCompleted(jobId: string, completedAt: Date): Promise<void>;
    markAsFailed(jobId: string, error: string, failedAt: Date, nextAttempt?: Date): Promise<void>;
    updateProgress(jobId: string, progress: number): Promise<void>;
    promoteDelayedJobs(limit?: number): Promise<number>;
    recoverStalledJobs(): Promise<string[]>;
    extendLock(jobId: string, lockExpiresAt: number, ownerToken?: string): Promise<boolean>;
}
