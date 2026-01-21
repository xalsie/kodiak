import { describe, it, expect, beforeEach } from "@jest/globals";
import { Semaphore } from "../../src/utils/semaphore";

describe("Unit: Semaphore", () => {
    let semaphore: Semaphore;

    describe("with initial permits", () => {
        beforeEach(() => {
            semaphore = new Semaphore(2);
        });

        it("should allow immediate acquisition when permits are available", async () => {
            const promise = semaphore.acquire();
            await expect(promise).resolves.toBeUndefined();
        });

        it("should decrement permits on acquisition", async () => {
            await semaphore.acquire();
            await semaphore.acquire();

            const thirdAcquire = semaphore.acquire();

            await new Promise((resolve) => setTimeout(resolve, 10));

            let resolved = false;
            thirdAcquire.then(() => {
                resolved = true;
            });

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(resolved).toBe(false);
        });

        it("should increment permits on release when no waiters", () => {
            semaphore.release();

            expect(async () => {
                await semaphore.acquire();
                await semaphore.acquire();
                await semaphore.acquire();
            }).not.toThrow();
        });
    });

    describe("with zero permits", () => {
        beforeEach(() => {
            semaphore = new Semaphore(0);
        });

        it("should block acquisition when no permits are available", async () => {
            const acquirePromise = semaphore.acquire();

            let resolved = false;
            acquirePromise.then(() => {
                resolved = true;
            });

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(resolved).toBe(false);
        });

        it("should resume waiting acquisitions when released", async () => {
            const acquirePromise = semaphore.acquire();

            let resolved = false;
            acquirePromise.then(() => {
                resolved = true;
            });

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(resolved).toBe(false);

            semaphore.release();

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(resolved).toBe(true);
        });

        it("should handle multiple waiters in FIFO order", async () => {
            const results: number[] = [];

            semaphore.acquire().then(() => results.push(1));
            semaphore.acquire().then(() => results.push(2));
            semaphore.acquire().then(() => results.push(3));

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(results).toEqual([]);

            semaphore.release();
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(results).toEqual([1]);

            semaphore.release();
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(results).toEqual([1, 2]);

            semaphore.release();
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(results).toEqual([1, 2, 3]);
        });
    });

    describe("with one permit", () => {
        beforeEach(() => {
            semaphore = new Semaphore(1);
        });

        it("should allow mutual exclusion", async () => {
            let criticalSectionActive = false;
            const results: string[] = [];

            const task = async (id: string) => {
                await semaphore.acquire();

                if (criticalSectionActive) {
                    results.push(`ERROR: ${id} entered while another task was active`);
                }

                criticalSectionActive = true;
                results.push(`${id} start`);

                await new Promise((resolve) => setTimeout(resolve, 10));

                results.push(`${id} end`);
                criticalSectionActive = false;

                semaphore.release();
            };

            await Promise.all([task("Task1"), task("Task2"), task("Task3")]);

            expect(results).toHaveLength(6);
            expect(results.filter((r) => r.startsWith("ERROR"))).toHaveLength(0);

            expect(results.filter((r) => r.endsWith("start"))).toHaveLength(3);
            expect(results.filter((r) => r.endsWith("end"))).toHaveLength(3);
        });

        it("should handle acquire and release cycles correctly", async () => {
            await semaphore.acquire();
            semaphore.release();

            await semaphore.acquire();
            semaphore.release();

            await semaphore.acquire();
            semaphore.release();

            await expect(semaphore.acquire()).resolves.toBeUndefined();
        });
    });

    describe("edge cases", () => {
        it("should handle large number of permits", async () => {
            semaphore = new Semaphore(1000);

            const promises = Array.from({ length: 1000 }, () => semaphore.acquire());
            await expect(Promise.all(promises)).resolves.toBeDefined();
        });

        it("should handle release before any acquire", () => {
            semaphore = new Semaphore(5);

            expect(() => {
                semaphore.release();
                semaphore.release();
                semaphore.release();
            }).not.toThrow();
        });

        it("should handle concurrent acquire and release", async () => {
            semaphore = new Semaphore(1);

            const operations = async () => {
                for (let i = 0; i < 10; i++) {
                    await semaphore.acquire();
                    await new Promise((resolve) => setTimeout(resolve, 1));
                    semaphore.release();
                }
            };

            await expect(
                Promise.all([operations(), operations(), operations()]),
            ).resolves.toBeDefined();
        });
    });
});
