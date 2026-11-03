import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import { publicUser, requireAuth, signToken } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';

const router = Router();

const attempts = new Map<string, { count: number; resetAt: number }>();

function throttle(key: string): void {
  const entry = attempts.get(key);
  const now = Date.now();
  if (entry && entry.resetAt > now && entry.count >= 8) {
    throw new ApiError(
      429,
      'TOO_MANY_ATTEMPTS',
      '登录尝试过于频繁，请 15 分钟后再试',
    );
  }
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
  } else {
    entry.count += 1;
  }
}

const loginSchema = z.object({
  email: z.string().trim().email('请输入有效的邮箱地址'),
  password: z.string().min(1, '请输入密码'),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parse(loginSchema, req.body);
    const ipKey = `${req.ip}:${body.email.toLowerCase()}`;
    throttle(ipKey);

    const user = getDb()
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(body.email) as
      | {
          id: string;
          name: string;
          email: string;
          password_hash: string;
          role: 'OWNER' | 'ADMIN' | 'MEMBER';
          status: string;
          avatar_color: string;
          created_at: string;
          last_login_at: string | null;
        }
      | undefined;

    if (!user || !bcrypt.compareSync(body.password, user.password_hash)) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确');
    }
    if (user.status !== 'active') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '该账号已被停用，请联系管理员');
    }

    attempts.delete(ipKey);
    const lastLoginAt = nowIso();
    getDb()
      .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .run(lastLoginAt, user.id);

    const authUser = publicUser({ ...user, last_login_at: lastLoginAt });
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarColor: user.avatar_color,
    };
    writeAudit(req, 'auth.login', 'session', null, '登录控制台');

    res.json({
      data: {
        token: signToken(req.user),
        user: authUser,
      },
    });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = getDb()
      .prepare(
        'SELECT id, name, email, role, avatar_color, created_at, last_login_at FROM users WHERE id = ?',
      )
      .get(req.user!.id) as {
      id: string;
      name: string;
      email: string;
      role: 'OWNER' | 'ADMIN' | 'MEMBER';
      avatar_color: string;
      created_at: string;
      last_login_at: string | null;
    };
    res.json({ data: publicUser(row) });
  }),
);

router.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2, '昵称至少 2 个字符').max(24),
        avatarColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/, '请输入有效的颜色值')
          .optional(),
      }),
      req.body,
    );

    getDb()
      .prepare('UPDATE users SET name = ?, avatar_color = COALESCE(?, avatar_color) WHERE id = ?')
      .run(body.name, body.avatarColor ?? null, req.user!.id);

    const row = getDb()
      .prepare(
        'SELECT id, name, email, role, avatar_color, created_at, last_login_at FROM users WHERE id = ?',
      )
      .get(req.user!.id);
    writeAudit(req, 'profile.update', 'user', req.user!.id, '更新个人资料');
    res.json({ data: publicUser(row as never) });
  }),
);

router.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z
          .string()
          .min(8, '新密码至少 8 位')
          .regex(/[A-Za-z]/, '新密码需要包含字母')
          .regex(/\d/, '新密码需要包含数字'),
      }),
      req.body,
    );

    const user = getDb()
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(req.user!.id) as { password_hash: string };
    if (!bcrypt.compareSync(body.currentPassword, user.password_hash)) {
      throw new ApiError(400, 'INVALID_PASSWORD', '当前密码不正确');
    }
    getDb()
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(body.newPassword, 10), req.user!.id);
    writeAudit(req, 'password.change', 'user', req.user!.id, '修改登录密码');
    res.json({ data: { ok: true } });
  }),
);

export default router;
