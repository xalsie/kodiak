import IORedis, { type RedisOptions } from 'ioredis';
import { Queue } from './queue';
import { Worker } from './worker';
import type { WorkerOptions } from '../application/dtos/worker-options.dto';

export interface KodiakOptions {
    connection: RedisOptions;
    prefix?: string;
}

export class Kodiak {
    public readonly connection: IORedis;
    public readonly prefix: string;

    constructor(private options: KodiakOptions) {
        this.connection = new IORedis(options.connection);
        this.prefix = options.prefix ?? 'kodiak';
    }

    public createQueue<T>(name: string): Queue<T> {
        return new Queue<T>(name, this);
    }

    public createWorker<T>(
        name: string,
        processor: (job: T) => Promise<void>,
        opts?: WorkerOptions,
    ): Worker<T> {
        return new Worker<T>(name, processor, this, opts);
    }
}
