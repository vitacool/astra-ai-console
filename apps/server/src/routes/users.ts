import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';

const router = Router();

interface UserListRow {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  status: string;
  avatar_color: string;
  created_at: string;
  last_login_at: string | null;
  conversations: number;
  tokens: number;
}

router.get(
  '/',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.status, u.avatar_color, u.created_at, u.last_login_at,
                (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) AS conversations,
                (SELECT COALESCE(SUM(l.total_tokens), 0) FROM usage_logs l WHERE l.user_id = u.id) AS tokens
         FROM users u ORDER BY
           CASE u.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,
           u.created_at`,
      )
      .all() as unknown as UserListRow[];

    res.json({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        status: row.status,
        avatarColor: row.avatar_color,
        conversations: row.conversations,
        tokens: row.tokens,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
      })),
    });
  }),
);

const inviteSchema = z.object({
  name: z.string().trim().min(2, '姓名至少 2 个字符').max(24),
  email: z.string().trim().email('请输入有效邮箱'),
  password: z
    .string()
    .min(8, '初始密码至少 8 位')
    .regex(/[A-Za-z]/, '密码需要包含字母')
    .regex(/\d/, '密码需要包含数字'),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional().default('MEMBER'),
});

router.post(
  '/',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(inviteSchema, req.body);
    if (req.user!.role === 'ADMIN' && body.role !== 'MEMBER') {
      throw new ApiError(403, 'FORBIDDEN', '管理员只能邀请普通成员');
    }

    const existing = getDb()
      .prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
      .get(body.email);
    if (existing) throw new ApiError(409, 'EMAIL_EXISTS', '该邮箱已被使用');

    const id = randomUUID();
    const colors = ['#5EEAD4', '#93C5FD', '#FCD34D', '#C4B5FD', '#F9A8D4'];
    getDb()
      .prepare(
        `INSERT INTO users (id, name, email, password_hash, role, status, avatar_color, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
      )
      .run(
        id,
        body.name,
        body.email,
        bcrypt.hashSync(body.password, 10),
        body.role,
        colors[Math.floor(Math.random() * colors.length)],
        nowIso(),
      );
    writeAudit(req, 'member.invite', 'user', id, `邀请成员 ${body.name} 加入工作区`);

    res.status(201).json({
      data: {
        id,
        name: body.name,
        email: body.email,
        role: body.role,
        status: 'active',
      },
    });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(24).optional(),
        role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional(),
        status: z.enum(['active', 'disabled']).optional(),
      }),
      req.body,
    );
    const target = getDb()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(req.params.id) as
      | {
          id: string;
          name: string;
          role: 'OWNER' | 'ADMIN' | 'MEMBER';
          status: string;
        }
      | undefined;
    if (!target) throw new ApiError(404, 'NOT_FOUND', '成员不存在');

    if (target.id === req.user!.id) {
      if (body.role && body.role !== target.role) {
        throw new ApiError(400, 'SELF_ROLE', '不能修改自己的角色');
      }
      if (body.status === 'disabled') {
        throw new ApiError(400, 'SELF_DISABLE', '不能停用自己的账号');
      }
    }

    if (req.user!.role === 'ADMIN' && target.role !== 'MEMBER') {
      throw new ApiError(403, 'FORBIDDEN', '管理员不能修改负责人或其他管理员');
    }
    if (req.user!.role === 'ADMIN' && body.role && body.role !== 'MEMBER') {
      throw new ApiError(403, 'FORBIDDEN', '管理员不能提升成员角色');
    }

    const losingOwner =
      target.role === 'OWNER' &&
      ((body.role && body.role !== 'OWNER') || body.status === 'disabled');
    if (losingOwner) {
      const owners = getDb()
        .prepare(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'OWNER' AND status = 'active'",
        )
        .get() as { count: number };
      if (owners.count <= 1) {
        throw new ApiError(400, 'LAST_OWNER', '工作区至少需要保留一位启用状态的负责人');
      }
    }

    getDb()
      .prepare(
        'UPDATE users SET name = ?, role = ?, status = ? WHERE id = ?',
      )
      .run(
        body.name ?? target.name,
        body.role ?? target.role,
        body.status ?? target.status,
        target.id,
      );
    writeAudit(req, 'member.update', 'user', target.id, `更新成员「${body.name ?? target.name}」`);
    res.json({ data: { ok: true } });
  }),
);

export default router;
