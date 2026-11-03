import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import type { AuthUser, Role } from '../types.js';
import { ApiError } from './errors.js';

interface TokenPayload {
  sub: string;
  role: Role;
  name: string;
  email: string;
}

export function signToken(user: AuthUser): string {
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'UNAUTHORIZED', '请先登录后再访问');
    }
    const token = header.slice(7);
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    const row = getDb()
      .prepare(
        'SELECT id, name, email, role, status, avatar_color FROM users WHERE id = ?',
      )
      .get(payload.sub) as
      | {
          id: string;
          name: string;
          email: string;
          role: Role;
          status: string;
          avatar_color: string;
        }
      | undefined;

    if (!row || row.status !== 'active') {
      throw new ApiError(401, 'UNAUTHORIZED', '账号不存在或已被停用');
    }

    req.user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatarColor: row.avatar_color,
    };
    next();
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    next(new ApiError(401, 'UNAUTHORIZED', '登录状态已失效，请重新登录'));
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, 'UNAUTHORIZED', '请先登录后再访问'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'FORBIDDEN', '当前角色没有执行此操作的权限'));
    }
    return next();
  };
}

export function publicUser(row: {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar_color: string;
  created_at?: string;
  last_login_at?: string | null;
  status?: string;
}): AuthUser & { createdAt?: string; lastLoginAt?: string | null } {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}
