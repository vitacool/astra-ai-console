# 向量 RAG 设计与运维

## 1. 目标与边界

知识库现在是一条完整的 **Retrieval-Augmented Generation** 链路：

```text
文档 → 标题感知切片 → Embedding → 向量存储
                                      │
问题 → Embedding ─┬─ 向量召回 ─────────┘
                  └─ 关键词召回 → 混合打分 → 去重 / 阈值 → Top K
                                                   │
                                      System Prompt + 引用编号
                                                   │
                                               LLM 生成
                                                   │
                                       消息 + citations 持久化
```

支持的两种运行模式：

| 模式 | Embedding | 向量存储 | 用途 |
| --- | --- | --- | --- |
| 本地模式 | 字符 n-gram 特征哈希 | SQLite `document_chunks` | 零配置演示、离线开发、CI |
| 生产模式 | OpenAI 兼容 `/embeddings` | PostgreSQL + pgvector + HNSW | 语义检索、规模化知识库 |

> 本地模式不是语义模型。它保证没有 API Key 时也能完整演示索引、检索、引用和重建流程，但同义改写能力有限。

## 2. 数据模型

### 2.1 业务元数据（SQLite）

```text
knowledge_bases 1─n documents 1─n document_chunks (SQLite 模式)
documents 1─1 index_jobs
documents 1─n citations (JSON in messages)
retrieval_logs
```

`documents` 新增字段：

| 字段 | 说明 |
| --- | --- |
| `status` | `processing / ready / error` |
| `chunk_count` | 成功写入的切片数 |
| `index_error` | 最近一次索引失败原因（截断） |
| `checksum` | 文档内容 SHA-256 |
| `updated_at` | 状态与内容更新时间 |

`messages.citations` 保存该回答引用的切片快照（标题、摘要、分数、文档 ID），即使之后文档被删除，历史回答仍能展示当时的引用。

### 2.2 向量数据（SQLite 或 pgvector）

pgvector 表：

```sql
CREATE TABLE astra_chunks (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  embedding vector(1536) NOT NULL,
  embedding_model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
```

索引：

- `HNSW (embedding vector_cosine_ops)`：向量近邻
- `GIN (content gin_trgm_ops)`：关键词候选
- `kb_id` / `document_id` 普通 B-tree

SQLite 模式使用同一套逻辑字段，`embedding` 存 JSON 数组，检索时在 Node.js 中计算 cosine。

## 3. 索引流水线

### 3.1 切片

`lib/chunking.ts`：

- 识别 Markdown `#` 标题，生成 `文档标题 › 章节标题` 的上下文标题。
- 按空行分段，单块目标 ≤ 900 字符，块间 overlap 140 字符。
- 超长段落按窗口滑动切分。
- 过短尾块合并到前一块。
- 单文档最多 400 个切片。

### 3.2 异步任务

新增文档或更新文档时：

1. 文档状态置为 `processing`。
2. 写入 `index_jobs`（`document_id` 主键，状态 `pending`）。
3. 后台 worker 原子领取任务：`UPDATE ... WHERE status='pending'`。
4. worker 分批调用 Embedding（每批 24 个切片）。
5. 向量写入成功后才替换旧切片，避免检索到半成品。
6. 文档状态置为 `ready` 并写入 `chunk_count` / `checksum`。
7. 失败时状态置为 `error`，错误写入 `index_error`，任务保留为 `failed`，不会无限重试。

任务队列为 **单进程持久化队列**。多实例部署需要 Redis / PostgreSQL 任务锁；当前架构面向单实例。

### 3.3 Embedding 容错

`lib/embeddings.ts`：

- 支持批量（32 条/请求）。
- 429 / 5xx 自动重试 3 次，指数退避。
- 60 秒超时。
- 校验返回向量数量与维度。
- 查询向量缓存 10 分钟（最多 200 条）。
- OpenAI `text-embedding-3-*` 支持 `dimensions` 参数；其他模型按原维度返回。
- 配置变更时清空缓存。

## 4. 检索与重排

### 4.1 候选生成

pgvector 模式：

1. HNSW 向量 Top `max(40, limit*8)`。
2. `pg_trgm` 关键词 `ILIKE ANY(terms)` Top 同样数量。
3. 合并候选、按 chunk id 去重。

SQLite 模式：加载该知识库全部切片（上限 20,000），同时计算 cosine 与词法分数。

### 4.2 混合分数

```text
vectorScore  = max(0, cosine(query, chunk))
keywordScore = 词项覆盖率 + 精确短语加成
titleBoost   = lexical(title, terms) * 0.06
score        = 0.70 * vectorScore + 0.30 * keywordScore + titleBoost
```

- 向量负责语义召回。
- 关键词负责专有名词、版本号、政策编号、中文短查询的精确命中。
- 阈值默认 `0.12`，Top K 默认 `5`。
- 每个文档最多保留 2 个切片，避免单文档挤占上下文。
- 低于阈值不注入，避免模型被无关资料干扰。

### 4.3 引用

系统提示词中每个片段带 `[资料 N]`，要求模型在相关句末标注。服务端同时保存结构化 `citations`：

```json
{
  "index": 1,
  "chunkId": "...",
  "documentId": "...",
  "kbId": "...",
  "title": "产品知识库 › 客户常见问题",
  "snippet": "平台默认对模型密钥进行 AES-256-GCM 加密...",
  "score": 0.22,
  "vectorScore": 0.13,
  "keywordScore": 0.45
}
```

前端在助手消息下展示可展开的引用卡片，点击进入对应知识库。

### 4.4 降级

- Embedding 不可用：自动降级为关键词检索，响应带 `warning`。
- 向量库不可用：`knowledgeContext` 返回空上下文，对话继续，不阻塞 LLM。
- 检索无结果：不注入知识，不伪造引用。

## 5. 配置

「知识库」→「检索配置」：

| 配置 | 说明 |
| --- | --- |
| 向量化方式 | 本地哈希 / 语义 Embedding |
| Embedding 供应商 | OpenAI 兼容 provider，复用已加密的 API Key |
| Embedding 模型 | 例如 `text-embedding-3-small`、`bge-m3` |
| 向量维度 | 128–3072，必须与模型输出一致 |
| Top K | 3–12 |
| 最低相关度 | 0–0.9 |

保存配置的流程：

1. 解析并校验配置。
2. 实际调用一次 Embedding 做连通性验证。
3. `resetVectorStore(newDimensions)` 清空旧集合 / 重建 pgvector 表。
4. 写入 settings。
5. 将所有文档重新入队并异步重建。
6. 写入审计日志 `rag.config.update`。

## 6. 部署 pgvector

### Docker Compose

```bash
docker compose up -d --build
```

Compose 会启动 `pgvector/pgvector:pg17`，并注入：

```env
VECTOR_DATABASE_URL=postgres://astra:astra@vector-db:5432/astra
```

应用启动时自动：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS astra_chunks (... vector(N) ...);
CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ... USING gin (content gin_trgm_ops);
```

### 外部 PostgreSQL

```env
VECTOR_DATABASE_URL=postgres://user:pass@host:5432/db
```

要求：

- PostgreSQL 14+
- pgvector 0.5+
- 数据库用户有 `CREATE EXTENSION` 权限（或由 DBA 预先创建）
- 维度与 Embedding 模型一致

### 维度变更

修改维度会：

- SQLite：删除全部 `document_chunks`，重新索引。
- pgvector：`DROP TABLE astra_chunks` → 按新维度重建 → 全量重索引。

这是有意的破坏性操作，必须通过「检索配置」保存触发，UI 会提示重建。

## 7. 失败处理

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 文档 `索引失败` | Embedding 密钥错误 / 额度不足 / 维度不符 | 查看文档错误信息，修正配置后点「重建索引」 |
| `VECTOR_DIMENSION_MISMATCH` | 配置维度与 pgvector 表不一致 | 在检索配置中保存相同维度，触发重建 |
| 检索无结果 | 阈值过高、文档未索引、问法差异过大 | 降低阈值、查看检索测试、换语义模型 |
| 检索总是关键词降级 | Embedding 供应商不可达 | 检查 Base URL `/embeddings` 与网络 |
| 向量库不可用 | PostgreSQL 未启动 / 扩展缺失 | 查看 `GET /api/embeddings/config` 的 `vectorError` |
| 任务长期 pending | worker 未启动 / 多实例竞争 | 重启应用；多实例需外置任务队列 |

## 8. 质量评估建议

生产环境不要只凭“看起来不错”调参。建议建立 50–200 条真实问题的黄金集：

1. **Recall@K**：正确文档是否出现在 Top K。
2. **MRR**：正确片段排名。
3. **Faithfulness**：回答是否只使用检索内容。
4. **Answer Relevance**：回答是否解决用户问题。
5. **Citation Accuracy**：引用编号是否对应正确片段。

调整顺序：

```text
切片质量 → Embedding 模型 → 混合权重 → 阈值 → Top K → Reranker
```

常用调参起点：

| 参数 | 建议 |
| --- | --- |
| chunk size | 600–1000 字 |
| overlap | 10%–20% |
| Top K | 4–8 |
| min score | 0.10–0.25（取决于模型分布） |
| 每文档上限 | 2–3 |

## 9. 已知限制与后续路线

- 任务队列是单进程 SQLite 队列，不支持多实例抢占。
- 业务元数据仍是 SQLite；生产多实例需要迁移 PostgreSQL。
- 默认 CI 使用 SQLite 向量后端；pgvector 路径需要在 Docker / PostgreSQL 环境中做部署验证。
- 未集成 cross-encoder reranker；当前为向量 + 词法融合。
- 仅支持 txt / md 导入，PDF / DOCX 需要新增解析服务。
- 文档级 ACL、多租户过滤尚未实现。
- 本地哈希向量不是语义模型，仅用于演示和 CI。
- 尚无自动化的 RAG 质量评估面板。

建议下一步：

1. 引入 reranker（bge-reranker / Cohere Rerank）。
2. PDF / DOCX 解析与对象存储。
3. Redis 队列与索引任务锁。
4. pgvector 分区 / 多租户 `workspace_id`。
5. 检索评估集与回归看板。
