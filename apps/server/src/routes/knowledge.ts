import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import { estimateTokens } from '../lib/tokens.js';
import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';
import { retrieveKnowledge } from '../lib/retrieval.js';
import {
  enqueueIndex,
  reindexKnowledgeBase,
  removeDocumentFromIndex,
  removeKnowledgeBaseFromIndex,
} from '../lib/indexer.js';

const router = Router();

interface KbRow {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  updated_at: string;
  document_count: number;
  total_tokens: number;
  chunk_count: number;
  assistant_count: number;
}

const SELECT_KB = `
  SELECT k.*,
    (SELECT COUNT(*) FROM documents d WHERE d.kb_id = k.id) AS document_count,
    (SELECT COALESCE(SUM(d.tokens), 0) FROM documents d WHERE d.kb_id = k.id) AS total_tokens,
    (SELECT COALESCE(SUM(d.chunk_count), 0) FROM documents d WHERE d.kb_id = k.id) AS chunk_count,
    (SELECT COUNT(*) FROM assistants a WHERE a.knowledge_base_id = k.id) AS assistant_count
  FROM knowledge_bases k
`;

function serialiseKb(row: KbRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    documents: row.document_count,
    tokens: row.total_tokens,
    chunks: row.chunk_count,
    assistants: row.assistant_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface DocRow {
  id: string;
  kb_id: string;
  title: string;
  content: string;
  tokens: number;
  status: string;
  chunk_count: number;
  index_error: string;
  created_at: string;
  updated_at: string;
}

function serialiseDoc(row: DocRow) {
  return {
    id: row.id,
    kbId: row.kb_id,
    title: row.title,
    content: row.content,
    tokens: row.tokens,
    status: row.status,
    chunkCount: row.chunk_count,
    indexError: row.index_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

const kbSchema = z.object({
  name: z.string().trim().min(2, '知识库名称至少 2 个字符').max(40),
  description: z.string().trim().max(160).optional().default(''),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .default('#5EEAD4'),
});

const docSchema = z.object({
  title: z.string().trim().min(1, '请填写文档标题').max(120),
  content: z
    .string()
    .trim()
    .min(10, '文档内容至少 10 个字符')
    .max(200_000, '单个文档不能超过 20 万字符'),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare(`${SELECT_KB} ORDER BY k.updated_at DESC`)
      .all() as unknown as KbRow[];
    res.json({ data: rows.map(serialiseKb) });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(kbSchema, req.body);
    const id = randomUUID();
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO knowledge_bases (id, name, description, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, body.name, body.description, body.color, now, now);
    const row = getDb()
      .prepare(`${SELECT_KB} WHERE k.id = ?`)
      .get(id) as unknown as KbRow;
    writeAudit(req, 'knowledge.create', 'knowledge_base', id, `创建知识库「${body.name}」`);
    res.status(201).json({ data: serialiseKb(row) });
  }),
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const kb = getDb()
      .prepare(`${SELECT_KB} WHERE k.id = ?`)
      .get(req.params.id) as unknown as KbRow | undefined;
    if (!kb) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    const docs = getDb()
      .prepare('SELECT * FROM documents WHERE kb_id = ? ORDER BY created_at DESC')
      .all(kb.id) as unknown as DocRow[];
    res.json({ data: { ...serialiseKb(kb), documents: docs.map(serialiseDoc) } });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(kbSchema.partial(), req.body);
    const existing = getDb()
      .prepare('SELECT * FROM knowledge_bases WHERE id = ?')
      .get(req.params.id) as
      | { id: string; name: string; description: string; color: string }
      | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    getDb()
      .prepare(
        'UPDATE knowledge_bases SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.color ?? existing.color,
        nowIso(),
        existing.id,
      );
    const row = getDb()
      .prepare(`${SELECT_KB} WHERE k.id = ?`)
      .get(existing.id) as unknown as KbRow;
    writeAudit(req, 'knowledge.update', 'knowledge_base', existing.id, `更新知识库「${row.name}」`);
    res.json({ data: serialiseKb(row) });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = getDb()
      .prepare('SELECT * FROM knowledge_bases WHERE id = ?')
      .get(req.params.id) as { id: string; name: string } | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    await removeKnowledgeBaseFromIndex(existing.id);
    getDb().prepare('DELETE FROM knowledge_bases WHERE id = ?').run(existing.id);
    writeAudit(req, 'knowledge.delete', 'knowledge_base', existing.id, `删除知识库「${existing.name}」`);
    res.json({ data: { ok: true } });
  }),
);

router.post(
  '/:id/documents',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const kb = getDb()
      .prepare('SELECT id, name FROM knowledge_bases WHERE id = ?')
      .get(req.params.id) as { id: string; name: string } | undefined;
    if (!kb) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');

    const body = parse(docSchema, req.body);
    const id = randomUUID();
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO documents
          (id, kb_id, title, content, tokens, status, chunk_count, index_error, checksum, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'processing', 0, '', '', ?, ?)`,
      )
      .run(
        id,
        kb.id,
        body.title,
        body.content,
        estimateTokens(body.content),
        now,
        now,
      );
    getDb()
      .prepare('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?')
      .run(now, kb.id);

    enqueueIndex(id);
    const row = getDb()
      .prepare('SELECT * FROM documents WHERE id = ?')
      .get(id) as unknown as DocRow;
    writeAudit(
      req,
      'document.create',
      'document',
      id,
      `向「${kb.name}」添加文档「${body.title}」并提交向量索引`,
    );
    res.status(201).json({ data: serialiseDoc(row) });
  }),
);

router.patch(
  '/:id/documents/:docId',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(docSchema.partial(), req.body);
    const existing = getDb()
      .prepare('SELECT * FROM documents WHERE id = ? AND kb_id = ?')
      .get(req.params.docId, req.params.id) as unknown as DocRow | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '文档不存在');

    const content = body.content ?? existing.content;
    const now = nowIso();
    await removeDocumentFromIndex(existing.id);
    getDb()
      .prepare(
        `UPDATE documents SET
          title = ?, content = ?, tokens = ?, status = 'processing',
          chunk_count = 0, index_error = '', updated_at = ?
         WHERE id = ?`,
      )
      .run(
        body.title ?? existing.title,
        content,
        estimateTokens(content),
        now,
        existing.id,
      );
    getDb()
      .prepare('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?')
      .run(now, req.params.id);

    enqueueIndex(existing.id);
    const row = getDb()
      .prepare('SELECT * FROM documents WHERE id = ?')
      .get(existing.id) as unknown as DocRow;
    writeAudit(req, 'document.update', 'document', existing.id, `更新文档「${row.title}」并重建索引`);
    res.json({ data: serialiseDoc(row) });
  }),
);

router.delete(
  '/:id/documents/:docId',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = getDb()
      .prepare('SELECT * FROM documents WHERE id = ? AND kb_id = ?')
      .get(req.params.docId, req.params.id) as unknown as DocRow | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '文档不存在');
    await removeDocumentFromIndex(existing.id);
    getDb().prepare('DELETE FROM documents WHERE id = ?').run(existing.id);
    getDb()
      .prepare('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?')
      .run(nowIso(), req.params.id);
    writeAudit(req, 'document.delete', 'document', existing.id, `删除文档「${existing.title}」`);
    res.json({ data: { ok: true } });
  }),
);

router.get(
  '/:id/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (!query.trim()) throw new ApiError(422, 'VALIDATION_ERROR', '请输入检索关键词');
    const result = await retrieveKnowledge(req.params.id, query, { limit: 8 });
    res.json({
      data: {
        query,
        chunks: result.chunks,
        citations: result.citations,
        mode: result.mode,
        latencyMs: result.latencyMs,
        warning: result.warning,
      },
    });
  }),
);

router.post(
  '/:id/reindex',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const kb = getDb()
      .prepare('SELECT id, name FROM knowledge_bases WHERE id = ?')
      .get(req.params.id) as { id: string; name: string } | undefined;
    if (!kb) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    const count = await reindexKnowledgeBase(kb.id);
    writeAudit(req, 'knowledge.reindex', 'knowledge_base', kb.id, `重建知识库「${kb.name}」向量索引`);
    res.json({ data: { queued: count } });
  }),
);

export default router;
