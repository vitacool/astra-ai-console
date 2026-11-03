import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  Filter,
  MessagesSquare,
  RefreshCw,
  Target,
  TriangleAlert,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, ApiError } from '../lib/api';
import type { Assistant, Provider, UsageData } from '../types';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Avatar } from '../components/Avatar';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  Segmented,
  Skeleton,
} from '../components/ui';
import {
  cn,
  downloadCsv,
  formatCompact,
  formatDateTime,
  formatNumber,
  sourceLabel,
} from '../lib/utils';

function MiniStat({
  label,
  value,
  icon,
  note,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  note: string;
  tone: string;
}) {
  return (
    <Card className="usage-mini">
      <div className="usage-mini-icon" style={{ color: tone }}>
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </Card>
  );
}

export function UsagePage() {
  const toast = useToast();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [assistantId, setAssistantId] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const assistantsQuery = useQuery({
    queryKey: ['assistants'],
    queryFn: () => api<Assistant[]>('/api/assistants'),
  });
  const providersQuery = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<Provider[]>('/api/providers'),
    staleTime: 60_000,
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      days: String(days),
      page: String(page),
      pageSize: '12',
    });
    if (assistantId) params.set('assistantId', assistantId);
    if (model) params.set('model', model);
    if (status) params.set('status', status);
    return params.toString();
  }, [days, assistantId, model, status, page]);

  const usageQuery = useQuery({
    queryKey: ['usage', queryString],
    queryFn: () => api<UsageData>(`/api/usage?${queryString}`),
  });

  useEffect(() => {
    setPage(1);
  }, [days, assistantId, model, status]);

  const data = usageQuery.data;
  const models = useMemo(() => {
    const all = new Set<string>();
    (providersQuery.data ?? []).forEach((provider) =>
      provider.models.forEach((item) => all.add(item)),
    );
    return [...all];
  }, [providersQuery.data]);

  const chartData = (data?.series ?? []).map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    }),
  }));

  const maxAssistant = Math.max(
    ...(data?.assistants ?? []).map((item) => item.tokens),
    1,
  );
  const maxMember = Math.max(
    ...(data?.members ?? []).map((item) => item.tokens),
    1,
  );

  const exportCsv = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const allLogs: UsageData['logs'] = [];
      const exportPages = Math.max(1, Math.ceil(data.pagination.total / 100));
      let currentPage = 1;
      while (currentPage <= exportPages) {
        const params = new URLSearchParams({
          days: String(days),
          page: String(currentPage),
          pageSize: '100',
        });
        if (assistantId) params.set('assistantId', assistantId);
        if (model) params.set('model', model);
        if (status) params.set('status', status);
        const next = await api<UsageData>(`/api/usage?${params.toString()}`);
        allLogs.push(...next.logs);
        currentPage += 1;
      }
      const rows = [
        ['时间', '助手', '成员', '模型', '供应商', '输入Token', '输出Token', '总Token', '延迟(ms)', '状态', '来源'],
        ...allLogs.map((log) => [
          formatDateTime(log.createdAt),
          log.assistantName || '',
          log.userName || '',
          log.model,
          log.providerName || '',
          String(log.promptTokens),
          String(log.completionTokens),
          String(log.totalTokens),
          String(log.latency),
          log.status,
          sourceLabel(log.source),
        ]),
      ];
      downloadCsv(`astra-usage-${days}d.csv`, rows);
      toast.success(`已导出 ${allLogs.length} 条调用记录`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="USAGE & INSIGHTS"
        title="用量分析"
        description="从请求、Token 到延迟，理解 AI 工作流的真实成本与健康度。"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw size={15} />}
              onClick={() => void usageQuery.refetch()}
            >
              刷新
            </Button>
            <Button
              variant="primary"
              icon={<ArrowDownToLine size={15} />}
              onClick={() => void exportCsv()}
              disabled={!data}
              loading={exporting}
            >
              导出 CSV
            </Button>
          </>
        }
      />

      <div className="usage-toolbar">
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { label: '近 7 天', value: 7 },
            { label: '近 30 天', value: 30 },
            { label: '近 90 天', value: 90 },
          ]}
        />
        <div className="usage-filters">
          <span className="filter-label">
            <Filter size={13} /> 筛选
          </span>
          <Select
            value={assistantId}
            onChange={(event) => setAssistantId(event.target.value)}
          >
            <option value="">全部助手</option>
            {(assistantsQuery.data ?? []).map((assistant) => (
              <option key={assistant.id} value={assistant.id}>
                {assistant.name}
              </option>
            ))}
          </Select>
          <Select
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            <option value="">全部模型</option>
            {models.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">全部状态</option>
            <option value="success">仅成功</option>
            <option value="error">仅失败</option>
          </Select>
          {(assistantId || model || status) && (
            <button
              className="filter-clear"
              onClick={() => {
                setAssistantId('');
                setModel('');
                setStatus('');
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {usageQuery.isLoading || !data ? (
        <>
          <div className="usage-stats">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} style={{ height: 116, borderRadius: 18 }} />
            ))}
          </div>
          <Skeleton style={{ height: 340, borderRadius: 20 }} />
        </>
      ) : (
        <>
          <div className="usage-stats">
            <MiniStat
              label="总 Token"
              value={formatCompact(data.summary.tokens)}
              icon={<Coins size={18} />}
              note={`${formatNumber(data.summary.requests)} 次请求`}
              tone="#5EEAD4"
            />
            <MiniStat
              label="成功率"
              value={`${data.summary.successRate}%`}
              icon={<Target size={18} />}
              note={`${data.summary.errors} 次失败`}
              tone="#A78BFA"
            />
            <MiniStat
              label="平均延迟"
              value={`${formatNumber(data.summary.avgLatency)}ms`}
              icon={<Clock3 size={18} />}
              note="端到端生成耗时"
              tone="#FBBF24"
            />
            <MiniStat
              label="平均 Token"
              value={formatNumber(
                data.summary.requests
                  ? data.summary.tokens / data.summary.requests
                  : 0,
              )}
              icon={<MessagesSquare size={18} />}
              note="每次请求"
              tone="#38BDF8"
            />
          </div>

          <div className="usage-main-grid">
            <Card className="usage-chart-card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">CONSUMPTION</div>
                  <h2>Token 与请求趋势</h2>
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
              <div className="chart-wrap usage-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 10, right: 2, left: -18, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#5EEAD4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#5EEAD4" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="rgba(255,255,255,.05)"
                      vertical={false}
                      strokeDasharray="3 5"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6F7F8F', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      dy={8}
                      interval={days > 30 ? 9 : days > 7 ? 3 : 0}
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
                    <Tooltip
                      contentStyle={{
                        background: '#0F151C',
                        border: '1px solid rgba(255,255,255,.1)',
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: '#8A98A8' }}
                      formatter={(value: number, name: string) => [
                        formatNumber(value),
                        name === 'tokens' ? 'Token' : '请求',
                      ]}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="tokens"
                      stroke="#5EEAD4"
                      strokeWidth={2}
                      fill="url(#usageFill)"
                    />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="requests"
                      stroke="#38BDF8"
                      strokeWidth={1.4}
                      fill="transparent"
                      strokeDasharray="4 4"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="usage-breakdown">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">BY ASSISTANT</div>
                  <h2>助手消耗</h2>
                </div>
              </div>
              <div className="breakdown-list">
                {data.assistants.map((item) => (
                  <div key={item.id ?? item.name} className="breakdown-row">
                    <span
                      className="breakdown-dot"
                      style={{ background: item.color }}
                    />
                    <div className="breakdown-main">
                      <div>
                        <strong>{item.name}</strong>
                        <span>{formatCompact(item.tokens)}</span>
                      </div>
                      <div className="breakdown-bar">
                        <span
                          style={{
                            width: `${(item.tokens / maxAssistant) * 100}%`,
                            background: item.color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                {data.assistants.length === 0 && (
                  <div className="mini-empty">暂无数据</div>
                )}
              </div>
              <div className="breakdown-divider" />
              <div className="card-head compact">
                <div>
                  <div className="card-eyebrow">BY MEMBER</div>
                  <h2>成员消耗</h2>
                </div>
              </div>
              <div className="breakdown-list">
                {data.members.slice(0, 4).map((item) => (
                  <div key={item.id ?? item.name} className="breakdown-row">
                    <Avatar
                      name={item.name}
                      color={item.color}
                      size={22}
                    />
                    <div className="breakdown-main">
                      <div>
                        <strong>{item.name}</strong>
                        <span>{formatCompact(item.tokens)}</span>
                      </div>
                      <div className="breakdown-bar">
                        <span
                          style={{
                            width: `${(item.tokens / maxMember) * 100}%`,
                            background: item.color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="usage-table-card">
            <div className="card-head">
              <div>
                <div className="card-eyebrow">REQUEST LOG</div>
                <h2>调用明细</h2>
              </div>
              <span className="table-count">
                共 {formatNumber(data.pagination.total)} 条记录
              </span>
            </div>
            {data.logs.length === 0 ? (
              <EmptyState
                icon={<TriangleAlert size={24} />}
                title="当前筛选下没有记录"
                description="尝试调整时间范围或清除筛选条件。"
              />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table usage-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>助手 / 成员</th>
                        <th>模型</th>
                        <th className="align-right">输入</th>
                        <th className="align-right">输出</th>
                        <th className="align-right">总计</th>
                        <th className="align-right">延迟</th>
                        <th>来源</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.logs.map((log) => (
                        <tr key={log.id}>
                          <td className="subtle nowrap">
                            {formatDateTime(log.createdAt)}
                          </td>
                          <td>
                            <div className="stacked-cell">
                              <span className="table-assistant">
                                <i
                                  style={{
                                    background: log.assistantColor || '#64748B',
                                  }}
                                />
                                {log.assistantName || '已删除'}
                              </span>
                              <span className="stacked-sub">
                                {log.userName || '未知成员'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <code className="mono-tag">{log.model}</code>
                          </td>
                          <td className="align-right mono">
                            {formatNumber(log.promptTokens)}
                          </td>
                          <td className="align-right mono">
                            {formatNumber(log.completionTokens)}
                          </td>
                          <td className="align-right mono strong">
                            {formatNumber(log.totalTokens)}
                          </td>
                          <td className="align-right mono">{log.latency}ms</td>
                          <td>
                            <span className="source-pill">
                              {sourceLabel(log.source)}
                            </span>
                          </td>
                          <td>
                            <Badge
                              tone={log.status === 'success' ? 'mint' : 'rose'}
                              dot
                            >
                              {log.status === 'success' ? '成功' : '失败'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <span>
                    第 {data.pagination.page} / {data.pagination.pages} 页
                  </span>
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ChevronLeft size={15} />}
                      disabled={data.pagination.page <= 1}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={data.pagination.page >= data.pagination.pages}
                      onClick={() =>
                        setPage((value) =>
                          Math.min(data.pagination.pages, value + 1),
                        )
                      }
                    >
                      下一页 <ChevronRight size={15} />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
