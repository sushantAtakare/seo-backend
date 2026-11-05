import IORedis from 'ioredis';
import env from './env.js';

let sharedConnection = null;

/**
 * Build Redis connection options for BullMQ / ioredis.
 */
export function getRedisOptions() {
  const options = {
    host: env.redis.host,
    port: env.redis.port,
    db: env.redis.db,
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
    lazyConnect: false,
  };

  if (env.redis.password) {
    options.password = env.redis.password;
  }

  if (env.redis.tls) {
    options.tls = {};
  }

  return options;
}

/**
 * Shared ioredis connection (API/status lookups).
 * Workers should create their own connections via getRedisOptions().
 */
export function getRedisConnection() {
  if (!sharedConnection) {
    sharedConnection = new IORedis(getRedisOptions());

    sharedConnection.on('error', (error) => {
      console.error('[redis] connection error:', error.message);
    });
  }

  return sharedConnection;
}

export async function checkRedisConnection() {
  const client = getRedisConnection();
  const pong = await client.ping();
  return { ok: pong === 'PONG' };
}

export async function closeRedisConnection() {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = null;
  }
}

export default getRedisConnection;
