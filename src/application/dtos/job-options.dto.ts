/**
 * Backoff configuration for retries.
 */
export interface BackoffOptions {
    /**
     * Type of backoff to use.
     * - "fixed": fixed delay between attempts
     * - "exponential": exponential backoff
     *
     * Examples:
     * - { type: "fixed", delay: 1000 }
     * - { type: "exponential", delay: 500 }
     */
    type: "fixed" | "exponential";
    /**
     * Base delay in milliseconds (used as fixed delay or base for exponential).
     * Examples:
     * - 500
     * - 1000
     */
    delay: number;
}

/**
 * Options for repeating jobs.
 */
export interface RepeatOptions {
    /**
     * Interval in milliseconds between repeats.
     * 
     * Examples:
     * - 60000 (repeat every 60 seconds)
     * - 300000 (repeat every 5 minutes)
     */
    every: number;
    /**
     * Optional limit of repetitions.
     * 
     * Examples:
     * - 5 (repeat up to 5 times)
     * - 10 (repeat up to 10 times)
     */
    limit?: number;
}

/**
 * Options when adding a job to the queue.
 *
 * Examples and usage:
 *
 * Basic priority and delay:
 * ```ts
 * const opts: JobOptions = { priority: 1, delay: 5000 };
 * // adds job with priority 1, scheduled after 5 seconds
 * ```
 *
 * Schedule at a specific Date:
 * ```ts
 * const opts: JobOptions = { waitUntil: new Date(Date.now() + 60_000) };
 * // run the job in ~60 seconds
 * ```
 *
 * Retry attempts with fixed backoff:
 * ```ts
 * const opts: JobOptions = {
 *   attempts: 3,
 *   backoff: { type: 'fixed', delay: 1000 }
 * };
 * ```
 *
 * Retry attempts with exponential backoff:
 * ```ts
 * const opts: JobOptions = {
 *   attempts: 5,
 *   backoff: { type: 'exponential', delay: 500 }
 * };
 * // delays: 500, 1000, 2000, 4000, ... (implementation dependent)
 * ```
 *
 * Recurring job example:
 * ```ts
 * const opts: JobOptions = { repeat: { every: 60_000, limit: 10 } };
 * // run job every minute, up to 10 times
 * ```
 */
export interface JobOptions {
    /**
     * Job priority (higher number = higher priority).
     * 
     * Examples:
     * - 0 (low priority)
     * - 1 (normal priority)
     * - 5 (high priority)
     * - 10 (urgent priority)
     *
     * Usage:
     * ```ts
     * const opts: JobOptions = { priority: 5 };
     * ```
     */
    priority?: number;

    /**
     * Delay in milliseconds before the job becomes available.
     * 
     * Examples:
     * - 0 (no delay)
     * - 5000 (5 seconds delay)
     * - 60000 (1 minute delay)
     *
     * Usage:
     * ```ts
     * const opts: JobOptions = { delay: 5000 };
     * ```
     */
    delay?: number;

    /**
     * Exact Date until which the job should wait before being processed.
     * 
     * Examples:
     * - new Date(Date.now() + 10000) (wait 10 seconds)
     * - new Date(Date.now() + 60000) (wait 1 minute)
     * - new Date(Date.now() + 3600000) (wait 1 hour)
     *
     * Usage:
     * ```ts
     * const opts: JobOptions = { waitUntil: new Date(Date.now() + 30000) };
     * ```
     */
    waitUntil?: Date;

    /**
     * Number of attempts before giving up.
     * 
     * Examples:
     * - 1 (single attempt)
     * - 3 (default retry behavior)
     * - 5 (more retries for critical jobs)
     *
     * Usage:
     * ```ts
     * const opts: JobOptions = { attempts: 5 };
     * ```
     */
    attempts?: number;

    /**
     * Backoff configuration for retries.
     *
     * Usage:
     * ```ts
     * const opts: JobOptions = {
     *   attempts: 3,
     *   backoff: { type: 'fixed', delay: 1000 }
     * };
     * ```
     */
    backoff?: BackoffOptions;

    /**
     * Repeat configuration for recurring jobs.
     * 
     * Optional.
     *
     * Usage:
     * ```ts
     * const opts: JobOptions = { repeat: { every: 60000, limit: 10 } };
     * ```
     */
    repeat?: RepeatOptions;
}
