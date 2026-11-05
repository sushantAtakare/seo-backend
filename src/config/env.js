import dotenv from 'dotenv';

dotenv.config();

const requiredVars = [
  'PORT',
  'NODE_ENV',
  'CLIENT_ORIGIN',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'REDIS_HOST',
  'REDIS_PORT',
];

const missing = requiredVars.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(', ')}`
  );
}

const env = {
  port: Number(process.env.PORT),
  nodeEnv: process.env.NODE_ENV,
  clientOrigin: process.env.CLIENT_ORIGIN,
  databaseUrl: process.env.DATABASE_URL,
  isProduction: process.env.NODE_ENV === 'production',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    tls: String(process.env.REDIS_TLS || 'false').toLowerCase() === 'true',
  },
  crawler: {
    allowPrivateNetworks:
      String(process.env.CRAWLER_ALLOW_PRIVATE_NETWORKS || 'false').toLowerCase() ===
      'true',
  },
};

if (Number.isNaN(env.port) || env.port <= 0) {
  throw new Error('PORT must be a valid positive number');
}

if (!env.databaseUrl.includes('seo_automation')) {
  throw new Error(
    'DATABASE_URL must target the seo_automation database'
  );
}

if (
  env.jwt.accessSecret.length < 32 ||
  env.jwt.refreshSecret.length < 32
) {
  throw new Error('JWT secrets must be at least 32 characters');
}

if (env.jwt.accessSecret === env.jwt.refreshSecret) {
  throw new Error('JWT access and refresh secrets must be different');
}

if (Number.isNaN(env.redis.port) || env.redis.port <= 0) {
  throw new Error('REDIS_PORT must be a valid positive number');
}

if (Number.isNaN(env.redis.db) || env.redis.db < 0) {
  throw new Error('REDIS_DB must be a non-negative number');
}

export default env;
