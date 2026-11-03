import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler } from '../lib/errors.js';
import { dayKeys } from '../lib/time.js';

const router = Router();

function num(value: unknown): number {
  return Number(value ?? 0);
}

function delta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const days = 30;
    const start = new Date(Date.now() - days * 86_400_000).toISOString();
    const previousStart = new Date(
      Date.now() - days * 2 * 86_400_000,
    ).toISOString();

    const current = db
      .prepare(
        `SELECT COUNT(*) AS requests,
                COALESCE(SUM(total_tokens), 0) AS tokens,
                COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successes,
                COALESCE(AVG(latency_ms), 0) AS latency
         FROM usage_logs WHERE created_at >= ?`,
      )
      .get(start) as {
      requests: number;
      tokens: number;
      successes: number;
      latency: number;
    };

    const previous = db
      .prepare(
        `SELECT COUNT(*) AS requests,
                COALESCE(SUM(total_tokens), 0) AS tokens,
                COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successes,
                COALESCE(AVG(latency_ms), 0) AS latency
         FROM usage_logs WHERE created_at >= ? AND created_at < ?`,
      )
      .get(previousStart, start) as {
      requests: number;
      tokens: number;
      successes: number;
      latency: number;
    };

    const dailyRows = db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day,
                COUNT(*) AS requests,
                COALESCE(SUM(total_tokens), 0) AS tokens
         FROM usage_logs
         WHERE created_at >= ?
         GROUP BY day ORDER BY day`,
      )
      .all(start) as unknown as Array<{
      day: string;
      requests: number;
      tokens: number;
    }>;
    const dailyMap = new Map(dailyRows.map((row) => [row.day, row]));
    const series = dayKeys(days).map((date) => ({
      date,
      requests: dailyMap.get(date)?.requests ?? 0,
      tokens: dailyMap.get(date)?.tokens ?? 0,
    }));

    const assistants = db
      .prepare(
        `SELECT a.id, a.name, a.color, a.icon,
                COUNT(u.id) AS requests,
                COALESCE(SUM(u.total_tokens), 0) AS tokens
         FROM usage_logs u
         JOIN assistants a ON a.id = u.assistant_id
         WHERE u.created_at >= ?
         GROUP BY a.id
         ORDER BY tokens DESC LIMIT 5`,
      )
      .all(start) as unknown as Array<{
      id: string;
      name: string;
      color: string;
      icon: string;
      requests: number;
      tokens: number;
    }>;

    const modelRows = db
      .prepare(
        `SELECT model, COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens
         FROM usage_logs WHERE created_at >= ? AND status = 'success'
         GROUP BY model ORDER BY tokens DESC LIMIT 6`,
      )
      .all(start) as unknown as Array<{
      model: string;
      requests: number;
      tokens: number;
    }>;
    const modelTotal = modelRows.reduce((sum, row) => sum + num(row.tokens), 0);
    const models = modelRows.map((row) => ({
      name: row.model || 'unknown',
      requests: row.requests,
      tokens: row.tokens,
      percent: modelTotal
        ? Math.round((row.tokens / modelTotal) * 1000) / 10
        : 0,
    }));

    const recent = db
      .prepare(
        `SELECT u.id, u.model, u.total_tokens, u.status, u.latency_ms, u.created_at,
                a.name AS assistant_name, a.color AS assistant_color,
                us.name AS user_name, us.avatar_color AS user_color
         FROM usage_logs u
         LEFT JOIN assistants a ON a.id = u.assistant_id
         LEFT JOIN users us ON us.id = u.user_id
         ORDER BY u.created_at DESC LIMIT 8`,
      )
      .all() as unknown as Array<Record<string, unknown>>;

    const providerRows = db
      .prepare(
        `SELECT p.id, p.name, p.kind, p.status, p.default_model, p.last_checked_at,
                (SELECT COUNT(*) FROM assistants a WHERE a.provider_id = p.id) AS assistants
         FROM providers p ORDER BY p.created_at`,
      )
      .all() as unknown as Array<Record<string, unknown>>;

    const activeAssistants = db
      .prepare(
        "SELECT COUNT(*) AS count FROM assistants WHERE status = 'active'",
      )
      .get() as { count: number };
    const totalAssistants = db
      .prepare('SELECT COUNT(*) AS count FROM assistants')
      .get() as { count: number };
    const conversationCount = db
      .prepare('SELECT COUNT(*) AS count FROM conversations')
      .get() as { count: number };

    const budgetSetting = db
      .prepare("SELECT value FROM settings WHERE key = 'token_budget'")
      .get() as { value: string } | undefined;
    const budgetLimit = Number(budgetSetting?.value || 2_000_000);
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
    const monthUsage = db
      .prepare(
        'SELECT COALESCE(SUM(total_tokens), 0) AS tokens FROM usage_logs WHERE created_at >= ?',
      )
      .get(monthStart) as { tokens: number };

    const successRate = current.requests
      ? Math.round((current.successes / current.requests) * 1000) / 10
      : 100;
    const previousSuccessRate = previous.requests
      ? Math.round((previous.successes / previous.requests) * 1000) / 10
      : 100;

    res.json({
      data: {
        summary: {
          tokens: current.tokens,
          tokensDelta: delta(current.tokens, previous.tokens),
          requests: current.requests,
          requestsDelta: delta(current.requests, previous.requests),
          successRate,
          successRateDelta:
            Math.round((successRate - previousSuccessRate) * 10) / 10,
          avgLatency: Math.round(current.latency),
          latencyDelta: delta(current.latency, previous.latency),
          activeAssistants: activeAssistants.count,
          totalAssistants: totalAssistants.count,
          conversations: conversationCount.count,
        },
        budget: {
          limit: budgetLimit,
          used: monthUsage.tokens,
          percent: budgetLimit
            ? Math.round((monthUsage.tokens / budgetLimit) * 1000) / 10
            : 0,
        },
        series,
        assistants,
        models,
        recent: recent.map((row) => ({
          id: row.id,
          model: row.model,
          tokens: row.total_tokens,
          status: row.status,
          latency: row.latency_ms,
          createdAt: row.created_at,
          assistantName: row.assistant_name,
          assistantColor: row.assistant_color,
          userName: row.user_name,
          userColor: row.user_color,
        })),
        providers: providerRows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          status: row.status,
          defaultModel: row.default_model,
          lastCheckedAt: row.last_checked_at,
          assistants: row.assistants,
        })),
      },
    });
  }),
);

export default router;
