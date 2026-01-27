/**
 * Rate limiter configuration for a queue or worker.
 */
export interface RateLimiterOptions {
    /**
     * Tokens per second produced by the token-bucket.
     * - Typical value: 1..1000 depending on desired throughput.
     * - The bucket is refilled on each repository check using the Lua token_bucket script.
     */
    rate?: number;

    /**
     * Maximum burst capacity (number of tokens) the bucket can hold.
     * - If the worker's `prefetch` is larger than `capacity`, the worker will
     *   automatically reduce its effective prefetch to at most `capacity` to
     *   avoid requesting more tokens than available (see Worker logic).
     */
    capacity?: number;

    /**
     * Scope of the limiter. Currently only `queue` is implemented.
     * - `queue`: limiter is per-queue and uses Redis key `${prefix}:ratelimit:${queueName}`.
     * - `global`: reserved for future use — not implemented; behaviour is the same as `queue`.
     */
    scope?: "queue" | "global";
}

export default RateLimiterOptions;
