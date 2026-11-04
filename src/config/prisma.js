import { PrismaClient } from '@prisma/client';
import env from './env.js';

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ['error'] : ['error', 'warn'],
  });

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

/**
 * Verifies PostgreSQL connectivity via Prisma.
 * @returns {Promise<{ ok: boolean, database?: string, error?: string }>}
 */
export async function checkDatabaseConnection() {
  try {
    const rows = await prisma.$queryRaw`SELECT current_database() AS database`;
    const database = rows?.[0]?.database;

    return { ok: true, database };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}

export default prisma;
