import env from './config/env.js';
import prisma, { checkDatabaseConnection } from './config/prisma.js';
import { checkRedisConnection, closeRedisConnection } from './config/redis.js';
import { createAuditWorker } from './modules/queue/audit.worker.js';
import { closeAuditQueue } from './modules/queue/audit.queue.js';

async function start() {
  const db = await checkDatabaseConnection();
  if (!db.ok) {
    console.error(`[audit-worker] Database connection failed: ${db.error}`);
    process.exit(1);
  }

  const redis = await checkRedisConnection();
  if (!redis.ok) {
    console.error('[audit-worker] Redis connection failed');
    process.exit(1);
  }

  const worker = createAuditWorker();

  console.info(
    `[audit-worker] Listening on queue seo-audit-queue (${env.nodeEnv})`
  );

  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.info(`[audit-worker] ${signal} received. Shutting down...`);

    try {
      await worker.close();
      await closeAuditQueue();
      await closeRedisConnection();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      console.error('[audit-worker] Shutdown error:', error.message);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('[audit-worker] Failed to start:', error);
  process.exit(1);
});
