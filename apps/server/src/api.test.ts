import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;
let adminToken = '';
let memberToken = '';
let assistantId = '';
let conversationId = '';
let tempDir = '';

function sseEvents(text: string): string[] {
  return [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'astra-test-'));
  process.env.ASTRA_DATA_DIR = tempDir;
  process.env.JWT_SECRET = 'test-secret';
  const { createApp } = await import('./app.js');
  app = createApp();

  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@astra.local', password: 'Astra@2026' });
  adminToken = adminLogin.body.data.token;

  const memberLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'chen@astra.local', password: 'Astra@2026' });
  memberToken = memberLogin.body.data.token;
});

afterAll(async () => {
  const { closeDb } = await import('./db/index.js');
  const { stopIndexWorker } = await import('./lib/indexer.js');
  const { closeVectorStore } = await import('./vector/index.js');
  await stopIndexWorker();
  await closeVectorStore();
  closeDb();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDocumentReady(
  kbId: string,
  docId: string,
): Promise<{ status: string; chunkCount: number }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const detail = await request(app)
      .get(`/api/knowledge-bases/${kbId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const doc = detail.body.data.documents.find(
      (item: { id: string }) => item.id === docId,
    );
    if (doc && doc.status !== 'processing') {
      return { status: doc.status, chunkCount: doc.chunkCount };
    }
    await sleep(150);
  }
  return { status: 'timeout', chunkCount: 0 };
}

describe('ASTRA API', () => {
  it('exposes a health endpoint', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('rejects invalid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@astra.local', password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('logs in and returns the seeded workspace data', async () => {
    expect(adminToken).toBeTruthy();
    const dashboard = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.summary.requests).toBeGreaterThan(0);
    expect(dashboard.body.data.series).toHaveLength(30);
  });

  it('creates an assistant and returns it in the list', async () => {
    const providers = await request(app)
      .get('/api/providers')
      .set('Authorization', `Bearer ${adminToken}`);
    const mockProvider = providers.body.data.find(
      (provider: { kind: string }) => provider.kind === 'mock',
    );

    const created = await request(app)
      .post('/api/assistants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '测试助手',
        description: '集成测试创建',
        systemPrompt: '你是一个用于集成测试的助手，请简短回答。',
        providerId: mockProvider.id,
        model: 'astra-sim-1',
        temperature: 0.5,
        maxTokens: 512,
        icon: 'Bot',
        color: '#5EEAD4',
      });

    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('测试助手');
    assistantId = created.body.data.id;

    const list = await request(app)
      .get('/api/assistants')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      list.body.data.some((item: { id: string }) => item.id === assistantId),
    ).toBe(true);
  });

  it('creates a conversation and streams a mock reply', async () => {
    const conversation = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assistantId });
    expect(conversation.status).toBe(201);
    conversationId = conversation.body.data.id;

    const response = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: '请帮我分析一下留存下降的原因。' })
      .buffer(true)
      .parse((res, callback) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        res.on('end', () => callback(null, body));
      });

    expect(response.status).toBe(200);
    const events = sseEvents(response.body as string);
    expect(events).toContain('meta');
    expect(events).toContain('token');
    expect(events).toContain('done');

    const detail = await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.messages.length).toBe(2);
    expect(detail.body.data.messages[1].role).toBe('assistant');
  });

  it('creates a knowledge base and document, then retrieves a chunk', async () => {
    const kb = await request(app)
      .post('/api/knowledge-bases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '测试知识库', description: '测试', color: '#38BDF8' });
    expect(kb.status).toBe(201);

    const doc = await request(app)
      .post(`/api/knowledge-bases/${kb.body.data.id}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '退订政策',
        content:
          '客户可以在账单页面随时取消订阅，取消后服务将持续到当前计费周期结束。\n\n如需退款，请在购买后 7 天内联系客户成功团队。',
      });
    expect(doc.status).toBe(201);

    const ready = await waitForDocumentReady(kb.body.data.id, doc.body.data.id);
    expect(ready.status).toBe('ready');
    expect(ready.chunkCount).toBeGreaterThan(0);

    const search = await request(app)
      .get(`/api/knowledge-bases/${kb.body.data.id}/search?q=如何取消订阅`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(search.status).toBe(200);
    expect(search.body.data.chunks.length).toBeGreaterThan(0);
    expect(search.body.data.mode).toBe('hybrid');
    expect(search.body.data.chunks[0].vectorScore).toBeGreaterThanOrEqual(0);
    expect(search.body.data.citations[0].title).toContain('退订政策');
  });

  it('exposes local embedding config and enforces permissions', async () => {
    const config = await request(app)
      .get('/api/embeddings/config')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(config.status).toBe(200);
    expect(config.body.data.backend).toBe('local');
    expect(config.body.data.dimensions).toBe(1536);
    expect(config.body.data.vectorStore).toBe('sqlite');

    const forbidden = await request(app)
      .patch('/api/embeddings/config')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ backend: 'local' });
    expect(forbidden.status).toBe(403);
  });

  it('attaches citations when an assistant is bound to a knowledge base', async () => {
    const providers = await request(app)
      .get('/api/providers')
      .set('Authorization', `Bearer ${adminToken}`);
    const mockProvider = providers.body.data.find(
      (provider: { kind: string }) => provider.kind === 'mock',
    );
    const kb = await request(app)
      .post('/api/knowledge-bases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '引用测试库', color: '#34D399' });
    const doc = await request(app)
      .post(`/api/knowledge-bases/${kb.body.data.id}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '退款规则',
        content: '购买后 7 天内可以申请全额退款，超过 7 天不支持退款。',
      });
    await waitForDocumentReady(kb.body.data.id, doc.body.data.id);

    const assistant = await request(app)
      .post('/api/assistants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '引用测试助手',
        systemPrompt: '你是一个严谨的知识库问答助手，请根据资料回答。',
        providerId: mockProvider.id,
        model: 'astra-sim-1',
        knowledgeBaseId: kb.body.data.id,
        status: 'active',
      });
    expect(assistant.status).toBe(201);

    const conversation = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assistantId: assistant.body.data.id });
    const response = await request(app)
      .post(`/api/conversations/${conversation.body.data.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: '购买后多久可以退款？' })
      .buffer(true)
      .parse((res, callback) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        res.on('end', () => callback(null, body));
      });
    expect(response.status).toBe(200);

    const detail = await request(app)
      .get(`/api/conversations/${conversation.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const assistantMessage = detail.body.data.messages.find(
      (message: { role: string }) => message.role === 'assistant',
    );
    expect(assistantMessage.citations.length).toBeGreaterThan(0);
    expect(assistantMessage.citations[0].title).toContain('退款规则');
  });

  it('blocks members from admin-only endpoints', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('validates message payloads', async () => {
    const response = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: '   ' });
    expect(response.status).toBe(422);
  });
});
