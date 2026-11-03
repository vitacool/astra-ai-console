import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Database,
  FileClock,
  KeyRound,
  LogIn,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import type { AuditLog, Pagination } from '../types';
import { useAuth } from '../context/AuthContext';
import { AccessDenied } from '../components/AccessDenied';
import { PageHeader } from '../components/PageHeader';
import { Avatar } from '../components/Avatar';
import {
  Badge,
  Button,
  EmptyState,
  Select,
  Skeleton,
} from '../components/ui';
import { formatDateTime } from '../lib/utils';

const ACTION_GROUPS = [
  { value: '', label: '全部操作' },
  { value: 'auth', label: '登录与会话' },
  { value: 'assistant', label: 'AI 助手' },
  { value: 'provider', label: '模型供应商' },
  { value: 'knowledge', label: '知识库' },
  { value: 'document', label: '知识文档' },
  { value: 'member', label: '成员管理' },
  { value: 'settings', label: '工作区设置' },
  { value: 'conversation', label: '对话' },
];

function actionMeta(action: string) {
  if (action.startsWith('auth.'))
    return { icon: LogIn, tone: 'blue' as const, label: '登录' };
  if (action.startsWith('assistant.'))
    return { icon: Bot, tone: 'mint' as const, label: '助手' };
  if (action.startsWith('provider.'))
    return { icon: Database, tone: 'violet' as const, label: '供应商' };
  if (action.startsWith('knowledge.') || action.startsWith('document.'))
    return { icon: FileClock, tone: 'amber' as const, label: '知识库' };
  if (action.startsWith('member.') || action.startsWith('profile.'))
    return { icon: UserCog, tone: 'rose' as const, label: '成员' };
  if (action.startsWith('settings.'))
    return { icon: Settings, tone: 'neutral' as const, label: '设置' };
  if (action.startsWith('password.'))
    return { icon: KeyRound, tone: 'amber' as const, label: '安全' };
  if (action.startsWith('conversation.'))
    return { icon: Users, tone: 'blue' as const, label: '对话' };
  return { icon: ShieldCheck, tone: 'neutral' as const, label: '系统' };
}

export function AuditPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');

  const auditQuery = useQuery({
    queryKey: ['audit', page, action],
    queryFn: () =>
      api<{ logs: AuditLog[]; pagination: Pagination }>(
        `/api/audit?page=${page}&pageSize=20${action ? `&action=${action}` : ''}`,
      ),
    enabled: user?.role !== 'MEMBER',
  });

  const logs = auditQuery.data?.logs ?? [];
  const pagination = auditQuery.data?.pagination;

  const counts = useMemo(() => {
    return {
      total: pagination?.total ?? 0,
      shown: logs.length,
    };
  }, [logs.length, pagination?.total]);

  if (user?.role === 'MEMBER') return <AccessDenied />;

  return (
    <div className="page">
      <PageHeader
        eyebrow="AUDIT TRAIL"
        title="审计日志"
        description="每一个关键操作都有迹可循。敏感信息不会出现在日志中。"
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw size={15} />}
            onClick={() => void auditQuery.refetch()}
          >
            刷新
          </Button>
        }
      />

      <div className="audit-top">
        <div className="audit-summary">
          <span className="audit-summary-icon">
            <ShieldCheck size={19} />
          </span>
          <div>
            <strong>操作全程留痕</strong>
            <p>当前共 {counts.total} 条审计记录，展示最近 {counts.shown} 条。</p>
          </div>
        </div>
        <div className="audit-filter">
          <span>筛选</span>
          <Select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          >
            {ACTION_GROUPS.map((group) => (
              <option key={group.value} value={group.value}>
                {group.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {auditQuery.isLoading ? (
        <div className="audit-list">
          {[0, 1, 2, 3, 4].map((item) => (
            <Skeleton key={item} style={{ height: 82, borderRadius: 14 }} />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<FileClock size={28} />}
          title="没有匹配的审计记录"
          description="调整筛选条件后再试。"
        />
      ) : (
        <>
          <div className="audit-list">
            {logs.map((log) => {
              const meta = actionMeta(log.action);
              const Icon = meta.icon;
              return (
                <div key={log.id} className="audit-row">
                  <div className={`audit-icon ${meta.tone}`}>
                    <Icon size={17} />
                  </div>
                  <div className="audit-copy">
                    <div className="audit-title">
                      <strong>{log.detail}</strong>
                      <Badge tone="neutral">{meta.label}</Badge>
                    </div>
                    <div className="audit-meta">
                      <span className="audit-actor">
                        <Avatar
                          name={log.actorName}
                          color={log.actorColor}
                          size={19}
                        />
                        {log.actorName}
                      </span>
                      {log.targetType && (
                        <span>
                          {log.targetType}
                          {log.targetId ? ` · ${log.targetId.slice(0, 8)}` : ''}
                        </span>
                      )}
                      <span className="mono">{log.ip || '—'}</span>
                      <code className="audit-action">{log.action}</code>
                    </div>
                  </div>
                  <time className="audit-time">{formatDateTime(log.createdAt)}</time>
                </div>
              );
            })}
          </div>

          {pagination && (
            <div className="pagination">
              <span>
                第 {pagination.page} / {pagination.pages} 页 · 共{' '}
                {pagination.total} 条
              </span>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ChevronLeft size={15} />}
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pagination.page >= pagination.pages}
                  onClick={() =>
                    setPage((value) => Math.min(pagination.pages, value + 1))
                  }
                >
                  下一页 <ChevronRight size={15} />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
