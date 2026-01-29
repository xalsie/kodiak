import IORedis from "ioredis";
import { RedisQueueRepository } from "../src/infrastructure/redis/redis-queue.repository";

async function main() {
    const redis = new IORedis();
    const repo = new RedisQueueRepository("my-queue", redis, "kodiak-example", {
        mode: "sliding-window",
        slidingWindow: { windowSizeMs: 60000, limit: 10, policy: "delay", delayMs: 500 },
    });

    // Use repo.add / repo.fetchNext as usual. The repo will apply sliding-window rate limiting
    // and move jobs to delayed when the limit is reached.

    // Example: add a job
    await repo.add({
        id: "example-job-1",
        data: { hello: "world" },
        priority: 1,
        retryCount: 0,
        maxAttempts: 1,
        addedAt: new Date(),
        status: "waiting",
        updateProgress: async () => {},
    }, Date.now(), false);

    await redis.quit();
}

main().catch(console.error);
