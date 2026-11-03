import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import { decryptSecret, encryptSecret, maskSecret } from '../lib/crypto.js';
import { testProvider } from '../lib/ai.js';
import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';
import type { ProviderRow } from '../types.js';

const router = Router();

function serialise(row: ProviderRow) {
  const key = decryptSecret(row.api_key);
  const assistants = getDb()
    .prepare('SELECT COUNT(*) AS count FROM assistants WHERE provider_id = ?')
    .get(row.id) as { count: number };
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.base_url,
    hasKey: Boolean(key),
    maskedKey: key ? maskSecret(key) : '',
    defaultModel: row.default_model,
    models: JSON.parse(row.models || '[]') as string[],
    status: row.status,
    assistants: assistants.count,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseModels(value: string[] | string | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value)
    ? value
    : value.split(/[,\n]/).map((item) => item.trim());
  return [...new Set(list.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    40,
  );
}

const providerSchema = z.object({
  name: z.string().trim().min(2, '名称至少 2 个字符').max(40),
  kind: z.enum(['mock', 'openai']),
  baseUrl: z.string().trim().max(300).optional().default(''),
  apiKey: z.string().trim().max(500).optional(),
  clearKey: z.boolean().optional(),
  defaultModel: z.string().trim().min(1, '请填写默认模型').max(100),
  models: z.union([z.array(z.string()), z.string()]).optional(),
  status: z.enum(['active', 'inactive', 'error']).optional(),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare('SELECT * FROM providers ORDER BY created_at')
      .all() as unknown as ProviderRow[];
    res.json({ data: rows.map(serialise) });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(providerSchema, req.body);
    if (body.kind === 'openai' && !body.baseUrl) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'OpenAI 兼容供应商需要填写 Base URL');
    }
    const hasKey = Boolean(body.apiKey);
    const now = nowIso();
    const id = randomUUID();
    getDb()
      .prepare(
        `INSERT INTO providers
          (id, name, kind, base_url, api_key, default_model, models, status, last_checked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        body.name,
        body.kind,
        body.baseUrl.replace(/\/+$/, ''),
        hasKey ? encryptSecret(body.apiKey!) : '',
        body.defaultModel,
        JSON.stringify(
          parseModels(body.models).length
            ? parseModels(body.models)
            : [body.defaultModel],
        ),
        body.status ?? (body.kind === 'mock' || hasKey ? 'active' : 'inactive'),
        now,
        now,
      );

    const row = getDb()
      .prepare('SELECT * FROM providers WHERE id = ?')
      .get(id) as unknown as ProviderRow;
    writeAudit(req, 'provider.create', 'provider', id, `新增供应商「${body.name}」`);
    res.status(201).json({ data: serialise(row) });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(providerSchema.partial(), req.body);
    const existing = getDb()
      .prepare('SELECT * FROM providers WHERE id = ?')
      .get(req.params.id) as unknown as ProviderRow | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '供应商不存在');

    let apiKey = existing.api_key;
    if (body.clearKey) apiKey = '';
    else if (body.apiKey) apiKey = encryptSecret(body.apiKey);

    const kind = body.kind ?? existing.kind;
    const baseUrl =
      body.baseUrl !== undefined
        ? body.baseUrl.replace(/\/+$/, '')
        : existing.base_url;
    if (kind === 'openai' && !baseUrl) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'OpenAI 兼容供应商需要填写 Base URL');
    }

    const models =
      body.models !== undefined
        ? parseModels(body.models)
        : (JSON.parse(existing.models) as string[]);
    const defaultModel = body.defaultModel ?? existing.default_model;
    const status =
      body.status ??
      (kind === 'mock' || apiKey ? existing.status : 'inactive');

    getDb()
      .prepare(
        `UPDATE providers SET
          name = ?, kind = ?, base_url = ?, api_key = ?, default_model = ?,
          models = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        body.name ?? existing.name,
        kind,
        baseUrl,
        apiKey,
        defaultModel,
        JSON.stringify(models.length ? models : [defaultModel]),
        status,
        nowIso(),
        existing.id,
      );

    const row = getDb()
      .prepare('SELECT * FROM providers WHERE id = ?')
      .get(existing.id) as unknown as ProviderRow;
    writeAudit(
      req,
      'provider.update',
      'provider',
      existing.id,
      `更新供应商「${row.name}」`,
    );
    res.json({ data: serialise(row) });
  }),
);

router.post(
  '/:id/test',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const row = getDb()
      .prepare('SELECT * FROM providers WHERE id = ?')
      .get(req.params.id) as unknown as ProviderRow | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', '供应商不存在');

    try {
      const result = await testProvider(row);
      getDb()
        .prepare(
          "UPDATE providers SET status = 'active', last_checked_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(nowIso(), nowIso(), row.id);
      writeAudit(
        req,
        'provider.test',
        'provider',
        row.id,
        `测试供应商「${row.name}」连接成功`,
      );
      res.json({ data: result });
    } catch (error) {
      const missingKey =
        error instanceof ApiError && error.code === 'PROVIDER_KEY_MISSING';
      getDb()
        .prepare(
          'UPDATE providers SET status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          missingKey ? 'inactive' : 'error',
          nowIso(),
          nowIso(),
          row.id,
        );
      throw error;
    }
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const row = getDb()
      .prepare('SELECT * FROM providers WHERE id = ?')
      .get(req.params.id) as unknown as ProviderRow | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', '供应商不存在');

    const used = getDb()
      .prepare('SELECT COUNT(*) AS count FROM assistants WHERE provider_id = ?')
      .get(row.id) as { count: number };
    if (used.count > 0) {
      throw new ApiError(
        409,
        'PROVIDER_IN_USE',
        `还有 ${used.count} 个助手正在使用该供应商，请先切换助手模型`,
      );
    }

    getDb().prepare('DELETE FROM providers WHERE id = ?').run(row.id);
    writeAudit(req, 'provider.delete', 'provider', row.id, `删除供应商「${row.name}」`);
    res.json({ data: { ok: true } });
  }),
);

export default router;
