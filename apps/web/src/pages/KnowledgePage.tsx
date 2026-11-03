import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  Database,
  FileText,
  FolderPlus,
  Gauge,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type {
  EmbeddingConfig,
  KBDocument,
  KnowledgeBase,
  KnowledgeDetail,
  Provider,
  SearchResponse,
} from '../types';
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
  Segmented,
  Select,
  Skeleton,
  Textarea,
  Toggle,
} from '../components/ui';
import { colorOptions } from '../lib/icons';
import { cn, formatCompact, formatDateTime } from '../lib/utils';

type EditableKb = Pick<KnowledgeBase, 'id' | 'name' | 'description' | 'color'>;

const embeddingPresets = [
  'text-embedding-3-small',
  'text-embedding-3-large',
  'bge-m3',
  'Qwen/Qwen3-Embedding-0.6B',
];

export function KnowledgePage() {
  const { user } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const canEdit = user?.role !== 'MEMBER';

  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('kb'),
  );
  const [tab, setTab] = useState<'documents' | 'search'>('documents');
  const [kbModal, setKbModal] = useState(false);
  const [editingKb, setEditingKb] = useState<EditableKb | null>(null);
  const [kbName, setKbName] = useState('');
  const [kbDescription, setKbDescription] = useState('');
  const [kbColor, setKbColor] = useState('#5EEAD4');
  const [savingKb, setSavingKb] = useState(false);

  const [docModal, setDocModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<KBDocument | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const [configOpen, setConfigOpen] = useState(false);
  const [backend, setBackend] = useState<'local' | 'openai'>('local');
  const [providerId, setProviderId] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-3-small');
  const [dimensions, setDimensions] = useState('1536');
  const [topK, setTopK] = useState('5');
  const [minScore, setMinScore] = useState('0.12');
  const [testing, setTesting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testResult, setTestResult] = useState<{
    dimensions: number;
    latencyMs: number;
    model: string;
    sample: string;
  } | null>(null);

  const listQuery = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: () => api<KnowledgeBase[]>('/api/knowledge-bases'),
  });
  const detailQuery = useQuery({
    queryKey: ['knowledge-base', selectedId],
    queryFn: () => api<KnowledgeDetail>(`/api/knowledge-bases/${selectedId}`),
    enabled: Boolean(selectedId),
    refetchInterval: (query) => {
      const data = query.state.data as KnowledgeDetail | undefined;
      return data?.documents.some((doc) => doc.status === 'processing')
        ? 1600
        : false;
    },
  });
  const configQuery = useQuery({
    queryKey: ['embedding-config'],
    queryFn: () => api<EmbeddingConfig>('/api/embeddings/config'),
  });
  const providersQuery = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<Provider[]>('/api/providers'),
    staleTime: 60_000,
  });

  const bases = listQuery.data ?? [];
  const detail = detailQuery.data;
  const config = configQuery.data;
  const semanticProviders = (providersQuery.data ?? []).filter(
    (provider) => provider.kind === 'openai',
  );

  useEffect(() => {
    if (!selectedId && bases.length > 0) {
      setSelectedId(bases[0].id);
      setSearchParams({ kb: bases[0].id }, { replace: true });
    }
  }, [bases, selectedId, setSearchParams]);

  useEffect(() => {
    const fromUrl = searchParams.get('kb');
    if (fromUrl && fromUrl !== selectedId) {
      setSelectedId(fromUrl);
    }
  }, [searchParams, selectedId]);

  useEffect(() => {
    setTab('documents');
    setQuery('');
    setSearchResult(null);
  }, [selectedId]);

  const totalDocuments = useMemo(
    () => bases.reduce((sum, kb) => sum + kb.documents, 0),
    [bases],
  );

  const selectKb = (id: string) => {
    setSelectedId(id);
    setSearchParams({ kb: id }, { replace: true });
  };

  const openCreateKb = () => {
    setEditingKb(null);
    setKbName('');
    setKbDescription('');
    setKbColor('#5EEAD4');
    setKbModal(true);
  };

  const openEditKb = (kb: EditableKb) => {
    setEditingKb(kb);
    setKbName(kb.name);
    setKbDescription(kb.description);
    setKbColor(kb.color);
    setKbModal(true);
  };

  const saveKb = async () => {
    if (!kbName.trim()) {
      toast.error('请填写知识库名称');
      return;
    }
    setSavingKb(true);
    try {
      if (editingKb) {
        await api(`/api/knowledge-bases/${editingKb.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: kbName,
            description: kbDescription,
            color: kbColor,
          }),
        });
        toast.success('知识库已更新');
      } else {
        const created = await api<KnowledgeBase>('/api/knowledge-bases', {
          method: 'POST',
          body: JSON.stringify({
            name: kbName,
            description: kbDescription,
            color: kbColor,
          }),
        });
        setSelectedId(created.id);
        setSearchParams({ kb: created.id }, { replace: true });
        toast.success('知识库已创建');
      }
      setKbModal(false);
      void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSavingKb(false);
    }
  };

  const deleteKb = async (kb: {
    id: string;
    name: string;
    documents: number | KBDocument[];
  }) => {
    const docCount = Array.isArray(kb.documents)
      ? kb.documents.length
      : kb.documents;
    const ok = await confirm({
      title: `删除「${kb.name}」？`,
      description: `其中的 ${docCount} 篇文档及全部向量会被永久删除，已绑定该知识库的助手将自动解绑。`,
      confirmText: '删除知识库',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/knowledge-bases/${kb.id}`, { method: 'DELETE' });
      if (selectedId === kb.id) {
        setSelectedId(null);
        setSearchParams({}, { replace: true });
      }
      void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      void queryClient.invalidateQueries({ queryKey: ['assistants'] });
      void queryClient.invalidateQueries({ queryKey: ['embedding-config'] });
      toast.success('知识库与向量已删除');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败');
    }
  };

  const openCreateDoc = () => {
    setEditingDoc(null);
    setDocTitle('');
    setDocContent('');
    setDocModal(true);
  };

  const openEditDoc = (doc: KBDocument) => {
    setEditingDoc(doc);
    setDocTitle(doc.title);
    setDocContent(doc.content);
    setDocModal(true);
  };

  const saveDoc = async () => {
    if (!selectedId) return;
    if (!docTitle.trim() || docContent.trim().length < 10) {
      toast.error('请填写文档标题，内容至少 10 个字符');
      return;
    }
    setSavingDoc(true);
    try {
      if (editingDoc) {
        await api(
          `/api/knowledge-bases/${selectedId}/documents/${editingDoc.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ title: docTitle, content: docContent }),
          },
        );
        toast.success('文档已更新，正在重建向量索引');
      } else {
        await api(`/api/knowledge-bases/${selectedId}/documents`, {
          method: 'POST',
          body: JSON.stringify({ title: docTitle, content: docContent }),
        });
        toast.success('文档已加入知识库，正在建立向量索引');
      }
      setDocModal(false);
      void queryClient.invalidateQueries({
        queryKey: ['knowledge-base', selectedId],
      });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      void queryClient.invalidateQueries({ queryKey: ['embedding-config'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSavingDoc(false);
    }
  };

  const deleteDoc = async (doc: KBDocument) => {
    if (!selectedId) return;
    const ok = await confirm({
      title: `删除文档「${doc.title}」？`,
      description: '删除后，助手将无法再检索到这篇文档，对应向量也会被移除。',
      confirmText: '删除文档',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/knowledge-bases/${selectedId}/documents/${doc.id}`, {
        method: 'DELETE',
      });
      void queryClient.invalidateQueries({
        queryKey: ['knowledge-base', selectedId],
      });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      void queryClient.invalidateQueries({ queryKey: ['embedding-config'] });
      toast.success('文档与向量已删除');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败');
    }
  };

  const importFile = async (file: File) => {
    if (file.size > 500_000) {
      toast.error('文件过大，请上传 500KB 以内的纯文本或 Markdown 文件');
      return;
    }
    const text = await file.text();
    if (text.length > 200_000) {
      toast.error('文档内容不能超过 20 万字符');
      return;
    }
    setEditingDoc(null);
    setDocTitle(file.name.replace(/\.(md|markdown|txt)$/i, ''));
    setDocContent(text);
    setDocModal(true);
  };

  const reindex = async () => {
    if (!selectedId) return;
    setReindexing(true);
    try {
      const result = await api<{ queued: number }>(
        `/api/knowledge-bases/${selectedId}/reindex`,
        { method: 'POST' },
      );
      toast.success(`已提交 ${result.queued} 篇文档重建索引`);
      void queryClient.invalidateQueries({
        queryKey: ['knowledge-base', selectedId],
      });
      void queryClient.invalidateQueries({ queryKey: ['embedding-config'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '重建索引失败');
    } finally {
      setReindexing(false);
    }
  };

  const search = async () => {
    if (!selectedId || !query.trim()) return;
    setSearching(true);
    try {
      const result = await api<SearchResponse>(
        `/api/knowledge-bases/${selectedId}/search?q=${encodeURIComponent(query)}`,
      );
      setSearchResult(result);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '检索失败');
    } finally {
      setSearching(false);
    }
  };

  const openConfig = () => {
    if (config) {
      setBackend(config.backend);
      setProviderId(config.providerId);
      setEmbeddingModel(
        config.backend === 'local'
          ? 'text-embedding-3-small'
          : config.model || 'text-embedding-3-small',
      );
      setDimensions(String(config.dimensions));
      setTopK(String(config.topK));
      setMinScore(String(config.minScore));
      setTestResult(null);
    }
    setConfigOpen(true);
  };

  const configPayload = () => ({
    backend,
    providerId: backend === 'openai' ? providerId : '',
    model: backend === 'openai' ? embeddingModel : 'astra-hash-1536',
    dimensions: Number(dimensions),
    topK: Number(topK),
    minScore: Number(minScore),
  });

  const testConfig = async () => {
    if (backend === 'openai' && !providerId) {
      toast.error('请选择一个 OpenAI 兼容供应商');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api<{
        dimensions: number;
        latencyMs: number;
        model: string;
        sample: string;
      }>('/api/embeddings/test', {
        method: 'POST',
        body: JSON.stringify(configPayload()),
      });
      setTestResult(result);
      toast.success(`向量服务连接成功 · ${result.dimensions} 维`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '连接测试失败');
    } finally {
      setTesting(false);
    }
  };

  const saveConfig = async () => {
    if (backend === 'openai' && !providerId) {
      toast.error('请选择一个 OpenAI 兼容供应商');
      return;
    }
    const dims = Number(dimensions);
    if (!Number.isFinite(dims) || dims < 128 || dims > 3072) {
      toast.error('向量维度需要在 128–3072 之间');
      return;
    }
    setSavingConfig(true);
    try {
      await api('/api/embeddings/config', {
        method: 'PATCH',
        body: JSON.stringify(configPayload()),
      });
      setConfigOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['embedding-config'] });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-base'] });
      toast.success('向量检索配置已保存，正在重建全部索引');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存配置失败');
    } finally {
      setSavingConfig(false);
    }
  };

  const processing = detail?.documents.some((doc) => doc.status === 'processing');

  return (
    <div className="page">
      <PageHeader
        eyebrow="KNOWLEDGE · VECTOR RAG"
        title="知识库"
        description="文档切片、语义向量与关键词混合检索。每次回答都能追溯到原始资料。"
        actions={
          canEdit ? (
            <>
              <Button
                variant="secondary"
                icon={<SlidersHorizontal size={15} />}
                onClick={openConfig}
              >
                检索配置
              </Button>
              <Button
                variant="primary"
                icon={<FolderPlus size={16} />}
                onClick={openCreateKb}
              >
                新建知识库
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="knowledge-stats">
        <span>
          <strong>{bases.length}</strong> 个知识库
        </span>
        <i />
        <span>
          <strong>{totalDocuments}</strong> 篇文档
        </span>
        <i />
        <span>
          <strong>{formatCompact(config?.indexedChunks ?? 0)}</strong> 个向量切片
        </span>
        <span
          className={cn(
            'vector-mode-pill',
            config?.backend === 'local' ? 'is-local' : 'is-semantic',
          )}
          title={
            config?.backend === 'local'
              ? '当前使用本地哈希向量，适合演示和离线开发'
              : '当前使用语义 Embedding 模型'
          }
        >
          <Database size={12} />
          {config?.vectorStore === 'pgvector' ? 'pgvector' : 'SQLite'} ·{' '}
          {config?.backend === 'local' ? '本地向量' : config?.model}
        </span>
      </div>

      {config?.backend === 'local' && canEdit && (
        <button className="rag-upgrade-banner" onClick={openConfig}>
          <span className="rag-upgrade-icon">
            <Zap size={16} />
          </span>
          <span>
            <strong>当前使用本地哈希向量（演示模式）</strong>
            <small>
              要获得真正的语义检索能力，请接入 OpenAI 兼容的 Embedding 模型。
            </small>
          </span>
          <span className="rag-upgrade-action">配置语义向量 →</span>
        </button>
      )}

      <div className="knowledge-layout">
        <aside className="kb-list-card">
          <div className="kb-list-head">
            <span>所有知识库</span>
            {canEdit && (
              <IconButton label="新建知识库" onClick={openCreateKb}>
                <Plus size={15} />
              </IconButton>
            )}
          </div>
          <div className="kb-list">
            {listQuery.isLoading &&
              [0, 1, 2].map((item) => (
                <Skeleton
                  key={item}
                  style={{ height: 72, borderRadius: 12, marginBottom: 6 }}
                />
              ))}
            {bases.map((kb) => (
              <button
                key={kb.id}
                className={cn('kb-item', selectedId === kb.id && 'is-active')}
                onClick={() => selectKb(kb.id)}
              >
                <span
                  className="kb-item-icon"
                  style={{
                    color: kb.color,
                    background: `${kb.color}12`,
                    borderColor: `${kb.color}2A`,
                  }}
                >
                  <BookOpenText size={17} />
                </span>
                <span className="kb-item-copy">
                  <strong>{kb.name}</strong>
                  <small>
                    {kb.documents} 篇 · {formatCompact(kb.chunks)} chunks
                  </small>
                </span>
              </button>
            ))}
            {!listQuery.isLoading && bases.length === 0 && (
              <div className="kb-list-empty">
                <BookOpenText size={22} />
                <span>还没有知识库</span>
                {canEdit && <button onClick={openCreateKb}>创建一个</button>}
              </div>
            )}
          </div>
        </aside>

        <section className="kb-detail">
          {!selectedId ? (
            <EmptyState
              icon={<BookOpenText size={30} />}
              title="选择一个知识库"
              description="从左侧选择，或创建一个新的知识库来沉淀团队资料。"
            />
          ) : detailQuery.isLoading ? (
            <div className="kb-detail-loading">
              <Skeleton style={{ width: 260, height: 30 }} />
              <Skeleton style={{ width: 480, height: 16 }} />
              <Skeleton style={{ height: 220, borderRadius: 16 }} />
            </div>
          ) : detail ? (
            <>
              <div className="kb-detail-head">
                <div>
                  <div className="kb-detail-title">
                    <span style={{ background: detail.color }} />
                    <h2>{detail.name}</h2>
                    <Badge tone="neutral">{detail.documents.length} 篇文档</Badge>
                  </div>
                  <p>{detail.description || '还没有填写知识库描述'}</p>
                  <div className="kb-detail-meta">
                    <span>{formatCompact(detail.tokens)} tokens</span>
                    <span>{formatCompact(detail.chunks)} 个向量切片</span>
                    <span>{detail.assistants} 个助手正在使用</span>
                    <span>更新于 {formatDateTime(detail.updatedAt)}</span>
                  </div>
                </div>
                {canEdit && (
                  <div className="kb-detail-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={
                        <RefreshCw
                          size={14}
                          className={reindexing ? 'spin' : undefined}
                        />
                      }
                      loading={reindexing}
                      onClick={() => void reindex()}
                    >
                      重建索引
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Pencil size={14} />}
                      onClick={() => openEditKb(detail)}
                    >
                      编辑
                    </Button>
                    <IconButton
                      label="删除知识库"
                      className="danger-hover"
                      onClick={() => void deleteKb(detail)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                )}
              </div>

              <div className="kb-tabs">
                <Segmented
                  value={tab}
                  onChange={setTab}
                  options={[
                    {
                      label: '文档',
                      value: 'documents',
                      count: detail.documents.length,
                    },
                    { label: '混合检索测试', value: 'search' },
                  ]}
                />
                {tab === 'documents' && canEdit && (
                  <div className="kb-tab-actions">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".txt,.md,.markdown,text/plain,text/markdown"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void importFile(file);
                        event.target.value = '';
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Upload size={14} />}
                      onClick={() => fileRef.current?.click()}
                    >
                      导入文件
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Plus size={14} />}
                      onClick={openCreateDoc}
                    >
                      添加文档
                    </Button>
                  </div>
                )}
              </div>

              {processing && (
                <div className="indexing-banner">
                  <Loader2 size={14} className="spin" />
                  正在为文档建立向量索引，完成后即可参与语义检索
                </div>
              )}

              {tab === 'documents' ? (
                <div className="doc-list">
                  {detail.documents.length === 0 ? (
                    <EmptyState
                      icon={<FileText size={26} />}
                      title="知识库还是空的"
                      description="添加产品文档、FAQ 或品牌规范，系统会自动切片并建立向量索引。"
                      action={
                        canEdit ? (
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<Plus size={14} />}
                            onClick={openCreateDoc}
                          >
                            添加第一篇文档
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    detail.documents.map((doc) => (
                      <div key={doc.id} className="doc-row">
                        <span className="doc-icon">
                          <FileText size={18} />
                        </span>
                        <div className="doc-copy">
                          <strong>{doc.title}</strong>
                          <p>
                            {doc.content.slice(0, 120)}
                            {doc.content.length > 120 ? '…' : ''}
                          </p>
                          <div className="doc-meta">
                            <span>{formatCompact(doc.tokens)} tokens</span>
                            <span>{formatDateTime(doc.updatedAt)}</span>
                            {doc.status === 'processing' ? (
                              <Badge tone="amber">
                                <Loader2 size={10} className="spin" />
                                索引中
                              </Badge>
                            ) : doc.status === 'error' ? (
                              <Badge tone="rose">
                                <AlertTriangle size={10} />
                                索引失败
                              </Badge>
                            ) : (
                              <Badge tone="mint" dot>
                                已索引 · {doc.chunkCount} chunks
                              </Badge>
                            )}
                          </div>
                          {doc.status === 'error' && doc.indexError && (
                            <div className="doc-index-error" title={doc.indexError}>
                              {doc.indexError}
                            </div>
                          )}
                        </div>
                        {canEdit && (
                          <div className="doc-actions">
                            <IconButton
                              label="编辑文档"
                              onClick={() => openEditDoc(doc)}
                            >
                              <Pencil size={14} />
                            </IconButton>
                            <IconButton
                              label="删除文档"
                              className="danger-hover"
                              onClick={() => void deleteDoc(doc)}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="retrieval-panel">
                  <div className="retrieval-intro">
                    <div className="retrieval-icon">
                      <Search size={19} />
                    </div>
                    <div>
                      <h3>混合检索测试</h3>
                      <p>
                        向量语义召回 + 关键词精确匹配，展示最终融合分数与两路原始分数。
                        结果会按文档去重，避免同一篇文档占满上下文。
                      </p>
                    </div>
                  </div>
                  <div className="retrieval-search">
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void search();
                      }}
                      placeholder="例如：企业版如何保障 API Key 安全？"
                    />
                    <Button
                      variant="primary"
                      loading={searching}
                      icon={<Sparkles size={14} />}
                      onClick={() => void search()}
                    >
                      检索
                    </Button>
                  </div>

                  {searchResult?.warning && (
                    <div className="inline-warning">
                      <AlertTriangle size={14} />
                      {searchResult.warning}
                    </div>
                  )}

                  {searchResult && (
                    <div className="retrieval-results">
                      <div className="retrieval-result-head">
                        <span>
                          命中 {searchResult.citations.length} 个片段 ·{' '}
                          {searchResult.mode === 'hybrid'
                            ? '混合检索'
                            : '关键词降级'}
                        </span>
                        <span>{searchResult.latencyMs}ms</span>
                      </div>
                      {searchResult.chunks.length === 0 ? (
                        <div className="retrieval-empty">
                          没有达到相关度阈值的片段。尝试换一个问法，或补充文档后重建索引。
                        </div>
                      ) : (
                        searchResult.chunks.map((chunk, index) => (
                          <div key={chunk.id} className="chunk-card">
                            <div className="chunk-head">
                              <span className="chunk-index">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              <strong>{chunk.title}</strong>
                              <span className="chunk-scores">
                                <Badge tone="mint">
                                  {Math.round(chunk.score * 100)}%
                                </Badge>
                                <span>V {Math.round(chunk.vectorScore * 100)}</span>
                                <span>K {Math.round(chunk.keywordScore * 100)}</span>
                              </span>
                            </div>
                            <p>{chunk.content}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={<BookOpenText size={30} />}
              title="知识库加载失败"
              description="请刷新页面后重试。"
            />
          )}
        </section>
      </div>

      <Modal
        open={kbModal}
        onClose={() => setKbModal(false)}
        title={editingKb ? '编辑知识库' : '新建知识库'}
        description="用清晰的主题组织资料，方便助手在正确的时候找到它。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setKbModal(false)}>
              取消
            </Button>
            <Button variant="primary" loading={savingKb} onClick={() => void saveKb()}>
              {editingKb ? '保存修改' : '创建知识库'}
            </Button>
          </>
        }
      >
        <div className="form-stack">
          <Field label="知识库名称" required>
            <Input
              value={kbName}
              onChange={(event) => setKbName(event.target.value)}
              placeholder="例如：产品知识库"
              maxLength={40}
            />
          </Field>
          <Field label="描述" hint="说明这个知识库覆盖哪些内容。">
            <Textarea
              value={kbDescription}
              onChange={(event) => setKbDescription(event.target.value)}
              rows={3}
              placeholder="产品能力、版本差异与客户常见问题"
              maxLength={160}
            />
          </Field>
          <Field label="标识色">
            <div className="color-picker">
              {colorOptions.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={cn(
                    'color-option',
                    kbColor === color && 'is-active',
                  )}
                  style={{ background: color }}
                  onClick={() => setKbColor(color)}
                  aria-label={color}
                >
                  {kbColor === color && <span />}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Modal>

      <Modal
        open={docModal}
        onClose={() => setDocModal(false)}
        title={editingDoc ? '编辑文档' : '添加文档'}
        description="发布后会自动切片并建立向量索引，通常需要几秒钟。"
        size="lg"
        footer={
          <>
            <span className="modal-foot-note">
              {docContent.length.toLocaleString()} 字符
            </span>
            <Button variant="ghost" onClick={() => setDocModal(false)}>
              取消
            </Button>
            <Button variant="primary" loading={savingDoc} onClick={() => void saveDoc()}>
              {editingDoc ? '保存并重建索引' : '添加并建立索引'}
            </Button>
          </>
        }
      >
        <div className="form-stack">
          <Field label="文档标题" required>
            <Input
              value={docTitle}
              onChange={(event) => setDocTitle(event.target.value)}
              placeholder="例如：企业版数据安全说明"
              maxLength={120}
            />
          </Field>
          <Field
            label="正文内容"
            required
            hint="支持 Markdown 标题，系统会按标题层级与段落切成 900 字以内的语义块。"
          >
            <Textarea
              value={docContent}
              onChange={(event) => setDocContent(event.target.value)}
              rows={16}
              placeholder="粘贴文档内容，或从本地导入 .md / .txt 文件…"
              className="doc-textarea"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        title="向量检索配置"
        description="配置 Embedding 模型与混合检索参数。保存后会重建全部文档索引。"
        size="lg"
        footer={
          <>
            <Button
              variant="ghost"
              loading={testing}
              icon={<Gauge size={15} />}
              onClick={() => void testConfig()}
            >
              测试连接
            </Button>
            <Button
              variant="primary"
              loading={savingConfig}
              onClick={() => void saveConfig()}
            >
              保存并重建索引
            </Button>
          </>
        }
      >
        <div className="form-stack">
          <div className="rag-config-status">
            <div>
              <span className="rag-config-status-icon">
                <Database size={18} />
              </span>
              <div>
                <strong>
                  {config?.vectorStore === 'pgvector'
                    ? 'PostgreSQL + pgvector'
                    : 'SQLite 本地向量存储'}
                </strong>
                <small>
                  {formatCompact(config?.indexedChunks ?? 0)} 个切片 ·{' '}
                  {config?.readyDocuments ?? 0} 篇已就绪
                  {config?.processingDocuments
                    ? ` · ${config.processingDocuments} 篇索引中`
                    : ''}
                  {config?.errorDocuments
                    ? ` · ${config.errorDocuments} 篇失败`
                    : ''}
                </small>
              </div>
            </div>
            <Badge tone={config?.backend === 'local' ? 'amber' : 'mint'} dot>
              {config?.backend === 'local' ? '演示模式' : '语义检索'}
            </Badge>
          </div>

          {config?.vectorError && (
            <div className="inline-warning">
              <AlertTriangle size={14} />
              向量存储异常：{config.vectorError}
            </div>
          )}

          {(config?.errorDocuments ?? 0) > 0 && (
            <div className="inline-warning">
              <AlertTriangle size={14} />
              有 {config?.errorDocuments} 篇文档索引失败。请在文档列表中查看错误，
              修正 Embedding 配置后点击「重建索引」。
            </div>
          )}

          <Field label="向量化方式">
            <div className="kind-picker">
              <button
                type="button"
                className={cn('kind-option', backend === 'local' && 'is-active')}
                onClick={() => setBackend('local')}
              >
                <Zap size={19} />
                <span>
                  <strong>本地哈希向量</strong>
                  <small>零配置 · 仅适合演示/离线</small>
                </span>
              </button>
              <button
                type="button"
                className={cn('kind-option', backend === 'openai' && 'is-active')}
                onClick={() => setBackend('openai')}
              >
                <Sparkles size={19} />
                <span>
                  <strong>语义 Embedding</strong>
                  <small>OpenAI 兼容 · 生产推荐</small>
                </span>
              </button>
            </div>
          </Field>

          {backend === 'openai' && (
            <>
              <div className="form-grid-2">
                <Field label="Embedding 供应商" required>
                  <Select
                    value={providerId}
                    onChange={(event) => {
                      setProviderId(event.target.value);
                    }}
                  >
                    <option value="">选择 OpenAI 兼容供应商</option>
                    {semanticProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                        {provider.hasKey ? '' : '（缺少密钥）'}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Embedding 模型" required>
                  <Input
                    value={embeddingModel}
                    onChange={(event) => setEmbeddingModel(event.target.value)}
                    placeholder="text-embedding-3-small"
                    list="embedding-presets"
                  />
                  <datalist id="embedding-presets">
                    {embeddingPresets.map((preset) => (
                      <option key={preset} value={preset} />
                    ))}
                  </datalist>
                </Field>
              </div>
              {semanticProviders.length === 0 && (
                <div className="inline-warning">
                  <AlertTriangle size={14} />
                  还没有 OpenAI 兼容供应商。请先到「模型供应商」接入并配置 API Key。
                </div>
              )}
              <div className="inline-info">
                <CheckCircle2 size={14} />
                请确认供应商的 Base URL 支持 <code>/embeddings</code> 接口，例如
                OpenAI、DeepSeek 兼容网关、vLLM 或 TEI 网关。
              </div>
            </>
          )}

          {backend === 'local' && (
            <div className="inline-warning">
              <AlertTriangle size={14} />
              本地模式使用字符 n-gram 特征哈希，不是语义模型。适合演示与离线开发，
              生产环境请切换到语义 Embedding。
            </div>
          )}

          <div className="form-grid-2">
            <Field
              label="向量维度"
              hint="必须与模型输出维度一致。修改后会清空旧向量并重建。"
            >
              <Input
                type="number"
                min={128}
                max={3072}
                step={1}
                value={dimensions}
                onChange={(event) => setDimensions(event.target.value)}
              />
            </Field>
            <Field label="召回数量 Top K" hint="每次对话注入的最大片段数。">
              <Select
                value={topK}
                onChange={(event) => setTopK(event.target.value)}
              >
                {[3, 4, 5, 6, 8, 10, 12].map((value) => (
                  <option key={value} value={value}>
                    {value} 个片段
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label={`最低相关度 ${Number(minScore).toFixed(2)}`}
            hint="低于阈值的片段不会进入上下文，可减少无关资料干扰。"
          >
            <input
              type="range"
              className="range"
              min={0}
              max={0.6}
              step={0.01}
              value={minScore}
              onChange={(event) => setMinScore(event.target.value)}
            />
          </Field>

          <div className="rag-config-note">
            <Settings2 size={15} />
            <span>
              建议从 Top K = 5、相关度阈值 0.12 开始，根据真实问答效果调整。
              生产环境推荐 <code>text-embedding-3-small</code>、{' '}
              <code>bge-m3</code> 或企业自建 Embedding 服务。
            </span>
          </div>

          {testResult && (
            <div className="test-result">
              <CheckCircle2 size={16} />
              <div>
                <strong>连接成功 · {testResult.dimensions} 维</strong>
                <span>
                  {testResult.model} · {testResult.latencyMs}ms ·{' '}
                  {testResult.sample}
                </span>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
