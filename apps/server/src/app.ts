import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { initDb } from './db/index.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import providerRoutes from './routes/providers.js';
import assistantRoutes from './routes/assistants.js';
import knowledgeRoutes from './routes/knowledge.js';
import conversationRoutes from './routes/conversations.js';
import usageRoutes from './routes/usage.js';
import userRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';
import auditRoutes from './routes/audit.js';
import embeddingRoutes from './routes/embeddings.js';
import { startIndexWorker } from './lib/indexer.js';

export function createApp() {
  initDb();
  startIndexWorker();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      data: {
        status: 'ok',
        version: config.version,
        uptime: Math.round(process.uptime()),
        time: new Date().toISOString(),
      },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/providers', providerRoutes);
  app.use('/api/assistants', assistantRoutes);
  app.use('/api/knowledge-bases', knowledgeRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/usage', usageRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/embeddings', embeddingRoutes);

  app.use('/api', notFoundHandler);

  const indexPath = path.join(config.webDist, 'index.html');
  if (existsSync(indexPath)) {
    app.use(
      express.static(config.webDist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(indexPath);
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send(
          'ASTRA API is running. Build the web app with `npm run build`, or use `npm run dev` for the Vite frontend.',
        );
    });
  }

  app.use(errorHandler);
  return app;
}
