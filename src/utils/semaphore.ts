export class Semaphore {
    private permits: number;
    private waiters: Array<() => void> = [];

    constructor(initialPermits: number) {
        this.permits = initialPermits;
    }

    public async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.waiters.push(resolve);
        });
    }

    public release(): void {
        const resolve = this.waiters.shift();
        if (resolve) {
            resolve();
        } else {
            this.permits++;
        }
    }
}
