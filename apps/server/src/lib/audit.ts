import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { nowIso } from './time.js';

export function writeAudit(
  req: Request,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      req.user?.id ?? null,
      action,
      targetType,
      targetId,
      detail,
      req.ip ?? '',
      nowIso(),
    );
}
