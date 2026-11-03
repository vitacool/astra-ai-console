import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Boxes,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Provider } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  Toggle,
} from '../components/ui';
import { cn, formatDateTime, relativeTime } from '../lib/utils';

interface ProviderForm {
  name: string;
  kind: 'mock' | 'openai';
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  models: string;
  clearKey: boolean;
}

const emptyForm: ProviderForm = {
  name: '',
  kind: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  defaultModel: 'deepseek-chat',
  models: 'deepseek-chat, deepseek-reasoner',
  clearKey: false,
};

export function ProvidersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const canEdit = user?.role !== 'MEMBER';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const providersQuery = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<Provider[]>('/api/providers'),
  });
  const providers = providersQuery.data ?? [];

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      setForm({
        name: editing.name,
        kind: editing.kind,
        baseUrl: editing.baseUrl,
        apiKey: '',
        defaultModel: editing.defaultModel,
        models: editing.models.join(', '),
        clearKey: false,
      });
    } else {
      setForm(emptyForm);
    }
    setShowKey(false);
  }, [modalOpen, editing]);

  const update = <K extends keyof ProviderForm>(
    key: K,
    value: ProviderForm[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const setKind = (kind: 'mock' | 'openai') => {
    setForm((current) => ({
      ...current,
      kind,
      name:
        current.name ||
        (kind === 'mock' ? 'ASTRA 内置引擎' : '自定义模型服务'),
      baseUrl: kind === 'mock' ? '' : current.baseUrl || 'https://api.deepseek.com/v1',
      defaultModel:
        kind === 'mock'
          ? 'astra-sim-1'
          : current.defaultModel === 'astra-sim-1'
            ? 'deepseek-chat'
            : current.defaultModel,
      models:
        kind === 'mock'
          ? 'astra-sim-1, astra-sim-mini'
          : current.models === 'astra-sim-1, astra-sim-mini'
            ? 'deepseek-chat, deepseek-reasoner'
            : current.models,
      clearKey: false,
      apiKey: '',
    }));
  };

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (provider: Provider) => {
    setEditing(provider);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.defaultModel.trim()) {
      toast.error('请填写供应商名称与默认模型');
      return;
    }
    if (form.kind === 'openai' && !form.baseUrl.trim()) {
      toast.error('请填写 OpenAI 兼容接口的 Base URL');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        kind: form.kind,
        baseUrl: form.baseUrl,
        defaultModel: form.defaultModel,
        models: form.models,
        clearKey: form.clearKey,
      };
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
      if (editing) {
        await api(`/api/providers/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('供应商配置已更新');
      } else {
        await api('/api/providers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('模型供应商已接入');
      }
      setModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const test = async (provider: Provider) => {
    setTestingId(provider.id);
    try {
      const result = await api<{ ok: boolean; message: string }>(
        `/api/providers/${provider.id}/test`,
        { method: 'POST' },
      );
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '连接测试失败');
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    } finally {
      setTestingId(null);
    }
  };

  const remove = async (provider: Provider) => {
    const ok = await confirm({
      title: `删除「${provider.name}」？`,
      description: '如果还有助手使用该供应商，需要先切换它们的模型。',
      confirmText: '删除供应商',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/providers/${provider.id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast.success('供应商已删除');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="MODEL PROVIDERS"
        title="模型供应商"
        description="统一接入 OpenAI 兼容服务。密钥加密存储，调用统一计量。"
        actions={
          canEdit ? (
            <Button variant="primary" icon={<Plus size={16} />} onClick={openCreate}>
              接入供应商
            </Button>
          ) : undefined
        }
      />

      <div className="security-banner">
        <div className="security-banner-icon">
          <ShieldCheck size={19} />
        </div>
        <div>
          <strong>密钥安全</strong>
          <p>
            API Key 使用 AES-256-GCM 加密后落库，接口只返回掩码。审计日志不会记录密钥明文。
          </p>
        </div>
        <Badge tone="mint" dot>
          已加密
        </Badge>
      </div>

      {providersQuery.isLoading ? (
        <div className="provider-grid">
          {[0, 1].map((item) => (
            <Skeleton key={item} style={{ height: 300, borderRadius: 18 }} />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <EmptyState
          icon={<Database size={28} />}
          title="还没有接入模型供应商"
          description="接入 OpenAI 兼容服务，或使用内置模拟引擎快速体验。"
          action={
            canEdit ? (
              <Button variant="primary" icon={<Plus size={16} />} onClick={openCreate}>
                接入第一个供应商
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="provider-grid">
          {providers.map((provider) => {
            const needsKey = provider.kind === 'openai' && !provider.hasKey;
            return (
              <article key={provider.id} className="provider-card">
                <div className="provider-card-head">
                  <span
                    className={cn(
                      'provider-logo',
                      provider.kind === 'mock' && 'is-mock',
                    )}
                  >
                    {provider.kind === 'mock' ? (
                      <Boxes size={22} />
                    ) : (
                      <Database size={22} />
                    )}
                  </span>
                  <div className="provider-title">
                    <div>
                      <h3>{provider.name}</h3>
                      <Badge tone={provider.kind === 'mock' ? 'violet' : 'blue'}>
                        {provider.kind === 'mock' ? '内置引擎' : 'OpenAI 兼容'}
                      </Badge>
                    </div>
                    <span
                      className={cn(
                        'provider-status',
                        provider.status === 'active' && 'is-ok',
                        provider.status === 'error' && 'is-error',
                      )}
                    >
                      <i />
                      {provider.status === 'active'
                        ? '运行中'
                        : provider.status === 'error'
                          ? '连接异常'
                          : '待配置'}
                    </span>
                  </div>
                </div>

                <div className="provider-endpoint">
                  {provider.kind === 'mock' ? (
                    <span>本地推理模拟 · 零配置</span>
                  ) : (
                    <code title={provider.baseUrl}>{provider.baseUrl}</code>
                  )}
                </div>

                <div className="provider-field">
                  <span>默认模型</span>
                  <code className="mono-tag">{provider.defaultModel}</code>
                </div>

                <div className="provider-models">
                  {provider.models.slice(0, 4).map((model) => (
                    <span key={model}>{model}</span>
                  ))}
                  {provider.models.length > 4 && (
                    <span>+{provider.models.length - 4}</span>
                  )}
                </div>

                <div className="provider-key-row">
                  <KeyRound size={14} />
                  {provider.hasKey ? (
                    <code>{provider.maskedKey}</code>
                  ) : (
                    <span className={needsKey ? 'key-missing' : ''}>
                      {provider.kind === 'mock' ? '无需密钥' : '尚未配置 API Key'}
                    </span>
                  )}
                </div>

                <div className="provider-stats">
                  <span>
                    <strong>{provider.assistants ?? 0}</strong> 个助手
                  </span>
                  <span>
                    {provider.lastCheckedAt
                      ? `检查于 ${relativeTime(provider.lastCheckedAt)}`
                      : '尚未检测'}
                  </span>
                </div>

                {needsKey && (
                  <div className="provider-warning">
                    <TriangleAlert size={13} />
                    配置密钥后即可用于真实对话
                  </div>
                )}

                <div className="provider-card-foot">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={
                      <RefreshCw
                        size={14}
                        className={testingId === provider.id ? 'spin' : undefined}
                      />
                    }
                    loading={testingId === provider.id}
                    onClick={() => void test(provider)}
                  >
                    测试连接
                  </Button>
                  {canEdit && (
                    <div className="provider-tools">
                      <IconButton label="编辑" onClick={() => openEdit(provider)}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        label="删除"
                        className="danger-hover"
                        onClick={() => void remove(provider)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="provider-howto">
        <div className="howto-step">
          <span>01</span>
          <strong>接入服务</strong>
          <p>填写 Base URL 与 API Key，兼容 OpenAI Chat Completions 协议。</p>
        </div>
        <div className="howto-line" />
        <div className="howto-step">
          <span>02</span>
          <strong>测试连接</strong>
          <p>平台会调用 /models 验证凭证与网络连通性。</p>
        </div>
        <div className="howto-line" />
        <div className="howto-step">
          <span>03</span>
          <strong>绑定助手</strong>
          <p>在创建或编辑助手时选择模型，即可开始对话。</p>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑供应商' : '接入模型供应商'}
        description="支持 DeepSeek、OpenAI、Moonshot、通义千问及自建推理服务。"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {editing ? '保存修改' : '保存并接入'}
            </Button>
          </>
        }
      >
        <div className="form-stack">
          <Field label="接入类型">
            <div className="kind-picker">
              <button
                type="button"
                className={cn('kind-option', form.kind === 'openai' && 'is-active')}
                onClick={() => setKind('openai')}
              >
                <Database size={19} />
                <span>
                  <strong>OpenAI 兼容</strong>
                  <small>真实模型服务</small>
                </span>
              </button>
              <button
                type="button"
                className={cn('kind-option', form.kind === 'mock' && 'is-active')}
                onClick={() => setKind('mock')}
              >
                <Zap size={19} />
                <span>
                  <strong>内置引擎</strong>
                  <small>本地模拟，零配置</small>
                </span>
              </button>
            </div>
          </Field>

          <Field label="显示名称" required>
            <Input
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="例如：DeepSeek 生产环境"
              maxLength={40}
            />
          </Field>

          {form.kind === 'openai' && (
            <>
              <Field
                label="Base URL"
                required
                hint="需包含版本路径，例如 https://api.deepseek.com/v1。"
              >
                <Input
                  value={form.baseUrl}
                  onChange={(event) => update('baseUrl', event.target.value)}
                  placeholder="https://api.deepseek.com/v1"
                />
              </Field>

              <Field
                label={editing?.hasKey ? 'API Key（留空保持不变）' : 'API Key'}
                hint={
                  editing?.hasKey
                    ? '已保存密钥。填写新密钥会覆盖，开启下方开关可移除。'
                    : '密钥仅用于服务端调用，不会发送到浏览器。'
                }
              >
                <div className="input-with-icon">
                  <KeyRound size={15} />
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(event) => update('apiKey', event.target.value)}
                    placeholder={editing?.hasKey ? '••••••••••••••••' : 'sk-…'}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="input-eye"
                    onClick={() => setShowKey((value) => !value)}
                    aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>

              {editing?.hasKey && (
                <div className="toggle-row toggle-row-bordered">
                  <Toggle
                    checked={form.clearKey}
                    onChange={(checked) => update('clearKey', checked)}
                  />
                  <div>
                    <strong>移除已保存的密钥</strong>
                    <span>移除后该供应商将无法发起真实对话。</span>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="form-grid-2">
            <Field label="默认模型" required>
              <Input
                value={form.defaultModel}
                onChange={(event) => update('defaultModel', event.target.value)}
                placeholder="deepseek-chat"
              />
            </Field>
            <Field label="模型列表" hint="用逗号分隔。">
              <Input
                value={form.models}
                onChange={(event) => update('models', event.target.value)}
                placeholder="deepseek-chat, deepseek-reasoner"
              />
            </Field>
          </div>

          {form.kind === 'mock' && (
            <div className="inline-info">
              <CheckCircle2 size={15} />
              内置引擎适合演示与开发。它会生成结构化的模拟回答，不产生外部调用费用。
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
