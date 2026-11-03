import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  Coins,
  Database,
  MessagesSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type { DashboardData } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  cn,
  formatCompact,
  formatDateTime,
  formatNumber,
  greeting,
  todayLabel,
} from '../lib/utils';
import { getAssistantIcon } from '../lib/icons';
import { PageHeader } from '../components/PageHeader';
import { Avatar } from '../components/Avatar';
import {
  Badge,
  Button,
  Card,
  IconButton,
  Progress,
  Skeleton,
} from '../components/ui';

const PIE_COLORS = ['#5EEAD4', '#38BDF8', '#A78BFA', '#FBBF24', '#F472B6', '#94A3B8'];

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      {payload.map((item) => (
        <div key={item.name}>
          <i style={{ background: item.color }} />
          <span>{item.name === 'tokens' ? 'Token' : '请求'}</span>
          <strong>{formatNumber(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Sparkline({
  values,
  color = '#5EEAD4',
}: {
  values: number[];
  color?: string;
}) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const width = 96;
  const height = 28;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / Math.max(1, max - min)) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatCard({
  label,
  value,
  delta,
  suffix,
  icon,
  tone,
  spark,
  invert,
}: {
  label: string;
  value: string;
  delta?: number;
  suffix?: string;
  icon: React.ReactNode;
  tone: 'mint' | 'blue' | 'amber' | 'violet';
  spark?: number[];
  invert?: boolean;
}) {
  const positive = (delta ?? 0) >= 0;
  const good = invert ? !positive : positive;
  return (
    <Card className={cn('stat-card', `stat-${tone}`)}>
      <div className="stat-top">
        <span className="stat-icon">{icon}</span>
        <span className="stat-label">{label}</span>
        {delta !== undefined && (
          <span className={cn('stat-delta', good ? 'is-good' : 'is-bad')}>
            {positive ? (
              <ArrowUpRight size={12} />
            ) : (
              <ArrowDownRight size={12} />
            )}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="stat-main">
        <strong>
          {value}
          {suffix && <small>{suffix}</small>}
        </strong>
        {spark && <Sparkline values={spark} color={`var(--${tone})`} />}
      </div>
      <div className="stat-foot">较上一个 30 天</div>
    </Card>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/api/dashboard'),
  });

  if (isLoading) {
    return (
      <div className="page">
        <div className="page-skeleton-head">
          <Skeleton style={{ width: 280, height: 34 }} />
          <Skeleton style={{ width: 340, height: 16 }} />
        </div>
        <div className="stat-grid">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} style={{ height: 132, borderRadius: 18 }} />
          ))}
        </div>
        <Skeleton style={{ height: 340, borderRadius: 20 }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="page">
        <div className="error-panel">
          <Activity size={26} />
          <h2>暂时无法加载工作区数据</h2>
          <p>请确认 API 服务已经启动，然后重试。</p>
          <Button onClick={() => void refetch()}>重新加载</Button>
        </div>
      </div>
    );
  }

  const { summary, budget, series, assistants, models, recent, providers } = data;
  const maxAssistantTokens = Math.max(...assistants.map((item) => item.tokens), 1);
  const chartData = series.map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    }),
  }));

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow={`${todayLabel()} · ${data.summary.activeAssistants} 个助手在线`}
        title={`${greeting()}，${user?.name || '朋友'}`}
        description="这是你的 AI 工作区脉搏。模型调用、知识沉淀与团队协作，都在这里发生。"
        actions={
          <>
            <IconButton
              label="刷新数据"
              onClick={() => void refetch()}
              className={cn(isFetching && 'is-spinning')}
            >
              <RefreshCw size={16} />
            </IconButton>
            <Button
              variant="secondary"
              icon={<Activity size={16} />}
              onClick={() => navigate('/usage')}
            >
              用量报告
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={() => navigate('/chat')}
            >
              新建对话
            </Button>
          </>
        }
      />

      <div className="overview-strip">
        <div className="overview-copy">
          <div className="overview-icon">
            <Zap size={20} />
          </div>
          <div>
            <span>近 30 天运行状态</span>
            <strong>
              一切正常，已处理 {formatNumber(summary.requests)} 次请求
            </strong>
          </div>
        </div>
        <div className="overview-budget">
          <div className="overview-budget-head">
            <span>Token 预算</span>
            <strong>
              {formatCompact(budget.used)} / {formatCompact(budget.limit)}
            </strong>
          </div>
          <Progress
            value={budget.percent}
            color={budget.percent > 85 ? 'var(--amber)' : 'var(--accent)'}
          />
        </div>
        <Badge tone={budget.percent > 85 ? 'amber' : 'mint'} dot>
          {budget.percent > 85 ? '接近预算上限' : '预算健康'}
        </Badge>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Token 消耗"
          value={formatCompact(summary.tokens)}
          delta={summary.tokensDelta}
          icon={<Coins size={18} />}
          tone="mint"
          spark={series.map((item) => item.tokens)}
        />
        <StatCard
          label="模型请求"
          value={formatCompact(summary.requests)}
          delta={summary.requestsDelta}
          icon={<MessagesSquare size={18} />}
          tone="blue"
          spark={series.map((item) => item.requests)}
        />
        <StatCard
          label="成功率"
          value={`${summary.successRate}`}
          suffix="%"
          delta={summary.successRateDelta}
          icon={<Sparkles size={18} />}
          tone="violet"
        />
        <StatCard
          label="平均延迟"
          value={formatNumber(summary.avgLatency)}
          suffix="ms"
          delta={summary.latencyDelta}
          icon={<Clock3 size={18} />}
          tone="amber"
          invert
        />
      </div>

      <div className="dashboard-grid main-grid">
        <Card className="chart-card">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">USAGE TREND</div>
              <h2>Token 使用趋势</h2>
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-mint" /> Token
              </span>
              <span>
                <i className="legend-blue" /> 请求
              </span>
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 12, right: 4, left: -18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="tokenFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5EEAD4" stopOpacity={0.34} />
                    <stop offset="95%" stopColor="#5EEAD4" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="requestFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.16} />
                    <stop offset="95%" stopColor="#38BDF8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="rgba(255,255,255,0.05)"
                  vertical={false}
                  strokeDasharray="3 5"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#6F7F8F', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval={4}
                  dy={8}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: '#6F7F8F', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => formatCompact(Number(value))}
                  width={54}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: '#4E7181', fontSize: 9.5 }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="tokens"
                  stroke="#5EEAD4"
                  strokeWidth={2}
                  fill="url(#tokenFill)"
                  activeDot={{ r: 4, fill: '#5EEAD4', stroke: '#07100F' }}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="requests"
                  stroke="#38BDF8"
                  strokeWidth={1.5}
                  fill="url(#requestFill)"
                  activeDot={{ r: 3, fill: '#38BDF8', stroke: '#07100F' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-foot">
            <span>
              <i className="live-dot" />
              最近 30 天
            </span>
            <span>按日聚合 · UTC</span>
          </div>
        </Card>

        <Card className="model-card">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">MODEL MIX</div>
              <h2>模型分布</h2>
            </div>
            <Badge tone="neutral">{models.length} 个模型</Badge>
          </div>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={models}
                  dataKey="tokens"
                  nameKey="name"
                  innerRadius={54}
                  outerRadius={76}
                  paddingAngle={3}
                  stroke="none"
                >
                  {models.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#111820',
                    border: '1px solid rgba(255,255,255,.1)',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [formatNumber(value), 'Token']}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <strong>{formatCompact(summary.tokens)}</strong>
              <span>总 Token</span>
            </div>
          </div>
          <div className="model-legend">
            {models.map((model, index) => (
              <div key={model.name} className="model-legend-row">
                <i
                  style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}
                />
                <span title={model.name}>{model.name}</span>
                <strong>{model.percent}%</strong>
              </div>
            ))}
          </div>
          <button className="card-link" onClick={() => navigate('/providers')}>
            管理模型供应商 <ArrowRight size={14} />
          </button>
        </Card>
      </div>

      <div className="dashboard-grid lower-grid">
        <Card className="assistant-rank">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">TOP ASSISTANTS</div>
              <h2>高活跃助手</h2>
            </div>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => navigate('/assistants')}
            >
              查看全部 <ArrowRight size={14} />
            </Button>
          </div>
          <div className="rank-list">
            {assistants.map((assistant, index) => {
              const Icon = getAssistantIcon(assistant.icon);
              return (
                <div key={assistant.id} className="rank-row">
                  <span className="rank-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span
                    className="rank-icon"
                    style={{
                      color: assistant.color,
                      background: `${assistant.color}16`,
                      borderColor: `${assistant.color}35`,
                    }}
                  >
                    <Icon size={17} />
                  </span>
                  <div className="rank-main">
                    <div className="rank-top">
                      <strong>{assistant.name}</strong>
                      <span>{formatCompact(assistant.tokens)} tokens</span>
                    </div>
                    <Progress
                      value={(assistant.tokens / maxAssistantTokens) * 100}
                      color={assistant.color}
                    />
                  </div>
                  <span className="rank-requests">
                    {formatNumber(assistant.requests)}
                    <small>次</small>
                  </span>
                </div>
              );
            })}
          </div>
          {assistants.length === 0 && (
            <div className="mini-empty">还没有调用数据</div>
          )}
        </Card>

        <Card className="provider-health">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">INFRASTRUCTURE</div>
              <h2>模型服务</h2>
            </div>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => navigate('/providers')}
            >
              管理 <ArrowRight size={14} />
            </Button>
          </div>
          <div className="provider-health-list">
            {providers.map((provider) => (
              <button
                key={provider.id}
                className="provider-health-row"
                onClick={() => navigate('/providers')}
              >
                <span className="provider-health-icon">
                  <Database size={17} />
                </span>
                <span className="provider-health-copy">
                  <strong>{provider.name}</strong>
                  <small>{provider.defaultModel}</small>
                </span>
                <span className="provider-health-meta">
                  <span
                    className={cn(
                      'status-dot',
                      provider.status === 'active' ? 'is-ok' : 'is-muted',
                    )}
                  />
                  {provider.assistants} 个助手
                </span>
              </button>
            ))}
          </div>
          <div className="health-note">
            <span className="pulse-dot" />
            所有已启用服务均运行正常
          </div>
        </Card>
      </div>

      <Card className="activity-card">
        <div className="card-head">
          <div>
            <div className="card-eyebrow">LIVE ACTIVITY</div>
            <h2>最近调用</h2>
          </div>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => navigate('/usage')}
          >
            查看用量明细 <ArrowRight size={14} />
          </Button>
        </div>
        <div className="table-wrap">
          <table className="data-table activity-table">
            <thead>
              <tr>
                <th>助手</th>
                <th>成员</th>
                <th>模型</th>
                <th className="align-right">Token</th>
                <th className="align-right">延迟</th>
                <th>状态</th>
                <th className="align-right">时间</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="table-assistant">
                      <i style={{ background: item.assistantColor || '#64748B' }} />
                      {item.assistantName || '已删除助手'}
                    </span>
                  </td>
                  <td>
                    <span className="table-user">
                      <Avatar
                        name={item.userName || '未知'}
                        color={item.userColor || '#64748B'}
                        size={22}
                      />
                      {item.userName || '未知'}
                    </span>
                  </td>
                  <td>
                    <code className="mono-tag">{item.model}</code>
                  </td>
                  <td className="align-right mono">
                    {formatNumber(item.tokens)}
                  </td>
                  <td className="align-right mono">{item.latency}ms</td>
                  <td>
                    <Badge
                      tone={item.status === 'success' ? 'mint' : 'rose'}
                      dot
                    >
                      {item.status === 'success' ? '成功' : '失败'}
                    </Badge>
                  </td>
                  <td className="align-right subtle">
                    {formatDateTime(item.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
