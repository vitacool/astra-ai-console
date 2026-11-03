import type { ProviderRow, ChatMessage, ChatResult } from '../types.js';
import { ApiError } from './errors.js';
import { decryptSecret } from './crypto.js';
import { mockReply } from './mock-ai.js';
import { estimateTokens } from './tokens.js';

interface StreamOptions {
  provider: ProviderRow;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  assistantName: string;
  knowledge?: string;
  onToken: (delta: string) => void;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mockStream(options: StreamOptions): Promise<ChatResult> {
  const lastUser = [...options.messages].reverse().find((m) => m.role === 'user');
  const content = mockReply({
    assistantName: options.assistantName,
    userMessage: lastUser?.content ?? '',
    knowledge: options.knowledge,
  });

  const pieces = content.match(/[\s\S]{1,5}/g) ?? [content];
  for (const piece of pieces) {
    if (options.signal?.aborted) break;
    options.onToken(piece);
    await sleep(piece.includes('\n') ? 18 : 7);
  }
  if (options.signal?.aborted) {
    throw new ApiError(499, 'ABORTED', '生成已停止');
  }

  const promptTokens = options.messages.reduce(
    (total, message) => total + estimateTokens(message.content),
    0,
  );
  const completionTokens = estimateTokens(content);
  return {
    content,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new ApiError(400, 'PROVIDER_CONFIG', '供应商 Base URL 不能为空');
  }
  return trimmed;
}

async function openAiStream(options: StreamOptions): Promise<ChatResult> {
  const apiKey = decryptSecret(options.provider.api_key);
  if (!apiKey) {
    throw new ApiError(
      400,
      'PROVIDER_KEY_MISSING',
      '该供应商还没有配置 API Key，请先在「模型供应商」中补充',
    );
  }

  const url = `${normalizeBaseUrl(options.provider.base_url)}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(
      502,
      'PROVIDER_UNREACHABLE',
      controller.signal.aborted
        ? '模型服务响应超时，请稍后重试'
        : `无法连接模型服务：${error instanceof Error ? error.message : '未知错误'}`,
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(
      502,
      'PROVIDER_ERROR',
      `模型服务返回 ${response.status} ${response.statusText}`,
      body.slice(0, 500),
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content ?? '';
    if (content) options.onToken(content);
    const promptTokens =
      payload.usage?.prompt_tokens ??
      options.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const completionTokens =
      payload.usage?.completion_tokens ?? estimateTokens(content);
    return {
      content,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  if (!response.body) {
    throw new ApiError(502, 'PROVIDER_ERROR', '模型服务没有返回可读取的数据流');
  }

  let content = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let buffer = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const event = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
            };
          };
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            options.onToken(delta);
          }
          if (event.usage) {
            promptTokens = event.usage.prompt_tokens ?? promptTokens;
            completionTokens = event.usage.completion_tokens ?? completionTokens;
          }
        } catch {
          // Ignore keep-alive or provider-specific non-JSON frames.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!content.trim()) {
    throw new ApiError(502, 'PROVIDER_EMPTY', '模型没有返回内容，请检查模型名称');
  }
  if (options.signal?.aborted) {
    throw new ApiError(499, 'ABORTED', '生成已停止');
  }

  if (!promptTokens) {
    promptTokens = options.messages.reduce(
      (sum, message) => sum + estimateTokens(message.content),
      0,
    );
  }
  if (!completionTokens) completionTokens = estimateTokens(content);

  return {
    content,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

export async function streamChat(options: StreamOptions): Promise<ChatResult> {
  if (options.provider.kind === 'mock') {
    return mockStream(options);
  }
  return openAiStream(options);
}

export async function testProvider(
  provider: ProviderRow,
): Promise<{ ok: boolean; message: string; models?: string[] }> {
  if (provider.kind === 'mock') {
    return {
      ok: true,
      message: '内置模拟引擎运行正常，无需网络连接',
      models: JSON.parse(provider.models) as string[],
    };
  }

  const apiKey = decryptSecret(provider.api_key);
  if (!apiKey) {
    throw new ApiError(
      400,
      'PROVIDER_KEY_MISSING',
      '尚未配置 API Key，无法测试连接',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${normalizeBaseUrl(provider.base_url)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiError(
        502,
        'PROVIDER_ERROR',
        `连接失败：模型服务返回 ${response.status}`,
      );
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    const models = (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id))
      .slice(0, 30);
    return {
      ok: true,
      message: `连接成功，发现 ${models.length} 个可用模型`,
      models,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      'PROVIDER_UNREACHABLE',
      controller.signal.aborted
        ? '连接超时，请检查 Base URL 或网络'
        : `连接失败：${error instanceof Error ? error.message : '未知错误'}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
