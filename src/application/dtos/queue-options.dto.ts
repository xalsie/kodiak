import type { RateLimiterOptions } from "./rate-limiter-options.dto.js";

/**
 * Options for creating a Queue.
 *
 * This DTO centralizes configuration that affects queue behavior at creation time.
 */
export interface QueueOptions {
    /**
     * Optional per-queue rate limiter. See `RateLimiterOptions` for runtime semantics.
     *
     * When provided, the repository will enforce token consumption via a Redis-backed
     *
     * token-bucket. Workers will adapt `prefetch` to the bucket `capacity` when needed.
     */
    rateLimiter?: RateLimiterOptions;

    // Future fields: paused?: boolean; priorityConfig?: ...
}

export default QueueOptions;
