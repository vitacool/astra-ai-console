import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  BookOpenText,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  History,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { api, ApiError, streamMessage } from '../lib/api';
import type {
  Assistant,
  ChatMessage,
  ConversationDetail,
  ConversationListItem,
  SettingsData,
} from '../types';
import { formatNumber, cn, relativeTime } from '../lib/utils';
import { getAssistantIcon } from '../lib/icons';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Avatar } from '../components/Avatar';
import { Button, EmptyState, IconButton, Skeleton, Spinner } from '../components/ui';

function suggestionsFor(assistant?: { name: string }): string[] {
  if (!assistant) return [];
  const name = assistant.name;
  if (/文案|品牌|策划/.test(name)) {
    return [
      '为新品发布写一段 120 字以内的开场文案',
      '把这段产品介绍改写得更有画面感',
      '给官网首屏拟 3 个不同语气的标题',
    ];
  }
  if (/数据|分析/.test(name)) {
    return [
      '帮我拆解本月留存下降的可能原因',
      '设计一套衡量 AI 功能价值的指标体系',
      '把这份周报改写成管理层摘要',
    ];
  }
  if (/客服|支持|成功/.test(name)) {
    return [
      '企业版如何保障 API Key 与数据安全？',
      '客户担心数据被用于模型训练，怎么解释？',
      '整理一份新客户上手指引',
    ];
  }
  if (/代码|工程|审查/.test(name)) {
    return [
      '审查一个登录接口的边界条件与安全风险',
      '如何为流式接口设计可靠的错误重试？',
      '帮我优化这段查询的性能',
    ];
  }
  return [
    '帮我梳理一个可执行的工作计划',
    '把这段复杂说明解释得更清楚',
    '给我三个不同角度的建议',
  ];
}

function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function ChatPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeId, setActiveId] = useState<string | null>(
    searchParams.get('c'),
  );
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>(
    searchParams.get('assistant') || '',
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [title, setTitle] = useState('新对话');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [assistantMenu, setAssistantMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const skipLoadRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const assistantMenuRef = useRef<HTMLDivElement>(null);

  const assistantsQuery = useQuery({
    queryKey: ['assistants'],
    queryFn: () => api<Assistant[]>('/api/assistants'),
  });
  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<ConversationListItem[]>('/api/conversations'),
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsData>('/api/settings'),
    staleTime: 60_000,
  });

  const assistants = assistantsQuery.data ?? [];
  const selectedAssistant =
    assistants.find((item) => item.id === selectedAssistantId) ??
    assistants[0];

  useEffect(() => {
    if (!selectedAssistantId && assistants.length > 0) {
      const preferred = settingsQuery.data?.defaultAssistant;
      const found = assistants.find((item) => item.id === preferred);
      setSelectedAssistantId(found?.id ?? assistants[0].id);
    }
  }, [assistants, selectedAssistantId, settingsQuery.data?.defaultAssistant]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setDetail(null);
      setTitle('新对话');
      return;
    }
    if (skipLoadRef.current === activeId) {
      skipLoadRef.current = null;
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setError('');
    api<ConversationDetail>(`/api/conversations/${activeId}`)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setMessages(data.messages);
        setTitle(data.title);
        if (data.assistant) setSelectedAssistantId(data.assistant.id);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '对话加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    const handle = (event: MouseEvent) => {
      if (
        assistantMenuRef.current &&
        !assistantMenuRef.current.contains(event.target as Node)
      ) {
        setAssistantMenu(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streamText, loadingDetail]);

  const filteredConversations = useMemo(() => {
    const list = conversationsQuery.data ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.assistantName.toLowerCase().includes(q),
    );
  }, [conversationsQuery.data, search]);

  const headerAssistant = detail?.assistant ?? selectedAssistant;

  const resetDraft = () => {
    if (streaming) {
      abortRef.current?.abort();
      setStreaming(false);
      setStreamText('');
    }
    setActiveId(null);
    setDetail(null);
    setMessages([]);
    setTitle('新对话');
    setError('');
    setSearchParams({}, { replace: true });
    setHistoryOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 60);
  };

  const selectConversation = (id: string) => {
    if (streaming) {
      abortRef.current?.abort();
      setStreaming(false);
      setStreamText('');
    }
    setActiveId(id);
    setSearchParams({ c: id }, { replace: true });
    setHistoryOpen(false);
    setError('');
  };

  const selectAssistant = (assistant: Assistant) => {
    setAssistantMenu(false);
    setSelectedAssistantId(assistant.id);
    if (activeId) {
      resetDraft();
    }
  };

  const createConversation = async (): Promise<string | null> => {
    if (!selectedAssistant) {
      toast.error('请先创建一个 AI 助手');
      return null;
    }
    const conversation = await api<ConversationListItem>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ assistantId: selectedAssistant.id }),
    });
    skipLoadRef.current = conversation.id;
    setActiveId(conversation.id);
    setSearchParams({ c: conversation.id }, { replace: true });
    setMessages([]);
    setDetail(null);
    setTitle(conversation.title);
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    return conversation.id;
  };

  const send = async (preset?: string) => {
    const content = (preset ?? input).trim();
    if (!content || streaming) return;
    if (!selectedAssistant) {
      toast.error('请先创建一个 AI 助手');
      return;
    }

    setError('');
    let conversationId = activeId;
    try {
      if (!conversationId) {
        conversationId = await createConversation();
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建对话失败');
      return;
    }
    if (!conversationId) return;

    const userTempId = `local-user-${Date.now()}`;
    const assistantTempId = 'streaming-assistant';
    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      {
        id: userTempId,
        role: 'user',
        content,
        tokens: 0,
        latency: 0,
        createdAt: now,
      },
      {
        id: assistantTempId,
        role: 'assistant',
        content: '',
        tokens: 0,
        latency: 0,
        createdAt: now,
        pending: true,
      },
    ]);
    setInput('');
    setStreaming(true);
    setStreamText('');
    setHistoryOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const controller = new AbortController();
    abortRef.current = controller;
    let received = false;

    try {
      await streamMessage(
        conversationId,
        content,
        {
          onMeta: (meta) => {
            received = true;
            setTitle(meta.title);
            setMessages((current) =>
              current.map((message) =>
                message.id === userTempId
                  ? { ...message, id: meta.userMessage.id }
                  : message,
              ),
            );
          },
          onToken: (delta) => {
            received = true;
            setStreamText((current) => current + delta);
          },
          onDone: (payload) => {
            received = true;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantTempId
                  ? {
                      id: payload.message.id,
                      role: 'assistant',
                      content: payload.message.content,
                      tokens: payload.message.tokens,
                      latency: payload.message.latency,
                      citations: payload.message.citations ?? [],
                      createdAt: payload.message.createdAt,
                    }
                  : message,
              ),
            );
            setStreamText('');
            setTitle(payload.title);
            void queryClient.invalidateQueries({ queryKey: ['conversations'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            void queryClient.invalidateQueries({ queryKey: ['usage'] });
          },
          onError: (payload) => {
            setError(payload.message);
            if (payload.partial) {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantTempId
                    ? {
                        id: payload.partial!.id,
                        role: 'assistant',
                        content: payload.partial!.content,
                        tokens: payload.partial!.tokens,
                        latency: payload.partial!.latency,
                        citations: payload.partial!.citations ?? [],
                        createdAt: payload.partial!.createdAt,
                        error: true,
                      }
                    : message,
                ),
              );
            } else {
              setMessages((current) =>
                current.filter((message) => message.id !== assistantTempId),
              );
            }
          },
        },
        controller.signal,
      );
      if (!received && !controller.signal.aborted) {
        setError('连接已断开，请重试');
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof ApiError ? err.message : '消息发送失败');
        setMessages((current) =>
          current.filter(
            (message) =>
              message.id !== assistantTempId &&
              (!received || message.id !== userTempId),
          ),
        );
        if (!received) setInput(content);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
      setStreamText('');
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    const conversationId = activeId;
    setStreaming(false);
    setError('已停止生成');
    setStreamText('');
    if (conversationId) {
      window.setTimeout(() => {
        api<ConversationDetail>(`/api/conversations/${conversationId}`)
          .then((data) => setMessages(data.messages))
          .catch(() => undefined);
      }, 700);
    }
  };

  const pinConversation = async (
    item: ConversationListItem,
    event: React.MouseEvent,
  ) => {
    event.stopPropagation();
    try {
      await api(`/api/conversations/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !item.pinned }),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    }
  };

  const deleteConversation = async (
    item: ConversationListItem,
    event: React.MouseEvent,
  ) => {
    event.stopPropagation();
    const ok = await confirm({
      title: '删除这条对话？',
      description: `「${item.title}」及其消息将被永久删除，此操作无法撤销。`,
      confirmText: '删除对话',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/conversations/${item.id}`, { method: 'DELETE' });
      if (activeId === item.id) {
        setActiveId(null);
        setMessages([]);
        setDetail(null);
        setSearchParams({}, { replace: true });
      }
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('对话已删除');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败');
    }
  };

  const copy = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      toast.error('复制失败，请手动选择文本');
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const resize = () => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(180, node.scrollHeight)}px`;
  };

  const suggestions = suggestionsFor(headerAssistant);
  const showEmpty = !loadingDetail && messages.length === 0;

  return (
    <div className="chat-page">
      <aside className={cn('chat-history', historyOpen && 'is-open')}>
        <div className="chat-history-head">
          <div>
            <span className="eyebrow">CONVERSATIONS</span>
            <h2>对话</h2>
          </div>
          <div className="chat-history-actions">
            <IconButton label="新对话" onClick={resetDraft}>
              <MessageSquarePlus size={17} />
            </IconButton>
            <button
              className="chat-history-mobile-close"
              onClick={() => setHistoryOpen(false)}
              aria-label="关闭"
            >
              <X size={17} />
            </button>
          </div>
        </div>
        <div className="history-search">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索对话"
          />
        </div>
        <div className="history-list">
          {conversationsQuery.isLoading &&
            [0, 1, 2, 3].map((item) => (
              <Skeleton
                key={item}
                style={{ height: 68, borderRadius: 12, marginBottom: 6 }}
              />
            ))}
          {!conversationsQuery.isLoading &&
            filteredConversations.map((item) => (
              <button
                key={item.id}
                className={cn(
                  'history-item',
                  activeId === item.id && 'is-active',
                )}
                onClick={() => selectConversation(item.id)}
              >
                <span
                  className="history-icon"
                  style={{ color: item.assistantColor }}
                >
                  {(() => {
                    const Icon = getAssistantIcon(item.assistantIcon);
                    return <Icon size={15} />;
                  })()}
                </span>
                <span className="history-copy">
                  <span className="history-title">
                    {item.pinned && <Pin size={11} className="pin-mark" />}
                    {item.title}
                  </span>
                  <span className="history-preview">
                    {item.preview || item.assistantName}
                  </span>
                </span>
                <span className="history-time">
                  {relativeTime(item.updatedAt)}
                </span>
                <span className="history-actions">
                  <i
                    role="button"
                    tabIndex={0}
                    title={item.pinned ? '取消置顶' : '置顶'}
                    onClick={(event) => void pinConversation(item, event)}
                    onKeyDown={() => undefined}
                  >
                    <Pin size={12} />
                  </i>
                  <i
                    role="button"
                    tabIndex={0}
                    title="删除"
                    onClick={(event) => void deleteConversation(item, event)}
                    onKeyDown={() => undefined}
                  >
                    <Trash2 size={12} />
                  </i>
                </span>
              </button>
            ))}
          {!conversationsQuery.isLoading &&
            filteredConversations.length === 0 && (
              <div className="history-empty">
                <History size={20} />
                <span>{search ? '没有匹配的对话' : '还没有对话记录'}</span>
                <small>从一个问题开始，让想法流动起来</small>
              </div>
            )}
        </div>
        <div className="history-foot">
          <span className="pulse-dot" />
          对话自动保存 · 按工作区隔离
        </div>
      </aside>

      <section className="chat-stage">
        <header className="chat-head">
          <div className="chat-head-left">
            <button
              className="chat-mobile-history"
              onClick={() => setHistoryOpen(true)}
              aria-label="对话记录"
            >
              <PanelLeftClose size={18} />
            </button>
            <div className="assistant-switch" ref={assistantMenuRef}>
              <button
                className="assistant-switch-btn"
                onClick={() => setAssistantMenu((value) => !value)}
              >
                {headerAssistant ? (
                  <>
                    <span
                      className="assistant-mini"
                      style={{
                        color: headerAssistant.color,
                        background: `${headerAssistant.color}16`,
                        borderColor: `${headerAssistant.color}30`,
                      }}
                    >
                      {(() => {
                        const Icon = getAssistantIcon(
                          'icon' in headerAssistant
                            ? headerAssistant.icon
                            : 'Sparkles',
                        );
                        return <Icon size={16} />;
                      })()}
                    </span>
                    <span className="assistant-switch-copy">
                      <strong>{headerAssistant.name}</strong>
                      <small>
                        {headerAssistant.model}
                        {'knowledgeBaseName' in headerAssistant &&
                          headerAssistant.knowledgeBaseName && (
                            <span className="kb-inline">
                              <BookOpenText size={10} />
                              {headerAssistant.knowledgeBaseName}
                            </span>
                          )}
                      </small>
                    </span>
                  </>
                ) : (
                  <span className="assistant-switch-copy">
                    <strong>选择助手</strong>
                    <small>开始新的对话</small>
                  </span>
                )}
                <ChevronDown size={14} />
              </button>
              {assistantMenu && (
                <div className="assistant-menu">
                  <div className="assistant-menu-head">选择 AI 助手</div>
                  {assistants.map((assistant) => {
                    const Icon = getAssistantIcon(assistant.icon);
                    return (
                      <button
                        key={assistant.id}
                        className={cn(
                          'assistant-menu-item',
                          assistant.id === headerAssistant?.id && 'is-active',
                        )}
                        onClick={() => selectAssistant(assistant)}
                      >
                        <span
                          className="assistant-mini"
                          style={{
                            color: assistant.color,
                            background: `${assistant.color}16`,
                            borderColor: `${assistant.color}30`,
                          }}
                        >
                          <Icon size={16} />
                        </span>
                        <span>
                          <strong>{assistant.name}</strong>
                          <small>{assistant.model}</small>
                        </span>
                        {assistant.id === headerAssistant?.id && (
                          <Check size={15} className="check-icon" />
                        )}
                      </button>
                    );
                  })}
                  {assistants.length === 0 && (
                    <div className="assistant-menu-empty">
                      还没有助手，请先到「AI 助手」创建。
                    </div>
                  )}
                </div>
              )}
            </div>
            <span className="chat-title-sep">/</span>
            <div className="chat-current-title" title={title}>
              {title}
            </div>
          </div>
          <div className="chat-head-right">
            <span className="chat-secure">
              <span className="pulse-dot" />
              流式响应
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus size={15} />}
              onClick={resetDraft}
            >
              新对话
            </Button>
          </div>
        </header>

        <div className="chat-scroll" ref={scrollRef}>
          {loadingDetail ? (
            <div className="chat-loading">
              <Skeleton style={{ width: 480, height: 18 }} />
              <Skeleton style={{ width: 640, height: 80 }} />
              <Skeleton style={{ width: 420, height: 18 }} />
            </div>
          ) : showEmpty ? (
            <div className="chat-empty">
              <div
                className="chat-empty-orb"
                style={{
                  color: headerAssistant?.color || 'var(--accent)',
                  borderColor: `${headerAssistant?.color || '#5EEAD4'}35`,
                  background: `${headerAssistant?.color || '#5EEAD4'}0D`,
                }}
              >
                <span className="orb-ring" />
                {headerAssistant ? (
                  (() => {
                    const Icon = getAssistantIcon(headerAssistant.icon);
                    return <Icon size={34} />;
                  })()
                ) : (
                  <Sparkles size={34} />
                )}
              </div>
              <div className="chat-empty-kicker">NEW CONVERSATION</div>
              <h1>
                和「{headerAssistant?.name || 'AI 助手'}」一起
                <br />
                把想法变成下一步。
              </h1>
              <p>
                {headerAssistant?.description ||
                  '选择一个助手，然后输入你的问题。所有对话都会自动保存。'}
              </p>
              {headerAssistant?.knowledgeBaseName && (
                <div className="chat-empty-kb">
                  <BookOpenText size={13} />
                  已连接知识库「{headerAssistant.knowledgeBaseName}」
                </div>
              )}
              <div className="suggestion-grid">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    className="suggestion"
                    onClick={() => void send(suggestion)}
                  >
                    <span className="suggestion-index">
                      0{index + 1}
                    </span>
                    <span>{suggestion}</span>
                    <ArrowUp size={15} className="suggestion-arrow" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => {
                const streamingHere =
                  streaming && message.id === 'streaming-assistant';
                const content = streamingHere
                  ? streamText
                  : message.content;
                if (message.role === 'user') {
                  return (
                    <div key={message.id} className="message message-user">
                      <div className="message-user-inner">
                        <div className="message-user-bubble">{content}</div>
                        <Avatar
                          name={user?.name || '我'}
                          color={user?.avatarColor}
                          size={30}
                        />
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={message.id}
                    className={cn(
                      'message message-assistant',
                      message.error && 'is-error',
                    )}
                  >
                    <div
                      className="message-avatar"
                      style={{
                        color: headerAssistant?.color || 'var(--accent)',
                        background: `${headerAssistant?.color || '#5EEAD4'}14`,
                        borderColor: `${headerAssistant?.color || '#5EEAD4'}30`,
                      }}
                    >
                      {headerAssistant ? (
                        (() => {
                          const Icon = getAssistantIcon(headerAssistant.icon);
                          return <Icon size={17} />;
                        })()
                      ) : (
                        <Sparkles size={17} />
                      )}
                    </div>
                    <div className="message-body">
                      <div className="message-meta">
                        <strong>{headerAssistant?.name || 'ASTRA'}</strong>
                        <span>{relativeTime(message.createdAt)}</span>
                        {message.error && (
                          <span className="message-error-tag">生成中断</span>
                        )}
                      </div>
                      {streamingHere && !content ? (
                        <div className="typing">
                          <span />
                          <span />
                          <span />
                          <small>正在思考</small>
                        </div>
                      ) : (
                        <Markdown content={content} />
                      )}
                      {streamingHere && content && (
                        <span className="stream-caret" />
                      )}
                      {!streamingHere && content && (
                        <div className="message-actions">
                          <button onClick={() => void copy(message)}>
                            {copiedId === message.id ? (
                              <Check size={13} />
                            ) : (
                              <Copy size={13} />
                            )}
                            {copiedId === message.id ? '已复制' : '复制'}
                          </button>
                          {message.tokens > 0 && (
                            <span>{formatNumber(message.tokens)} tokens</span>
                          )}
                          {message.latency > 0 && (
                            <span>
                              <Clock3 size={12} />
                              {(message.latency / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                      )}
                      {!streamingHere &&
                        message.citations &&
                        message.citations.length > 0 && (
                          <details className="message-citations">
                            <summary>
                              <BookOpenText size={13} />
                              引用 {message.citations.length} 条资料
                              <ChevronDown size={13} className="citation-chevron" />
                            </summary>
                            <div className="citation-list">
                              {message.citations.map((citation) => (
                                <button
                                  key={citation.chunkId}
                                  className="citation-card"
                                  onClick={() =>
                                    navigate(`/knowledge?kb=${citation.kbId}`)
                                  }
                                >
                                  <span className="citation-index">
                                    {String(citation.index).padStart(2, '0')}
                                  </span>
                                  <span className="citation-copy">
                                    <strong>{citation.title}</strong>
                                    <small>{citation.snippet}</small>
                                  </span>
                                  <span className="citation-score">
                                    {Math.round(citation.score * 100)}%
                                  </span>
                                </button>
                              ))}
                            </div>
                          </details>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="composer-zone">
          {error && (
            <div className="composer-error">
              <span>{error}</span>
              <button onClick={() => setError('')}>
                <X size={13} />
              </button>
            </div>
          )}
          <div className={cn('composer', streaming && 'is-streaming')}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                resize();
              }}
              onKeyDown={onComposerKeyDown}
              placeholder={
                headerAssistant
                  ? `给「${headerAssistant.name}」发送消息…`
                  : '选择一个助手开始对话…'
              }
              rows={1}
              disabled={!headerAssistant}
            />
            <div className="composer-bar">
              <div className="composer-context">
                {headerAssistant?.knowledgeBaseName ? (
                  <span className="composer-kb">
                    <BookOpenText size={12} />
                    {headerAssistant.knowledgeBaseName}
                  </span>
                ) : (
                  <span className="composer-model">
                    <span className="status-dot is-ok" />
                    {headerAssistant?.model || '未选择模型'}
                  </span>
                )}
                <span className="composer-hint">
                  Enter 发送 · Shift + Enter 换行
                </span>
              </div>
              <div className="composer-actions">
                <span className="char-count">{input.length}/12000</span>
                {streaming ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Square size={13} />}
                    onClick={stop}
                  >
                    停止
                  </Button>
                ) : (
                  <button
                    className="send-btn"
                    onClick={() => void send()}
                    disabled={!input.trim() || !headerAssistant}
                    aria-label="发送消息"
                  >
                    {assistantsQuery.isLoading ? (
                      <Spinner size={16} />
                    ) : (
                      <ArrowUp size={18} />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="composer-foot">
            内容由 AI 生成，请核查重要信息 · ASTRA 不会使用你的数据训练模型
          </div>
        </div>
      </section>
    </div>
  );
}
