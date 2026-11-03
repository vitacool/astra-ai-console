import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';
import type { AssistantRow } from '../types.js';

const router = Router();

interface AssistantJoined extends AssistantRow {
  provider_name: string | null;
  provider_kind: string | null;
  provider_status: string | null;
  knowledge_base_name: string | null;
  creator_name: string | null;
  conversation_count: number;
  total_tokens: number;
}

const SELECT_ASSISTANT = `
  SELECT a.*, p.name AS provider_name, p.kind AS provider_kind, p.status AS provider_status,
         k.name AS knowledge_base_name, u.name AS creator_name,
         (SELECT COUNT(*) FROM conversations c WHERE c.assistant_id = a.id) AS conversation_count,
         (SELECT COALESCE(SUM(l.total_tokens), 0) FROM usage_logs l WHERE l.assistant_id = a.id) AS total_tokens
  FROM assistants a
  LEFT JOIN providers p ON p.id = a.provider_id
  LEFT JOIN knowledge_bases k ON k.id = a.knowledge_base_id
  LEFT JOIN users u ON u.id = a.created_by
`;

function serialise(row: AssistantJoined) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerKind: row.provider_kind,
    providerStatus: row.provider_status,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    icon: row.icon,
    color: row.color,
    knowledgeBaseId: row.knowledge_base_id,
    knowledgeBaseName: row.knowledge_base_name,
    status: row.status,
    creatorName: row.creator_name,
    conversations: row.conversation_count,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const assistantSchema = z.object({
  name: z.string().trim().min(2, '助手名称至少 2 个字符').max(40),
  description: z.string().trim().max(160).optional().default(''),
  systemPrompt: z.string().trim().min(10, '系统提示词至少 10 个字符').max(8000),
  providerId: z.string().min(1, '请选择模型供应商'),
  model: z.string().trim().max(100).optional().default(''),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().int().min(256).max(8192).optional().default(2048),
  icon: z.string().trim().max(40).optional().default('Sparkles'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .default('#5EEAD4'),
  knowledgeBaseId: z.string().trim().min(1).nullable().optional(),
  status: z.enum(['active', 'draft']).optional().default('active'),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const rows = (
      status
        ? getDb()
            .prepare(`${SELECT_ASSISTANT} WHERE a.status = ? ORDER BY a.updated_at DESC`)
            .all(status)
        : getDb()
            .prepare(`${SELECT_ASSISTANT} ORDER BY a.updated_at DESC`)
            .all()
    ) as unknown as AssistantJoined[];
    res.json({ data: rows.map(serialise) });
  }),
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = getDb()
      .prepare(`${SELECT_ASSISTANT} WHERE a.id = ?`)
      .get(req.params.id) as unknown as AssistantJoined | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'AI 助手不存在');
    res.json({ data: serialise(row) });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(assistantSchema, req.body);
    const provider = getDb()
      .prepare('SELECT id, default_model FROM providers WHERE id = ?')
      .get(body.providerId) as { id: string; default_model: string } | undefined;
    if (!provider) throw new ApiError(422, 'PROVIDER_NOT_FOUND', '所选供应商不存在');

    if (body.knowledgeBaseId) {
      const kb = getDb()
        .prepare('SELECT id FROM knowledge_bases WHERE id = ?')
        .get(body.knowledgeBaseId);
      if (!kb) throw new ApiError(422, 'KB_NOT_FOUND', '所选知识库不存在');
    }

    const id = randomUUID();
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO assistants
          (id, name, description, system_prompt, provider_id, model, temperature, max_tokens,
           icon, color, knowledge_base_id, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        body.name,
        body.description,
        body.systemPrompt,
        body.providerId,
        body.model || provider.default_model,
        body.temperature,
        body.maxTokens,
        body.icon,
        body.color,
        body.knowledgeBaseId ?? null,
        body.status,
        req.user!.id,
        now,
        now,
      );

    const row = getDb()
      .prepare(`${SELECT_ASSISTANT} WHERE a.id = ?`)
      .get(id) as unknown as AssistantJoined;
    writeAudit(req, 'assistant.create', 'assistant', id, `创建 AI 助手「${body.name}」`);
    res.status(201).json({ data: serialise(row) });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(assistantSchema.partial(), req.body);
    const existing = getDb()
      .prepare(`${SELECT_ASSISTANT} WHERE a.id = ?`)
      .get(req.params.id) as unknown as AssistantJoined | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'AI 助手不存在');

    if (body.providerId) {
      const provider = getDb()
        .prepare('SELECT id FROM providers WHERE id = ?')
        .get(body.providerId);
      if (!provider) throw new ApiError(422, 'PROVIDER_NOT_FOUND', '所选供应商不存在');
    }
    if (body.knowledgeBaseId) {
      const kb = getDb()
        .prepare('SELECT id FROM knowledge_bases WHERE id = ?')
        .get(body.knowledgeBaseId);
      if (!kb) throw new ApiError(422, 'KB_NOT_FOUND', '所选知识库不存在');
    }

    getDb()
      .prepare(
        `UPDATE assistants SET
          name = ?, description = ?, system_prompt = ?, provider_id = ?, model = ?,
          temperature = ?, max_tokens = ?, icon = ?, color = ?, knowledge_base_id = ?,
          status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.systemPrompt ?? existing.system_prompt,
        body.providerId ?? existing.provider_id,
        body.model ?? existing.model,
        body.temperature ?? existing.temperature,
        body.maxTokens ?? existing.max_tokens,
        body.icon ?? existing.icon,
        body.color ?? existing.color,
        body.knowledgeBaseId !== undefined
          ? body.knowledgeBaseId
          : existing.knowledge_base_id,
        body.status ?? existing.status,
        nowIso(),
        existing.id,
      );

    const row = getDb()
      .prepare(`${SELECT_ASSISTANT} WHERE a.id = ?`)
      .get(existing.id) as unknown as AssistantJoined;
    writeAudit(
      req,
      'assistant.update',
      'assistant',
      existing.id,
      `更新 AI 助手「${row.name}」`,
    );
    res.json({ data: serialise(row) });
  }),
);

router.post(
  '/:id/duplicate',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = getDb()
      .prepare('SELECT * FROM assistants WHERE id = ?')
      .get(req.params.id) as unknown as AssistantRow | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'AI 助手不存在');

    const id = randomUUID();
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO assistants
          (id, name, description, system_prompt, provider_id, model, temperature, max_tokens,
           icon, color, knowledge_base_id, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .run(
        id,
        `${existing.name} 副本`,
        existing.description,
        existing.system_prompt,
        existing.provider_id,
        existing.model,
        existing.temperature,
        existing.max_tokens,
        existing.icon,
        existing.color,
        existing.knowledge_base_id,
        req.user!.id,
        now,
        now,
      );

    const row = getDb()
      .prepare(`${SELECT_ASSISTANT} WHERE a.id = ?`)
      .get(id) as unknown as AssistantJoined;
    writeAudit(req, 'assistant.duplicate', 'assistant', id, `复制 AI 助手「${existing.name}」`);
    res.status(201).json({ data: serialise(row) });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = getDb()
      .prepare('SELECT * FROM assistants WHERE id = ?')
      .get(req.params.id) as unknown as AssistantRow | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'AI 助手不存在');
    getDb().prepare('DELETE FROM assistants WHERE id = ?').run(existing.id);
    writeAudit(req, 'assistant.delete', 'assistant', existing.id, `删除 AI 助手「${existing.name}」`);
    res.json({ data: { ok: true } });
  }),
);

export default router;
