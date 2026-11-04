import dotenv from 'dotenv';

dotenv.config();

const requiredVars = ['PORT', 'NODE_ENV', 'CLIENT_ORIGIN', 'DATABASE_URL'];

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
};

if (Number.isNaN(env.port) || env.port <= 0) {
  throw new Error('PORT must be a valid positive number');
}

if (!env.databaseUrl.includes('seo_automation')) {
  throw new Error(
    'DATABASE_URL must target the seo_automation database'
  );
}

export default env;
