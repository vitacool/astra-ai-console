import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler, parse } from '../lib/errors.js';
import { dayKeys } from '../lib/time.js';

const router = Router();

const querySchema = z.object({
  days: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v)).default(30),
  assistantId: z.string().optional().default(''),
  model: z.string().optional().default(''),
  status: z.enum(['success', 'error']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(12),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parse(querySchema, req.query);
    const db = getDb();
    const start = new Date(
      Date.now() - query.days * 86_400_000,
    ).toISOString();

    const where: string[] = ['u.created_at >= ?'];
    const params: Array<string | number> = [start];
    if (query.assistantId) {
      where.push('u.assistant_id = ?');
      params.push(query.assistantId);
    }
    if (query.model) {
      where.push('u.model = ?');
      params.push(query.model);
    }
    if (query.status) {
      where.push('u.status = ?');
      params.push(query.status);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const summary = db
      .prepare(
        `SELECT COUNT(*) AS requests,
                COALESCE(SUM(u.total_tokens), 0) AS tokens,
                COALESCE(SUM(CASE WHEN u.status = 'success' THEN 1 ELSE 0 END), 0) AS successes,
                COALESCE(AVG(u.latency_ms), 0) AS latency
         FROM usage_logs u ${whereSql}`,
      )
      .get(...params) as {
      requests: number;
      tokens: number;
      successes: number;
      latency: number;
    };

    const dailyRows = db
      .prepare(
        `SELECT substr(u.created_at, 1, 10) AS day,
                COUNT(*) AS requests,
                COALESCE(SUM(u.total_tokens), 0) AS tokens
         FROM usage_logs u ${whereSql}
         GROUP BY day ORDER BY day`,
      )
      .all(...params) as unknown as Array<{
      day: string;
      requests: number;
      tokens: number;
    }>;
    const dailyMap = new Map(dailyRows.map((row) => [row.day, row]));
    const series = dayKeys(query.days).map((date) => ({
      date,
      requests: dailyMap.get(date)?.requests ?? 0,
      tokens: dailyMap.get(date)?.tokens ?? 0,
    }));

    const assistants = db
      .prepare(
        `SELECT a.id, a.name, a.color, COUNT(u.id) AS requests,
                COALESCE(SUM(u.total_tokens), 0) AS tokens
         FROM usage_logs u
         LEFT JOIN assistants a ON a.id = u.assistant_id
         ${whereSql}
         GROUP BY u.assistant_id
         ORDER BY tokens DESC LIMIT 8`,
      )
      .all(...params) as unknown as Array<{
      id: string | null;
      name: string | null;
      color: string | null;
      requests: number;
      tokens: number;
    }>;

    const models = db
      .prepare(
        `SELECT u.model AS name, COUNT(*) AS requests,
                COALESCE(SUM(u.total_tokens), 0) AS tokens
         FROM usage_logs u ${whereSql}
         GROUP BY u.model ORDER BY tokens DESC LIMIT 8`,
      )
      .all(...params) as unknown as Array<{
      name: string;
      requests: number;
      tokens: number;
    }>;

    const members = db
      .prepare(
        `SELECT us.id, us.name, us.avatar_color, COUNT(u.id) AS requests,
                COALESCE(SUM(u.total_tokens), 0) AS tokens
         FROM usage_logs u
         LEFT JOIN users us ON us.id = u.user_id
         ${whereSql}
         GROUP BY u.user_id
         ORDER BY tokens DESC LIMIT 8`,
      )
      .all(...params) as unknown as Array<{
      id: string | null;
      name: string | null;
      avatar_color: string | null;
      requests: number;
      tokens: number;
    }>;

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM usage_logs u ${whereSql}`)
      .get(...params) as { total: number };
    const offset = (query.page - 1) * query.pageSize;
    const logs = db
      .prepare(
        `SELECT u.*, a.name AS assistant_name, a.color AS assistant_color,
                us.name AS user_name, us.avatar_color AS user_color,
                p.name AS provider_name
         FROM usage_logs u
         LEFT JOIN assistants a ON a.id = u.assistant_id
         LEFT JOIN users us ON us.id = u.user_id
         LEFT JOIN providers p ON p.id = u.provider_id
         ${whereSql}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, offset) as unknown as Array<
      Record<string, unknown>
    >;

    res.json({
      data: {
        summary: {
          requests: summary.requests,
          tokens: summary.tokens,
          successRate: summary.requests
            ? Math.round((summary.successes / summary.requests) * 1000) / 10
            : 100,
          avgLatency: Math.round(summary.latency),
          errors: summary.requests - summary.successes,
        },
        series,
        assistants: assistants.map((row) => ({
          id: row.id,
          name: row.name ?? '已删除助手',
          color: row.color ?? '#64748B',
          requests: row.requests,
          tokens: row.tokens,
        })),
        models,
        members: members.map((row) => ({
          id: row.id,
          name: row.name ?? '已删除成员',
          color: row.avatar_color ?? '#64748B',
          requests: row.requests,
          tokens: row.tokens,
        })),
        logs: logs.map((row) => ({
          id: row.id,
          model: row.model,
          promptTokens: row.prompt_tokens,
          completionTokens: row.completion_tokens,
          totalTokens: row.total_tokens,
          latency: row.latency_ms,
          status: row.status,
          source: row.source,
          createdAt: row.created_at,
          assistantName: row.assistant_name,
          assistantColor: row.assistant_color,
          userName: row.user_name,
          userColor: row.user_color,
          providerName: row.provider_name,
        })),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: totalRow.total,
          pages: Math.max(1, Math.ceil(totalRow.total / query.pageSize)),
        },
      },
    });
  }),
);

export default router;
