# ASTRA 架构说明

## 1. 总览

ASTRA 采用单仓库、前后端分离、生产单进程托管的结构。前端是纯静态 SPA，后端是 Express API，并负责在生产环境托管前端产物。

```text
┌──────────────────────────────────────────────────────────────┐
│                         Browser (SPA)                        │
│  React 19 · Router · TanStack Query · Recharts · Markdown     │
└───────────────┬────────────────────────────────┬─────────────┘
                │ REST / JSON (Bearer JWT)       │ SSE (fetch stream)
                ▼                                ▼
┌──────────────────────────────────────────────────────────────┐
│                        Express API                           │
│ auth · dashboard · providers · assistants · knowledge        │
│ conversations · usage · users · settings · audit · embeddings│
└───────┬───────────────────┬──────────────────┬───────────────┘
        │                   │                  │
        ▼                   ▼                  ▼
┌───────────────┐   ┌───────────────┐   ┌──────────────────────┐
│ node:sqlite   │   │ AES-256-GCM   │   │ OpenAI-compatible    │
│ metadata · WAL│   │ provider keys │   │ chat + embeddings    │
└───────────────┘   └───────────────┘   └──────────┬───────────┘
        │                                          │
        │ index queue / local chunks               │
        ▼                                          ▼
┌───────────────────────────────┐      ┌──────────────────────┐
│ VectorStore                   │      │ mock / DeepSeek /    │
│ pgvector + HNSW (production)  │      │ OpenAI / vLLM / TEI  │
│ SQLite + cosine (local/demo)  │      └──────────────────────┘
└───────────────────────────────┘
```

## 2. 目录职责

| 路径 | 职责 |
| --- | --- |
| `apps/server/src/db` | SQLite 连接、schema、增量迁移、确定性演示数据 |
| `apps/server/src/lib` | JWT、加密、AI 客户端、Embedding、切片、索引队列、RAG、审计 |
| `apps/server/src/vector` | VectorStore 抽象、SQLite 与 pgvector 实现、混合打分 |
| `apps/server/src/routes` | 领域 API，按资源拆分 |
| `apps/server/src/app.ts` | 中间件、路由挂载、静态托管、SPA fallback |
| `apps/web/src/pages` | 9 个业务页面 |
| `apps/web/src/components` | 设计系统、Shell、Modal/Drawer、Toast/Confirm |
| `apps/web/src/lib/api.ts` | REST 封装与 SSE 解析 |
| `apps/web/src/index.css` | 设计 token 与全部响应式样式 |

## 3. 核心流程

### 3.1 登录

1. `POST /api/auth/login` 校验邮箱与 bcrypt 密码。
2. 失败按 `IP + email` 限流，15 分钟内最多 8 次失败。
3. 成功后更新 `last_login_at`、写入审计日志，签发 7 天 JWT。
4. 前端把 JWT 存入 `localStorage`，后续请求附带 `Authorization: Bearer`。
5. 任意接口返回 401 时触发 `astra:unauthorized`，前端清理会话并跳转登录。

### 3.2 流式对话

```text
Client                         Server                         Provider
  │ POST /messages               │                               │
  │─────────────────────────────>│                               │
  │                              │ 校验归属 / 供应商 / 密钥       │
  │                              │ 写入 user message             │
  │                              │ 检索知识库，拼 system prompt   │
  │<──── event: meta ────────────│                               │
  │                              │ POST /chat/completions ──────>│
  │                              │<──── SSE chunks ──────────────│
  │<──── event: token (n) ───────│                               │
  │                              │ 累计 token / 延迟              │
  │                              │ 写入 assistant message + usage│
  │<──── event: done ────────────│                               │
```

- 客户端使用原生 `fetch` + `ReadableStream` 解析 SSE，不依赖 EventSource（因为需要 POST 与 Bearer Token）。
- 服务端在客户端断开时中止上游请求，并保存已生成的部分内容，用量记为失败。
- 流式中的错误通过 `event: error` 返回，前端保留部分内容并展示错误条。

### 3.3 向量 RAG

1. 文档按 Markdown 标题与段落切片，目标 ≤900 字，overlap 140 字。
2. 文档写入后进入持久化 `index_jobs` 队列，worker 异步生成 Embedding。
3. 向量写入 `VectorStore`：生产为 pgvector + HNSW，本地为 SQLite + JS cosine。
4. 用户提问时生成查询向量，同时做向量召回与关键词召回。
5. 混合打分 `0.70 * vector + 0.30 * lexical`，每文档最多 2 个切片，按阈值与 Top K 截断。
6. 片段注入 system prompt，结构化引用写入 `messages.citations`，前端可展开溯源。

Embedding 失败时自动降级为关键词检索；向量库不可用时对话继续但无知识上下文。完整的索引、调优和运维细节见 [RAG.md](RAG.md)。

## 4. 数据模型

```text
users 1─n conversations 1─n messages
users 1─n usage_logs
providers 1─n assistants 1─n conversations
knowledge_bases 1─n documents 1─n document_chunks
documents 1─1 index_jobs
assistants n─1 knowledge_bases (optional)
users 1─n audit_logs
retrieval_logs
```

主要表：

| 表 | 关键字段 |
| --- | --- |
| `users` | role (`OWNER/ADMIN/MEMBER`), status, password_hash, avatar_color |
| `providers` | kind (`mock/openai`), base_url, api_key (encrypted), models (JSON), status |
| `assistants` | system_prompt, provider_id, model, temperature, max_tokens, knowledge_base_id |
| `knowledge_bases` / `documents` | 文档正文、token、索引状态、切片数、错误、checksum |
| `document_chunks` | SQLite 模式下的切片正文与 JSON 向量 |
| `index_jobs` | 异步索引任务、状态、尝试次数、错误 |
| `retrieval_logs` | 查询、模式、候选数、Top score、延迟、引用快照 |
| `conversations` / `messages` | 归属用户、标题、置顶、消息角色、延迟、citations |
| `usage_logs` | prompt/completion/total token、latency、status、source |
| `audit_logs` | actor、action、target、detail、ip |
| `settings` | 工作区名称、预算、时区、保留周期、默认助手、Embedding 配置 |

所有时间使用 ISO 8601 UTC 字符串；前端按浏览器时区展示。

## 5. 权限模型

| 能力 | OWNER | ADMIN | MEMBER |
| --- | --- | --- | --- |
| 查看总览 / 用量 | ✓ | ✓ | ✓ |
| 创建与使用对话 | ✓ | ✓ | ✓ |
| 查看助手 / 知识库 | ✓ | ✓ | ✓ |
| 创建/编辑/删除助手 | ✓ | ✓ | — |
| 管理供应商与密钥 | ✓ | ✓ | — |
| 管理知识库与文档 | ✓ | ✓ | — |
| 邀请/停用成员 | ✓ | ✓（仅普通成员） | — |
| 修改工作区设置 | ✓ | ✓ | — |
| 查看审计日志 | ✓ | ✓ | — |
| 修改负责人 / 最后负责人保护 | ✓ | — | — |

后端是权限的唯一事实来源，前端隐藏入口只是体验优化。

## 6. 安全设计

- **密码**：bcrypt，cost 10。
- **JWT**：HS256；生产必须设置 `JWT_SECRET`。
- **供应商密钥**：AES-256-GCM，随机 12-byte IV，认证标签随密文保存；`APP_SECRET` 经 SHA-256 派生 32-byte key。
- **数据隔离**：对话查询始终附带 `user_id`；知识库是工作区共享资产。
- **RAG 数据边界**：文档正文会发送到配置的 Embedding 服务；引用快照写入消息，历史回答可追溯。
- **检索日志**：记录查询与引用快照用于排障，不写供应商密钥；生产应纳入保留策略。
- **审计**：写操作记录 actor / action / target / IP；不记录密钥、密码、完整 Prompt 或消息正文。
- **错误处理**：对外返回统一 JSON，详细异常仅写服务端日志。
- **流式安全**：SSE 响应设置 `no-transform` 与 `X-Accel-Buffering: no`，避免代理缓冲。
- **CORS**：默认开发环境反射来源；生产建议设置 `CORS_ORIGINS`。

### 生产增强清单

1. JWT 迁移到 HttpOnly / Secure / SameSite Cookie，配合 CSRF Token。
2. 引入 Redis 对登录限流、会话撤销、SSE 并发和索引任务锁做分布式控制。
3. 对供应商 Base URL 做 allowlist，防止 SSRF。
4. 使用 PostgreSQL + 行级安全 / 租户字段实现多租户。
5. 接入密钥托管服务（Vault / KMS），而不是应用内派生密钥。
6. 增加审计日志不可篡改存储（WORM / 外部 SIEM）。
7. 对 Embedding 输入做敏感信息脱敏，并配置文件级 ACL。
8. 给 RAG 增加 Prompt Injection 检测与引用忠实度评估。

## 7. 扩展点

| 需求 | 建议改动 |
| --- | --- |
| 接入 Anthropic / Gemini | 在 `lib/ai.ts` 增加 provider kind 与协议适配器，保持 `StreamOptions` 不变 |
| 文档解析 PDF/DOCX | 增加异步解析任务，解析后写入 `documents` 并触发 `enqueueIndex` |
| Reranker | 在 `lib/retrieval.ts` 的候选合并后增加 cross-encoder 重排 |
| 多租户 | 所有业务表与向量表增加 `workspace_id`，检索 SQL 强制过滤 |
| 计费 | 在 `usage_logs` 增加价格快照，按模型定价聚合账单 |
| 实时协作 | 对话走 WebSocket，当前 SSE 只支持单请求单向流 |
| 可观测性 | 请求 ID 中间件 + OpenTelemetry traces + Prometheus metrics |

## 8. 构建与部署

- 开发：Vite `5173` 通过 proxy 访问 API `8787`。
- 生产：`npm run build` 生成 `apps/web/dist` 与 `apps/server/dist`，`npm start` 由 Express 托管 SPA 与 API。
- Docker：两阶段构建，运行阶段只暴露 8787，业务数据通过 `astra-data` volume 持久化。
- 向量库：Docker Compose 同时启动 `pgvector/pgvector:pg17`，通过 `VECTOR_DATABASE_URL` 注入；未配置时回退 SQLite 向量表。
- 单实例约束：SQLite 业务库 + 单进程索引队列；多实例部署必须迁移 PostgreSQL、使用外置任务队列与会话存储。
