import { type Redis, type RedisOptions } from 'ioredis';
import { RedisClient } from '../infrastructure/redis/redis-client.js';
import { Queue } from './queue.js';
import { Worker } from './worker.js';
import type { WorkerOptions } from '../application/dtos/worker-options.dto.js';
import type { Job } from '../domain/entities/job.entity.js';

export interface KodiakOptions {
    connection: RedisOptions;
    prefix?: string;
}

export class Kodiak {
    public readonly connection: Redis;
    public readonly prefix: string;

    constructor(private options: KodiakOptions) {
        // Initialize and reuse a singleton Redis client for the whole app.
        RedisClient.init(this.options.connection);
        this.connection = RedisClient.getClient();
        this.prefix = this.options.prefix ?? 'kodiak';
    }

    public createQueue<T>(name: string): Queue<T> {
        return new Queue<T>(name, this);
    }

    public createWorker<T>(
        name: string,
        processor: (job: Job<T>) => Promise<void>,
        opts?: WorkerOptions,
    ): Worker<T> {
        return new Worker<T>(name, processor, this, opts);
    }

    /**
     * Close the underlying Redis client managed by the singleton.
     * Prefer calling this over calling `kodiak.connection.quit()` directly.
     */
    public async close(): Promise<void> {
        await RedisClient.quit();
    }
}
