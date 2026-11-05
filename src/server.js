import app from './app.js';
import env from './config/env.js';
import prisma, { checkDatabaseConnection } from './config/prisma.js';
import {
  checkRedisConnection,
  closeRedisConnection,
} from './config/redis.js';
import { closeAuditQueue } from './modules/queue/audit.queue.js';

async function start() {
  const db = await checkDatabaseConnection();

  if (!db.ok) {
    console.error(`[seo-backend] Database connection failed: ${db.error}`);
    process.exit(1);
  }

  console.info(`[seo-backend] Database connected: ${db.database}`);

  try {
    const redis = await checkRedisConnection();
    if (!redis.ok) {
      throw new Error('Redis ping failed');
    }
    console.info('[seo-backend] Redis connected');
  } catch (error) {
    console.error(`[seo-backend] Redis connection failed: ${error.message}`);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.info(
      `[seo-backend] Running on port ${env.port} in ${env.nodeEnv} mode`
    );
  });

  const shutdown = async (signal) => {
    console.info(`[seo-backend] ${signal} received. Shutting down...`);
    server.close(async () => {
      await closeAuditQueue();
      await closeRedisConnection();
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('[seo-backend] Failed to start:', error);
  process.exit(1);
});
