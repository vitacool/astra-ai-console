import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BookOpenText,
  Copy,
  MessagesSquare,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type {
  Assistant,
  KnowledgeBase,
  Provider,
} from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { PageHeader } from '../components/PageHeader';
import { Drawer } from '../components/Modal';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Segmented,
  Select,
  Skeleton,
  Textarea,
  Toggle,
} from '../components/ui';
import {
  assistantIconNames,
  colorOptions,
  getAssistantIcon,
} from '../lib/icons';
import { cn, formatCompact, formatDateTime } from '../lib/utils';

interface AssistantForm {
  name: string;
  description: string;
  systemPrompt: string;
  providerId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  icon: string;
  color: string;
  knowledgeBaseId: string;
  status: 'active' | 'draft';
}

const emptyForm: AssistantForm = {
  name: '',
  description: '',
  systemPrompt:
    '你是一位专业、可靠的 AI 助手。请先理解用户的真实目标，再给出结构清晰、可以直接执行的回答。回答使用简体中文和 Markdown。',
  providerId: '',
  model: '',
  temperature: 0.7,
  maxTokens: 2048,
  icon: 'Sparkles',
  color: '#5EEAD4',
  knowledgeBaseId: '',
  status: 'active',
};

export function AssistantsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canEdit = user?.role !== 'MEMBER';

  const [filter, setFilter] = useState<'all' | 'active' | 'draft'>('all');
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Assistant | null>(null);
  const [form, setForm] = useState<AssistantForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const assistantsQuery = useQuery({
    queryKey: ['assistants'],
    queryFn: () => api<Assistant[]>('/api/assistants'),
  });
  const providersQuery = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<Provider[]>('/api/providers'),
  });
  const knowledgeQuery = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: () => api<KnowledgeBase[]>('/api/knowledge-bases'),
  });

  const assistants = assistantsQuery.data ?? [];
  const providers = providersQuery.data ?? [];
  const knowledgeBases = knowledgeQuery.data ?? [];
  const selectedProvider = providers.find(
    (provider) => provider.id === form.providerId,
  );

  useEffect(() => {
    if (!drawerOpen) return;
    if (editing) {
      setForm({
        name: editing.name,
        description: editing.description,
        systemPrompt: editing.systemPrompt,
        providerId: editing.providerId ?? '',
        model: editing.model,
        temperature: editing.temperature,
        maxTokens: editing.maxTokens,
        icon: editing.icon,
        color: editing.color,
        knowledgeBaseId: editing.knowledgeBaseId ?? '',
        status: editing.status,
      });
    } else {
      const first = providers[0];
      setForm({
        ...emptyForm,
        providerId: first?.id ?? '',
        model: first?.defaultModel ?? '',
      });
    }
  }, [drawerOpen, editing, providers]);

  const counts = useMemo(
    () => ({
      all: assistants.length,
      active: assistants.filter((item) => item.status === 'active').length,
      draft: assistants.filter((item) => item.status === 'draft').length,
    }),
    [assistants],
  );

  const filtered = useMemo(() => {
    return assistants.filter((assistant) => {
      if (filter !== 'all' && assistant.status !== filter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        assistant.name.toLowerCase().includes(q) ||
        assistant.description.toLowerCase().includes(q) ||
        assistant.model.toLowerCase().includes(q)
      );
    });
  }, [assistants, filter, search]);

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (assistant: Assistant) => {
    setEditing(assistant);
    setDrawerOpen(true);
  };

  const update = <K extends keyof AssistantForm>(
    key: K,
    value: AssistantForm[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.name.trim() || !form.providerId || !form.systemPrompt.trim()) {
      toast.error('请填写助手名称、模型供应商与系统提示词');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        description: form.description.trim(),
        knowledgeBaseId: form.knowledgeBaseId || null,
      };
      if (editing) {
        await api(`/api/assistants/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('助手配置已更新');
      } else {
        await api('/api/assistants', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('AI 助手已创建');
      }
      setDrawerOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['assistants'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (assistant: Assistant) => {
    try {
      await api(`/api/assistants/${assistant.id}/duplicate`, { method: 'POST' });
      void queryClient.invalidateQueries({ queryKey: ['assistants'] });
      toast.success('已复制为草稿');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '复制失败');
    }
  };

  const remove = async (assistant: Assistant) => {
    const ok = await confirm({
      title: `删除「${assistant.name}」？`,
      description: '该助手的所有对话记录也会被删除，此操作无法撤销。',
      confirmText: '删除助手',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/assistants/${assistant.id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['assistants'] });
      toast.success('助手已删除');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="AI ASSISTANTS"
        title="AI 助手"
        description="为不同任务配置角色、模型与知识边界。好的助手，从清晰的提示词开始。"
        actions={
          canEdit ? (
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={openCreate}
            >
              创建助手
            </Button>
          ) : undefined
        }
      />

      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { label: '全部', value: 'all', count: counts.all },
            { label: '运行中', value: 'active', count: counts.active },
            { label: '草稿', value: 'draft', count: counts.draft },
          ]}
        />
        <div className="toolbar-right">
          <div className="search-box">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索助手或模型"
            />
          </div>
        </div>
      </div>

      {assistantsQuery.isLoading ? (
        <div className="assistant-grid">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} style={{ height: 248, borderRadius: 18 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={28} />}
          title={search ? '没有找到匹配的助手' : '创建你的第一个 AI 助手'}
          description={
            search
              ? '换一个关键词试试，或清除搜索条件。'
              : '把角色、模型和知识库组合起来，让 AI 真正理解你的业务。'
          }
          action={
            canEdit ? (
              <Button variant="primary" icon={<Plus size={16} />} onClick={openCreate}>
                创建助手
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="assistant-grid">
          {filtered.map((assistant) => {
            const Icon = getAssistantIcon(assistant.icon);
            return (
              <article
                key={assistant.id}
                className="assistant-card"
                onClick={() => canEdit && openEdit(assistant)}
              >
                <div className="assistant-card-top">
                  <span
                    className="assistant-card-icon"
                    style={{
                      color: assistant.color,
                      background: `${assistant.color}12`,
                      borderColor: `${assistant.color}2E`,
                    }}
                  >
                    <Icon size={24} />
                  </span>
                  <div className="assistant-card-badges">
                    <Badge
                      tone={assistant.status === 'active' ? 'mint' : 'neutral'}
                      dot
                    >
                      {assistant.status === 'active' ? '运行中' : '草稿'}
                    </Badge>
                    {assistant.knowledgeBaseId && (
                      <Badge tone="blue">
                        <BookOpenText size={11} /> 知识库
                      </Badge>
                    )}
                  </div>
                  {canEdit && (
                    <div
                      className="assistant-card-actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <IconButton
                        label="开始对话"
                        onClick={() =>
                          navigate(`/chat?assistant=${assistant.id}`)
                        }
                      >
                        <ArrowUpRight size={15} />
                      </IconButton>
                    </div>
                  )}
                </div>

                <h3>{assistant.name}</h3>
                <p>{assistant.description || '还没有填写助手描述'}</p>

                <div className="assistant-tags">
                  <code className="mono-tag">{assistant.model}</code>
                  {assistant.knowledgeBaseName && (
                    <span className="assistant-kb">
                      <BookOpenText size={11} />
                      {assistant.knowledgeBaseName}
                    </span>
                  )}
                </div>

                <div className="assistant-stats">
                  <span>
                    <MessagesSquare size={13} />
                    {assistant.conversations} 对话
                  </span>
                  <span>
                    {formatCompact(assistant.totalTokens)} tokens
                  </span>
                </div>

                <div className="assistant-card-foot">
                  <span>
                    由 {assistant.creatorName || '团队'} 创建 ·{' '}
                    {formatDateTime(assistant.updatedAt)}
                  </span>
                  {canEdit && (
                    <div
                      className="assistant-card-tools"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <IconButton label="编辑" onClick={() => openEdit(assistant)}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        label="复制"
                        onClick={() => void duplicate(assistant)}
                      >
                        <Copy size={14} />
                      </IconButton>
                      <IconButton
                        label="删除"
                        className="danger-hover"
                        onClick={() => void remove(assistant)}
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

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? '编辑 AI 助手' : '创建 AI 助手'}
        description="配置角色、模型与知识边界。保存后即可在对话工作台使用。"
        width={580}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
              取消
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {editing ? '保存修改' : '创建助手'}
            </Button>
          </>
        }
      >
        <div className="form-stack">
          <div className="form-grid-2">
            <Field label="助手名称" required>
              <Input
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="例如：品牌文案策划师"
                maxLength={40}
              />
            </Field>
            <Field label="状态">
              <div className="toggle-row">
                <Toggle
                  checked={form.status === 'active'}
                  onChange={(checked) =>
                    update('status', checked ? 'active' : 'draft')
                  }
                />
                <span>{form.status === 'active' ? '运行中' : '草稿'}</span>
              </div>
            </Field>
          </div>

          <Field label="一句话描述" hint="帮助团队快速理解这个助手擅长什么。">
            <Input
              value={form.description}
              onChange={(event) => update('description', event.target.value)}
              placeholder="擅长品牌文案、发布节奏与多渠道内容改写"
              maxLength={160}
            />
          </Field>

          <div className="form-grid-2">
            <Field label="模型供应商" required>
              <Select
                value={form.providerId}
                onChange={(event) => {
                  const provider = providers.find(
                    (item) => item.id === event.target.value,
                  );
                  setForm((current) => ({
                    ...current,
                    providerId: event.target.value,
                    model: provider?.defaultModel || provider?.models[0] || '',
                  }));
                }}
              >
                <option value="">选择供应商</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                    {provider.kind === 'mock' ? '（内置）' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="模型" required>
              {selectedProvider && selectedProvider.models.length > 0 ? (
                <Select
                  value={form.model}
                  onChange={(event) => update('model', event.target.value)}
                >
                  {!selectedProvider.models.includes(form.model) &&
                    form.model && <option value={form.model}>{form.model}</option>}
                  {selectedProvider.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={form.model}
                  onChange={(event) => update('model', event.target.value)}
                  placeholder="模型名称"
                />
              )}
            </Field>
          </div>

          {providers.length === 0 && (
            <div className="inline-warning">
              还没有可用的模型供应商。请先前往「模型供应商」完成接入。
            </div>
          )}

          <Field
            label="系统提示词"
            required
            hint={`${form.systemPrompt.length}/8000 · 清晰的角色、边界与输出格式会显著提升效果。`}
          >
            <Textarea
              value={form.systemPrompt}
              onChange={(event) => update('systemPrompt', event.target.value)}
              rows={7}
              maxLength={8000}
              placeholder="你是一位…请以…的方式回答…"
            />
          </Field>

          <Field label="绑定知识库" hint="对话时会自动检索最相关的资料片段。">
            <Select
              value={form.knowledgeBaseId}
              onChange={(event) => update('knowledgeBaseId', event.target.value)}
            >
              <option value="">不绑定知识库</option>
              {knowledgeBases.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}（{kb.documents} 篇）
                </option>
              ))}
            </Select>
          </Field>

          <div className="form-grid-2">
            <Field
              label={`创造性 · ${form.temperature.toFixed(1)}`}
              hint="数值越低越稳定，越高越有创意。"
            >
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                onChange={(event) =>
                  update('temperature', Number(event.target.value))
                }
                className="range"
              />
            </Field>
            <Field label="最大输出 Token">
              <Select
                value={form.maxTokens}
                onChange={(event) =>
                  update('maxTokens', Number(event.target.value))
                }
              >
                {[512, 1024, 1600, 2048, 3000, 4096].map((value) => (
                  <option key={value} value={value}>
                    {value} tokens
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="助手图标">
            <div className="icon-picker">
              {assistantIconNames.map((name) => {
                const Icon = getAssistantIcon(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className={cn('icon-option', form.icon === name && 'is-active')}
                    onClick={() => update('icon', name)}
                    aria-label={name}
                  >
                    <Icon size={18} />
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="主题色">
            <div className="color-picker">
              {colorOptions.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={cn(
                    'color-option',
                    form.color === color && 'is-active',
                  )}
                  style={{ background: color }}
                  onClick={() => update('color', color)}
                  aria-label={color}
                >
                  {form.color === color && <span />}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Drawer>
    </div>
  );
}
