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

    /**
     * Mode of the limiter. Defaults to token-bucket when omitted for backward compatibility.
     */
    mode?: "token-bucket" | "sliding-window";

    /**
     * Sliding window configuration (used when mode === 'sliding-window').
     */
    slidingWindow?: {
        /** window size in milliseconds */
        windowSizeMs: number;
        /** max number of events allowed in the sliding window */
        limit: number;
        /** action when the limit is reached */
        policy?: "reject" | "delay" | "enqueue";
        /** delay applied when policy === 'delay' (ms) */
        delayMs?: number;
        /** precision, usually 'ms' (default) */
        precision?: "ms" | "s";
    };
}

export default RateLimiterOptions;
