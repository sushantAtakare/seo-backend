import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import env from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import indexRoutes from './routes/index.routes.js';
import notFoundMiddleware from './middleware/notFound.middleware.js';
import errorMiddleware from './middleware/error.middleware.js';

const app = express();

// Security
app.use(helmet());
app.use(
  cors({
    origin: env.clientOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
if (env.nodeEnv !== 'test') {
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

// Routes
app.use('/health', healthRoutes);
app.use('/api/v1', indexRoutes);

// 404 then global error handler (must be last)
app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
