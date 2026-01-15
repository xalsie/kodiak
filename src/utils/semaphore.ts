export class Semaphore {
    private permits: number;
    private waiters: Array<(value: void) => void> = [];

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
        if (this.waiters.length > 0) {
            const resolve = this.waiters.shift();
            if (resolve) resolve();
        } else {
            this.permits++;
        }
    }
}
