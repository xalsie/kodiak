export type BackoffStrategy = (attemptsMade: number, delay: number) => number;
