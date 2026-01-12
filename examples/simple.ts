import { Kodiak } from '../src/presentation/kodiak.js';

// 1. Initialiser Kodiak
const kodiak = new Kodiak({
    connection: {
        host: 'localhost',
        port: 6379,
    },
});

// 2. Définir le type de données du Job
interface EmailPayload {
    to: string;
    body: string;
    subject: string;
}

// 3. Créer une file d'attente (Queue)
const emailQueue = kodiak.createQueue<EmailPayload>('email-queue');

// 4. Créer un Worker pour traiter les jobs
const worker = kodiak.createWorker<EmailPayload>(
    'email-queue',
    async (jobData) => {
        console.log(`📨 Envoi de l'email à ${jobData.to}...`);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Simuler un travail
        console.log(`✅ Email envoyé : "${jobData.subject}"`);
    },
    { concurrency: 1 }
);

// Écouter les événements
worker.on('completed', (job) => console.log(`🎉 Job ${job.id} terminé avec succès !`));
worker.on('failed', (job, err) => console.error(`💥 Job ${job.id} échoué : ${err.message}`));

// 5. Démarrer le worker
console.log('🚀 Démarrage du worker...');
await worker.start();

// 6. Ajouter un job à la file
console.log('➕ Ajout du job...');
await emailQueue.add('welcome-1', {
    to: 'user@example.com',
    body: 'Bienvenue sur Kodiak, votre nouvelle solution de gestion de files d\'attente !',
    subject: 'Bienvenue sur Kodiak !'
});

// Attendre que le job soit traité avant de quitter (pour la démo)
await new Promise((resolve) => setTimeout(resolve, 2000));

// 7. Arrêter proprement
await worker.stop();
console.log('👋 Fin de la démo.');
process.exit(0);
