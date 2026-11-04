import app from './app.js';
import env from './config/env.js';
import prisma, { checkDatabaseConnection } from './config/prisma.js';

async function start() {
  const db = await checkDatabaseConnection();

  if (!db.ok) {
    console.error(`[seo-backend] Database connection failed: ${db.error}`);
    process.exit(1);
  }

  console.info(`[seo-backend] Database connected: ${db.database}`);

  const server = app.listen(env.port, () => {
    console.info(
      `[seo-backend] Running on port ${env.port} in ${env.nodeEnv} mode`
    );
  });

  const shutdown = async (signal) => {
    console.info(`[seo-backend] ${signal} received. Shutting down...`);
    server.close(async () => {
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
