import { Router } from 'express';
import { statSync } from 'node:fs';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { asyncHandler, parse, ApiError } from '../lib/errors.js';
import { config } from '../config.js';
import { writeAudit } from '../lib/audit.js';

const router = Router();

function readSettings(): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT key, value FROM settings')
    .all() as unknown as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const settings = readSettings();
    let dbSize = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        dbSize += statSync(`${config.dbPath}${suffix}`).size;
      } catch {
        // A WAL/SHM file may not exist yet.
      }
    }
    const counts = getDb()
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM assistants) AS assistants,
          (SELECT COUNT(*) FROM conversations) AS conversations,
          (SELECT COUNT(*) FROM documents) AS documents`,
      )
      .get() as {
      users: number;
      assistants: number;
      conversations: number;
      documents: number;
    };

    res.json({
      data: {
        workspaceName: settings.workspace_name ?? '星枢 AI 实验室',
        tokenBudget: Number(settings.token_budget ?? 2_000_000),
        plan: settings.workspace_plan ?? 'Team',
        timezone: settings.timezone ?? 'Asia/Shanghai',
        retentionDays: Number(settings.retention_days ?? 90),
        defaultAssistant: settings.default_assistant ?? null,
        system: {
          version: config.version,
          node: process.version,
          database: 'SQLite (WAL)',
          databaseSize: dbSize,
          environment: config.isProduction ? 'production' : 'development',
          counts,
        },
      },
    });
  }),
);

const updateSchema = z.object({
  workspaceName: z.string().trim().min(2).max(40).optional(),
  tokenBudget: z.number().int().min(10_000).max(100_000_000).optional(),
  timezone: z.string().trim().max(60).optional(),
  retentionDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).optional(),
  defaultAssistant: z.string().nullable().optional(),
});

router.patch(
  '/',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(updateSchema, req.body);
    const db = getDb();
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );

    if (body.workspaceName !== undefined) {
      upsert.run('workspace_name', body.workspaceName);
    }
    if (body.tokenBudget !== undefined) {
      upsert.run('token_budget', String(body.tokenBudget));
    }
    if (body.timezone !== undefined) {
      upsert.run('timezone', body.timezone);
    }
    if (body.retentionDays !== undefined) {
      upsert.run('retention_days', String(body.retentionDays));
    }
    if (body.defaultAssistant !== undefined) {
      if (body.defaultAssistant) {
        const assistant = getDb()
          .prepare('SELECT id FROM assistants WHERE id = ?')
          .get(body.defaultAssistant);
        if (!assistant) {
          throw new ApiError(422, 'ASSISTANT_NOT_FOUND', '所选默认助手不存在');
        }
      }
      upsert.run('default_assistant', body.defaultAssistant ?? '');
    }

    writeAudit(req, 'settings.update', 'settings', null, '更新工作区设置');
    res.json({ data: readSettings() });
  }),
);

export default router;
