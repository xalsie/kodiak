import { BackoffStrategy } from "../../domain/strategies/backoff.strategy.js";

/**
 * Configuration options for worker behavior.
 * All fields are optional.
 */
export interface WorkerOptions {
   /**
    * Maximum number of concurrent workers processing tasks.
    * 
    * Optional. Default: 1
    * 
    * Example: 5
    */
   concurrency?: number;

   /**
    * Number of messages to prefetch per worker.
    * 
    * Optional. Default: 100
    * 
    * Examples:
    * - 50 (small workers)
    * - 500 (high-throughput worker with lots of memory)
    *
    * Usage:
    * ```ts
    * const opts: WorkerOptions = { prefetch: 50 };
    * ```
    */
   prefetch?: number;

   /**
    * Lock duration in milliseconds for a claimed task.
    * 
    * Optional. Default: 30000 (30 seconds)
    * 
    * Examples:
    * - 30000 (default, reasonable for short tasks)
    * - 60000 (longer tasks)
    * - 120000 (very long-running tasks)
    *
    * Usage:
    * ```ts
    * const opts: WorkerOptions = { lockDuration: 60000 };
    * ```
    */
   lockDuration?: number;

   /**
    * Time in milliseconds to wait for in-flight tasks to finish during shutdown.
    * 
    * Optional. Default: 30000 (30 seconds)
    * 
    * Examples:
    * - 15000 (short grace period)
    * - 30000 (default)
    * - 120000 (allow long jobs to finish)
    *
    * Usage:
    * ```ts
    * const opts: WorkerOptions = { gracefulShutdownTimeout: 120000 };
    * ```
    */
   gracefulShutdownTimeout?: number;

   /**
    * Map of named backoff strategies used for retrying tasks.
    * 
    * Optional. Default: {}
    * 
    * ```json
    * Example: {
    *  "exponential": myExponentialBackoff
    * }
    * ```
    *
    * More examples:
    * More examples (implementations must be functions matching BackoffStrategy:
    * ```ts
    * import type { BackoffStrategy } from "../../domain/strategies/backoff.strategy";
    *
    * const backoffStrategies: Record<string, BackoffStrategy> = {
    *   fixed: (attemptsMade, delay) => delay,
    *   exponential: (attemptsMade, delay) => delay * Math.pow(2, attemptsMade - 1),
    * };
    *
    * const opts: WorkerOptions = { backoffStrategies };
    * ```
    */
   backoffStrategies?: Record<string, BackoffStrategy>;

   /**
    * Enable or disable heartbeat mechanism that periodically extends locks.
    * 
    * Optional. Default: false
    * 
    * Examples:
    * - `false` (keep current stalled-detection only)
    * - `true` (enable heartbeat; worker will periodically refresh locks)
    *
    * Usage:
    * ```ts
    * const opts: WorkerOptions = { heartbeatEnabled: true };
    * ```
    */
   heartbeatEnabled?: boolean;

   /**
    * Interval in milliseconds between heartbeats.
    * 
    * Optional. Default: Math.max(1000, lockDuration/2)
    * 
    * Examples:
    * - 1000 (very frequent, higher Redis load)
    * - 5000 (balanced)
    * - 15000 (infrequent, suitable for long lockDuration)
    *
    * Usage:
    * ```ts
    * const opts: WorkerOptions = { heartbeatEnabled: true, heartbeatInterval: 5000 };
    * ```
    */
   heartbeatInterval?: number;
}
