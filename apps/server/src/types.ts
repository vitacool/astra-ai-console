export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarColor: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface ProviderRow {
  id: string;
  name: string;
  kind: 'mock' | 'openai';
  base_url: string;
  api_key: string;
  default_model: string;
  models: string;
  status: 'active' | 'inactive' | 'error';
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantRow {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  provider_id: string | null;
  model: string;
  temperature: number;
  max_tokens: number;
  icon: string;
  color: string;
  knowledge_base_id: string | null;
  status: 'active' | 'draft';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult extends UsageTotals {
  content: string;
}

export interface StreamHandlers {
  onToken: (delta: string) => void;
  signal?: AbortSignal;
}
