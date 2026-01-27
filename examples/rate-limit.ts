/* eslint-disable no-console */
// DEV ONLY

import { Kodiak } from "../src/presentation/kodiak.js";
import type { Job } from "../src/domain/entities/job.entity.js";

// Demo : Queue + Worker avec rate limiting

const kodiak = new Kodiak({
    connection: { host: "127.0.0.1", port: 6379 },
});

interface Payload {
    text: string;
}

// Crée la queue avec un rate limiter à 2 tokens/sec et capacité burst 4
const queue = kodiak.createQueue<Payload>("rl-queue", {
    rateLimiter: {
        rate: 2,
        capacity: 4
    }
});

// Worker qui utilise la même option (optionnel)
const worker = kodiak.createWorker<Payload>(
    "rl-queue",
    async (job: Job<Payload>) => {
        console.log(`Processing ${job.id}:`, job.data.text);
        await new Promise((r) => setTimeout(r, 300));
        console.log(`Done ${job.id}`);
    },
    {
        concurrency: 1,
        // prefetch: 1,
        rateLimiter: {
            rate: 2,
            capacity: 4
        },
    },
);

let isCompleted = 0;

worker.on("completed", (job: Job<Payload>) => {
    console.log(`Completed ${job.id}`);
    isCompleted++;
});
worker.on("failed", (job: Job<Payload>, err: Error) => console.error(`Failed ${job.id}:`, err.message));

console.log("Starting demo...");
await worker.start();

// Push plusieurs jobs rapidement — rate limiter should smooth them
for (let i = 1; i <= 8; i++) {
    await queue.add(`job-${i}`, { text: `payload ${i}` });
}

// Wait a bit to let jobs process
await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
        if (isCompleted >= 8) {
            clearInterval(interval);
            resolve();
        }
    }, 500);
});

console.log("Demo completed, shutting down...");

await worker.stop();
await kodiak.close();
process.exit(0);
