/* eslint-disable no-console */
// DEV ONLY

import { setTimeout } from "node:timers/promises";
import { Kodiak } from "../src/presentation/kodiak.js";

/**
 * Example: errorRetry.ts
 * Purpose: Demonstrate Kodiak queue/worker behavior including retries, backoff
 * strategies and how to observe job state in Redis.
 *
 * Structure:
 * 1. Setup Kodiak and Redis keys
 * 2. Create a worker with a processor that either fails or eventually succeeds
 * 3. Add sample jobs with differing backoff/attempts
 * 4. Wait for observable conditions (job-1 completed and job-2 reached max attempts)
 * 5. Inspect Redis state and shutdown cleanly
 */

interface JobData {
    mode: "succeed-on-3" | "always-fail";
}

async function main() {
    // ------------- Setup Kodiak and helpers -------------
    const kodiak = new Kodiak({ connection: { host: "127.0.0.1", port: 6379 } });
    // direct Redis client (for inspection)
    const redis = kodiak.connection;
    const prefix = kodiak.prefix;

    const job1Key = `${prefix}:jobs:job-1`;
    const job2Key = `${prefix}:jobs:job-2`;

    const ts = () => new Date().toISOString();

    // Create the queue and worker (the main API of Kodiak)
    const queue = kodiak.createQueue<JobData>("test-retry");

    // ------------- Worker / Processor -------------
    // Processor intentionally fails for first attempts to exercise retry logic
    const worker = kodiak.createWorker<JobData>(
        "test-retry",
        async (job) => {
            console.log(`${ts()} [processor] attempt for job=${job.id} retryCount=${job.retryCount}`);

            if (job.data.mode === "succeed-on-3") {
                // Fail twice, succeed on the 3rd execution
                if ((job.retryCount ?? 0) < 2) throw new Error("simulated failure (will retry)");
                console.log(`${ts()} [processor] job ${job.id} succeeded on attempt ${job.retryCount + 1}`);
                return;
            }

            if (job.data.mode === "always-fail") {
                throw new Error("simulated permanent failure");
            }
        },
        // Worker options: concurrency and lock/heartbeat settings
        { concurrency: 2, lockDuration: 10_000, heartbeatEnabled: false },
    );

    // Event listeners show runtime events and help inspect the internal flow
    worker.on("failed", async (job, err) => {
        const jobHash = await redis.hgetall(`${prefix}:jobs:${job.id}`);
        const nextAttempt = await redis.zscore(`${prefix}:queue:test-retry:delayed`, job.id);
        console.log(
            `${ts()} [worker] job ${job.id} failed (attempt=${job.retryCount}): ${err.message} ` +
            `| retry_count=${jobHash.retry_count} failed_at=${jobHash.failed_at} nextAttempt=${nextAttempt}`,
        );
    });

    worker.on("completed", (job) => {
        console.log(`${ts()} [worker] job ${job.id} completed`);
    });

    await worker.start();

    // ------------- Enqueue sample jobs -------------
    // job-1 demonstrates a job that will eventually succeed (succeed-on-3)
    await queue.add("job-1", { mode: "succeed-on-3" }, { attempts: 3, backoff: { type: "fixed", delay: 1000 } });
    console.log(`${ts()} [example] added job-1`);

    // job-2 demonstrates a job that always fails; we set higher attempts to observe behaviour
    await queue.add("job-2", { mode: "always-fail" }, {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 500,
        }
    });
    console.log(`${ts()} [example] added job-2`);

    // ------------- Wait for demonstration conditions -------------
    // We stop when job-1 reached 'completed' and job-2 reached its configured max attempts
    async function waitForConditions() {
        while (true) {
            const [state1, retry2, maxAttempt2] = await Promise.all([
                redis.hget(job1Key, "state"),
                redis.hget(job2Key, "retry_count"),
                redis.hget(job2Key, "max_attempts"),
            ]);
            if (state1 === "completed" && Number(retry2) === Number(maxAttempt2)) return;
            await setTimeout(250);
        }
    }

    await waitForConditions();

    // ------------- Inspect final states and shutdown -------------
    const job1 = await redis.hgetall(job1Key);
    const job2 = await redis.hgetall(job2Key);

    console.log("\n=== Job states ===");
    console.log("job-1:", job1);
    console.log("job-2:", job2);

    await worker.stop();
    await queue.close();
    await kodiak.close();
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
