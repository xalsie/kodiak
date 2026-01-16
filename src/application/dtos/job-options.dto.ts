export interface BackoffOptions {
    type: 'fixed' | 'exponential';
    delay: number;
}

export interface RepeatOptions {
    every: number;
    limit?: number;
}

export interface JobOptions {
    priority?: number;
    delay?: number;
    waitUntil?: Date;
    attempts?: number;
    backoff?: BackoffOptions;
    repeat?: RepeatOptions;
}
