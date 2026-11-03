import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { asyncHandler, parse } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import {
  clearEmbeddingCache,
  getEmbeddingSettings,
  resolveEmbeddingConfig,
  testEmbeddingConfig,
} from '../lib/embeddings.js';
import { indexQueueStats, reindexAllDocuments } from '../lib/indexer.js';
import { resetVectorStore, getVectorStore, configuredVectorStore } from '../vector/index.js';

const router = Router();

const configSchema = z.object({
  backend: z.enum(['local', 'openai']).optional(),
  providerId: z.string().trim().max(80).optional(),
  model: z.string().trim().max(120).optional(),
  dimensions: z.coerce.number().int().min(128).max(3072).optional(),
  topK: z.coerce.number().int().min(1).max(12).optional(),
  minScore: z.coerce.number().min(0).max(0.9).optional(),
});

function mergedConfig(input: z.infer<typeof configSchema>) {
  const base = getEmbeddingSettings();
  return {
    ...base,
    backend: input.backend ?? base.backend,
    providerId: input.providerId ?? base.providerId,
    model: input.model || base.model,
    dimensions: input.dimensions ?? base.dimensions,
    topK: input.topK ?? base.topK,
    minScore: input.minScore ?? base.minScore,
  };
}

async function configView() {
  const settings = getEmbeddingSettings();
  let indexedChunks = 0;
  let vectorError = '';
  try {
    const store = await getVectorStore();
    indexedChunks = await store.count();
  } catch (error) {
    vectorError =
      error instanceof Error ? error.message : '向量存储暂时不可用';
  }
  const docs = getDb()
    .prepare(
      `SELECT
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM documents`,
    )
    .get() as {
    ready: number | null;
    processing: number | null;
    errors: number | null;
  };
  return {
    ...settings,
    vectorStore: configuredVectorStore(),
    indexedChunks,
    readyDocuments: docs.ready ?? 0,
    processingDocuments: docs.processing ?? 0,
    errorDocuments: docs.errors ?? 0,
    jobs: indexQueueStats(),
    vectorError,
    mode: settings.backend === 'local' ? '本地哈希向量（演示）' : '语义向量',
  };
}

router.get(
  '/config',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ data: await configView() });
  }),
);

router.post(
  '/test',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parse(configSchema, req.body);
    const test = await testEmbeddingConfig(mergedConfig(input));
    res.json({ data: test });
  }),
);

router.patch(
  '/config',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parse(configSchema, req.body);
    const next = mergedConfig(input);
    const resolved = await resolveEmbeddingConfig(next);
    const test = await testEmbeddingConfig(next);

    await resetVectorStore(resolved.dimensions);
    clearEmbeddingCache();

    const db = getDb();
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    upsert.run('embedding_backend', resolved.backend);
    upsert.run('embedding_provider_id', resolved.providerId);
    upsert.run('embedding_model', resolved.model);
    upsert.run('embedding_dimensions', String(resolved.dimensions));
    upsert.run('rag_top_k', String(next.topK));
    upsert.run('rag_min_score', String(next.minScore));

    await reindexAllDocuments();
    writeAudit(
      req,
      'rag.config.update',
      'settings',
      null,
      `更新向量检索配置：${resolved.backend} / ${resolved.model} / ${resolved.dimensions}d`,
    );
    res.json({ data: { ...(await configView()), test } });
  }),
);

export default router;
