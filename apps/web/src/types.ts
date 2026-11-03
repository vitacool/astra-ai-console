export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarColor: string;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface Provider {
  id: string;
  name: string;
  kind: 'mock' | 'openai';
  baseUrl: string;
  hasKey: boolean;
  maskedKey: string;
  defaultModel: string;
  models: string[];
  status: 'active' | 'inactive' | 'error';
  lastCheckedAt: string | null;
  assistants?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Assistant {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId: string | null;
  providerName: string | null;
  providerKind: string | null;
  providerStatus: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  icon: string;
  color: string;
  knowledgeBaseId: string | null;
  knowledgeBaseName: string | null;
  status: 'active' | 'draft';
  creatorName: string | null;
  conversations: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  color: string;
  documents: number;
  tokens: number;
  chunks: number;
  assistants: number;
  createdAt: string;
  updatedAt: string;
}

export interface KBDocument {
  id: string;
  kbId: string;
  title: string;
  content: string;
  tokens: number;
  status: 'ready' | 'processing' | 'error';
  chunkCount: number;
  indexError: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDetail extends Omit<KnowledgeBase, 'documents'> {
  documents: KBDocument[];
}

export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  kbId: string;
  title: string;
  snippet: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
  chunkIndex: number;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  content: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface SearchResponse {
  query: string;
  chunks: RetrievedChunk[];
  citations: Citation[];
  mode: 'hybrid' | 'keyword';
  latencyMs: number;
  warning?: string;
}

export interface EmbeddingConfig {
  backend: 'local' | 'openai';
  providerId: string;
  providerName: string;
  model: string;
  dimensions: number;
  topK: number;
  minScore: number;
  vectorStore: 'sqlite' | 'pgvector';
  indexedChunks: number;
  readyDocuments: number;
  processingDocuments: number;
  errorDocuments: number;
  jobs: { pending: number; running: number; failed: number };
  vectorError: string;
  mode: string;
}

export interface ConversationListItem {
  id: string;
  assistantId: string;
  assistantName: string;
  assistantColor: string;
  assistantIcon: string;
  title: string;
  pinned: boolean;
  messageCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens: number;
  latency: number;
  createdAt: string;
  citations?: Citation[];
  pending?: boolean;
  error?: boolean;
}

export interface ConversationDetail {
  id: string;
  title: string;
  pinned: boolean;
  assistant: {
    id: string;
    name: string;
    description: string;
    color: string;
    icon: string;
    model: string;
    providerName: string;
    knowledgeBaseName: string | null;
  } | null;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardData {
  summary: {
    tokens: number;
    tokensDelta: number;
    requests: number;
    requestsDelta: number;
    successRate: number;
    successRateDelta: number;
    avgLatency: number;
    latencyDelta: number;
    activeAssistants: number;
    totalAssistants: number;
    conversations: number;
  };
  budget: { limit: number; used: number; percent: number };
  series: Array<{ date: string; requests: number; tokens: number }>;
  assistants: Array<{
    id: string;
    name: string;
    color: string;
    icon: string;
    requests: number;
    tokens: number;
  }>;
  models: Array<{
    name: string;
    requests: number;
    tokens: number;
    percent: number;
  }>;
  recent: Array<{
    id: string;
    model: string;
    tokens: number;
    status: string;
    latency: number;
    createdAt: string;
    assistantName: string | null;
    assistantColor: string | null;
    userName: string | null;
    userColor: string | null;
  }>;
  providers: Array<{
    id: string;
    name: string;
    kind: string;
    status: string;
    defaultModel: string;
    lastCheckedAt: string | null;
    assistants: number;
  }>;
}

export interface UsageLog {
  id: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latency: number;
  status: string;
  source: string;
  createdAt: string;
  assistantName: string | null;
  assistantColor: string | null;
  userName: string | null;
  userColor: string | null;
  providerName: string | null;
}

export interface UsageData {
  summary: {
    requests: number;
    tokens: number;
    successRate: number;
    avgLatency: number;
    errors: number;
  };
  series: Array<{ date: string; requests: number; tokens: number }>;
  assistants: Array<{
    id: string | null;
    name: string;
    color: string;
    requests: number;
    tokens: number;
  }>;
  models: Array<{ name: string; requests: number; tokens: number }>;
  members: Array<{
    id: string | null;
    name: string;
    color: string;
    requests: number;
    tokens: number;
  }>;
  logs: UsageLog[];
  pagination: Pagination;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  avatarColor: string;
  conversations: number;
  tokens: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: string;
  ip: string;
  createdAt: string;
  actorName: string;
  actorColor: string;
}

export interface SettingsData {
  workspaceName: string;
  tokenBudget: number;
  plan: string;
  timezone: string;
  retentionDays: number;
  defaultAssistant: string | null;
  system: {
    version: string;
    node: string;
    database: string;
    databaseSize: number;
    environment: string;
    counts: {
      users: number;
      assistants: number;
      conversations: number;
      documents: number;
    };
  };
}

export interface DashboardProvider {
  id: string;
  name: string;
  kind: string;
  status: string;
  defaultModel: string;
  lastCheckedAt: string | null;
  assistants: number;
}
