import { Kodiak } from './src/presentation/kodiak';

const kodiak = new Kodiak({
    connection: {
        host: 'localhost', 
        port: 6379
    },
    prefix: 'test-app',
});

interface EmailPayload {
    to: string;
    body: string;
    subject: string;
}

const emailQueue = kodiak.createQueue<EmailPayload>('emails');

await emailQueue.add('send-welcome', { to: 'user@example.com', body: 'Hi!', subject: 'Welcome!' }, {
  priority: 1, // 1=high, 10=normal, 100=low
  delay: 5000, // 5 seconds
  attempts: 3, // Retry 3 times (not auto-retrying yet)
});

await emailQueue.add('send-urgent-alert', {
    to: 'user@example.com',
    body: 'Urgent alert!',
    subject: 'Alert'
}, {
    priority: 1 
});

await emailQueue.add('send-newsletter', {
    to: 'user@example.com',
    body: 'Monthly newsletter content',
    subject: 'Newsletter'
}, {
    priority: 3
});

const worker = kodiak.createWorker(
    'emails',
    async (jobData: EmailPayload) => {
        console.log('Processing:', jobData.to);
    },
    { concurrency: 5 } // Up to 5 jobs in parallel
);

worker.on('completed', (job) => console.log(`✓ Done: ${job.id}`));
worker.on('failed', (job, err) => console.error(`✗ Failed: ${err.message}`));

await worker.start(); // Start processing
await worker.stop(); // Stop gracefully
