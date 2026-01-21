import { Kodiak } from "../src/presentation/kodiak.js";
import type { Job } from "../src/domain/entities/job.entity.js";

// 1. Initialiser Kodiak
const kodiak = new Kodiak({
    connection: {
        host: "localhost",
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
const emailQueue = kodiak.createQueue<EmailPayload>("email-queue");

// 4. Créer un Worker pour traiter les jobs
const worker = kodiak.createWorker<EmailPayload>(
    "email-queue",
    async (job: Job<EmailPayload>) => {
        console.log(`📨 Envoi de l'email à ${job.data.to}...`);

        await new Promise((resolve) => setTimeout(resolve, 500));
        await job.updateProgress(50);

        await new Promise((resolve) => setTimeout(resolve, 500));
        await job.updateProgress(100);

        console.log(`✅ Email envoyé : "${job.data.subject}"`);
    },
    { concurrency: 1 },
);

// Écouter les événements
worker.on("completed", (job: Job<EmailPayload>) =>
    console.log(`🎉 Job ${job.id} terminé avec succès !`),
);
worker.on("failed", (job: Job<EmailPayload>, err: Error) =>
    console.error(`💥 Job ${job.id} échoué : ${err.message}`),
);
worker.on("progress", (job: Job<EmailPayload>, progress: number) =>
    console.log(`📈 Job ${job.id} progress: ${progress}%`),
);

// 5. Démarrer le worker
console.log("🚀 Démarrage du worker...");
await worker.start();

// 6. Ajouter un job à la file
console.log("➕ Ajout du job...");
await emailQueue.add("welcome-1", {
    to: "user@example.com",
    body: "Bienvenue sur Kodiak, votre nouvelle solution de gestion de files d'attente !",
    subject: "Bienvenue sur Kodiak !",
});

// Attendre que le job soit traité avant de quitter (pour la démo)
await new Promise((resolve) => setTimeout(resolve, 2000));

// 7. Arrêter proprement
await worker.stop();
console.log("👋 Fin de la démo.");
process.exit(0);
