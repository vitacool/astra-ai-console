import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { asyncHandler, parse } from '../lib/errors.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const query = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(5).max(100).default(20),
        action: z.string().max(40).optional().default(''),
      }),
      req.query,
    );

    const where = query.action ? 'WHERE a.action LIKE ?' : '';
    const params = query.action ? [`${query.action}%`] : [];
    const total = getDb()
      .prepare(`SELECT COUNT(*) AS count FROM audit_logs a ${where}`)
      .get(...params) as { count: number };
    const rows = getDb()
      .prepare(
        `SELECT a.*, u.name AS actor_name, u.avatar_color AS actor_color
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(
        ...params,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      ) as unknown as Array<Record<string, unknown>>;

    res.json({
      data: {
        logs: rows.map((row) => ({
          id: row.id,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          detail: row.detail,
          ip: row.ip,
          createdAt: row.created_at,
          actorName: row.actor_name ?? '系统',
          actorColor: row.actor_color ?? '#64748B',
        })),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: total.count,
          pages: Math.max(1, Math.ceil(total.count / query.pageSize)),
        },
      },
    });
  }),
);

export default router;
