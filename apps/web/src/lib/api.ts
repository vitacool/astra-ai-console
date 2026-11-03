import type { Citation } from '../types';

const TOKEN_KEY = 'astra_token';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  Object.entries(authHeaders()).forEach(([key, value]) =>
    headers.set(key, value),
  );

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请检查服务是否已启动');
  }

  if (response.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event('astra:unauthorized'));
  }

  const isJson = (response.headers.get('content-type') || '').includes(
    'application/json',
  );
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code || 'REQUEST_FAILED',
      payload?.error?.message || `请求失败（${response.status}）`,
      payload?.error?.details,
    );
  }

  return payload?.data as T;
}

export interface StreamCallbacks {
  onMeta?: (payload: {
    userMessage: {
      id: string;
      role: 'user';
      content: string;
      tokens: number;
      latency: number;
      createdAt: string;
    };
    title: string;
  }) => void;
  onToken?: (delta: string) => void;
  onDone?: (payload: {
    message: {
      id: string;
      role: 'assistant';
      content: string;
      tokens: number;
      latency: number;
      citations?: Citation[];
      createdAt: string;
    };
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    title: string;
  }) => void;
  onError?: (payload: {
    code: string;
    message: string;
    partial?: {
      id: string;
      role: string;
      content: string;
      tokens: number;
      latency: number;
      citations?: Citation[];
      createdAt: string;
    } | null;
  }) => void;
}

export async function streamMessage(
  conversationId: string,
  content: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ content }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      error instanceof Error ? error.message : '网络连接失败',
    );
  }

  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    let code = 'REQUEST_FAILED';
    try {
      const payload = await response.json();
      message = payload?.error?.message || message;
      code = payload?.error?.code || code;
    } catch {
      // noop
    }
    if (response.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event('astra:unauthorized'));
    }
    throw new ApiError(response.status, code, message);
  }

  if (!response.body) {
    throw new ApiError(502, 'STREAM_EMPTY', '服务器没有返回数据流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block: string) => {
    const lines = block.split('\n');
    let event = 'message';
    const data: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join('\n'));
    } catch {
      return;
    }
    if (event === 'meta') callbacks.onMeta?.(payload as never);
    else if (event === 'token') {
      callbacks.onToken?.((payload as { delta: string }).delta);
    } else if (event === 'done') callbacks.onDone?.(payload as never);
    else if (event === 'error') callbacks.onError?.(payload as never);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) dispatch(block);
    }
    if (buffer.trim()) dispatch(buffer);
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  } finally {
    reader.releaseLock();
  }
}
