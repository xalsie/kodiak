import { Redis, type RedisOptions } from 'ioredis';

export class RedisClient {
    private static instance: Redis | null = null;

    public static init(options: RedisOptions): void {
        if (this.instance) {
            const status = (this.instance as unknown as { status?: string }).status;
            if (status === 'end' || status === 'close') {
                this.instance = null;
            } else {
                console.warn('RedisClient: already initialized, ignoring subsequent init call');
                return;
            }
        }

        const defaults: Partial<RedisOptions> = {
            maxRetriesPerRequest: null,
            retryStrategy: (times: number) => Math.min(100 * times, 2000),
            enableOfflineQueue: true,
            connectTimeout: 10000,
        };

        const merged = { ...defaults, ...(options ?? {}) } as RedisOptions;

        this.instance = new Redis(merged);

        this.instance.on('error', (err: Error) => {
            console.error('[RedisClient] connection error:', err.message);
        });

        this.instance.on('end', () => {
            console.warn('[RedisClient] connection ended');
            RedisClient.instance = null;
        });

        this.instance.on('close', () => {
            console.warn('[RedisClient] connection closed');
            RedisClient.instance = null;
        });

        this.instance.on('connect', () => {
            console.info('[RedisClient] connected to Redis');
        });
    }

    public static getClient(): Redis {
        if (!this.instance) throw new Error('RedisClient: not initialized. Call RedisClient.init(options) first.');
        return this.instance;
    }

    public static isInitialized(): boolean {
        return this.instance !== null;
    }

    public static async quit(): Promise<void> {
        if (!this.instance) return;
        try {
            await this.instance.quit();
        } finally {
            this.instance = null;
        }
    }
}

export default RedisClient;
