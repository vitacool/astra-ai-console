import type { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { encryptSecret } from '../lib/crypto.js';
import { estimateTokens } from '../lib/tokens.js';
import { daysAgo, hoursAgo } from '../lib/time.js';

let randomState = 20261024;
function rand(): number {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 0xffffffff;
}

export function seedDatabase(db: DatabaseSync): void {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get() as {
    count: number;
  };
  if (existing.count > 0) return;

  const passwordHash = bcrypt.hashSync('Astra@2026', 10);
  const now = new Date().toISOString();

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status, avatar_color, created_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertProvider = db.prepare(`
    INSERT INTO providers (id, name, kind, base_url, api_key, default_model, models, status, last_checked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertKb = db.prepare(`
    INSERT INTO knowledge_bases (id, name, description, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertDoc = db.prepare(`
    INSERT INTO documents (id, kb_id, title, content, tokens, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'ready', ?)
  `);

  const insertAssistant = db.prepare(`
    INSERT INTO assistants
      (id, name, description, system_prompt, provider_id, model, temperature, max_tokens, icon, color, knowledge_base_id, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `);

  const insertConversation = db.prepare(`
    INSERT INTO conversations (id, assistant_id, user_id, title, pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMessage = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, tokens, latency_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertUsage = db.prepare(`
    INSERT INTO usage_logs
      (id, user_id, assistant_id, provider_id, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, status, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, detail, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?)',
  );

  db.exec('BEGIN');
  try {
    insertUser.run(
      'usr_admin',
      '李知远',
      'admin@astra.local',
      passwordHash,
      'OWNER',
      'active',
      '#5EEAD4',
      daysAgo(120),
      hoursAgo(2),
    );
    insertUser.run(
      'usr_lin',
      '林小满',
      'lin@astra.local',
      passwordHash,
      'ADMIN',
      'active',
      '#93C5FD',
      daysAgo(88),
      hoursAgo(5),
    );
    insertUser.run(
      'usr_chen',
      '陈屿',
      'chen@astra.local',
      passwordHash,
      'MEMBER',
      'active',
      '#FCD34D',
      daysAgo(46),
      daysAgo(1),
    );
    insertUser.run(
      'usr_zhou',
      '周予安',
      'zhou@astra.local',
      passwordHash,
      'MEMBER',
      'active',
      '#C4B5FD',
      daysAgo(21),
      daysAgo(4),
    );

    insertProvider.run(
      'prv_mock',
      'ASTRA 内置引擎',
      'mock',
      '',
      '',
      'astra-sim-1',
      JSON.stringify(['astra-sim-1', 'astra-sim-mini']),
      'active',
      hoursAgo(1),
      daysAgo(120),
      hoursAgo(1),
    );
    insertProvider.run(
      'prv_deepseek',
      'DeepSeek',
      'openai',
      'https://api.deepseek.com/v1',
      '',
      'deepseek-chat',
      JSON.stringify(['deepseek-chat', 'deepseek-reasoner']),
      'inactive',
      null,
      daysAgo(64),
      daysAgo(64),
    );

    insertKb.run(
      'kb_product',
      '产品知识库',
      '产品能力、版本差异与客户常见问题',
      '#5EEAD4',
      daysAgo(60),
      daysAgo(3),
    );
    insertKb.run(
      'kb_brand',
      '品牌语料库',
      '品牌语气、视觉规范与历史优秀文案',
      '#FBBF24',
      daysAgo(45),
      daysAgo(6),
    );

    const productDoc1 = `ASTRA 星枢是一套面向企业团队的 AI 应用管理平台。
核心能力包括：统一接入 OpenAI 兼容模型、创建与版本化 AI 助手、沉淀团队知识库、追踪 Token 用量与成本、成员权限管理和操作审计。
团队版支持 10 名成员、20 个 AI 助手与 5 个知识库，每月包含 200 万 Token 配额。
企业版支持私有化部署、SSO、自定义数据保留策略和专属成功经理。`;
    const productDoc2 = `客户常见问题
1. 数据安全：平台默认对模型密钥进行 AES-256-GCM 加密，所有对话按工作区隔离。
2. 支持哪些模型：任何兼容 OpenAI Chat Completions 协议的服务均可接入，包括 DeepSeek、通义千问、Moonshot 与自建推理服务。
3. 如何计费：按实际 Token 用量统计，可在用量分析中按成员、助手、模型维度查看。
4. 服务时间：企业版提供 7×24 小时支持，工作日 2 小时内响应。`;
    const brandDoc = `品牌语气：专业、克制、有洞察力。避免夸张承诺和空洞形容词。
推荐表达：把复杂问题拆开，给出可执行的下一步。
禁用词：颠覆、无敌、最强、百分之百。
优秀标题示例：让 AI 真正进入工作流，而不只是停留在对话框。`;

    insertDoc.run(
      'doc_product_1',
      'kb_product',
      'ASTRA 产品概览',
      productDoc1,
      estimateTokens(productDoc1),
      daysAgo(60),
    );
    insertDoc.run(
      'doc_product_2',
      'kb_product',
      '客户常见问题',
      productDoc2,
      estimateTokens(productDoc2),
      daysAgo(30),
    );
    insertDoc.run(
      'doc_brand_1',
      'kb_brand',
      '品牌语气与文案规范',
      brandDoc,
      estimateTokens(brandDoc),
      daysAgo(20),
    );

    insertAssistant.run(
      'asst_copy',
      '文案策划师',
      '擅长品牌文案、发布节奏与多渠道内容改写',
      '你是一位资深品牌文案策划。你的表达专业、克制、有画面感。请先理解目标受众与渠道，再输出可直接使用的中文文案。避免空泛形容词，必要时给出 3 个不同方向的备选。',
      'prv_mock',
      'astra-sim-1',
      0.8,
      2048,
      'Sparkles',
      '#FBBF24',
      'kb_brand',
      'usr_admin',
      daysAgo(42),
      daysAgo(2),
    );
    insertAssistant.run(
      'asst_data',
      '数据分析师',
      '从指标波动中定位原因，输出可执行结论',
      '你是一位严谨的数据分析师。面对业务数据时，先澄清指标口径，再按「现象—拆解—假设—验证」组织分析。所有结论都需要说明依据，不确定的地方要明确标注。用简洁的表格或要点呈现。',
      'prv_mock',
      'astra-sim-1',
      0.4,
      2048,
      'ChartNoAxesCombined',
      '#38BDF8',
      null,
      'usr_admin',
      daysAgo(38),
      daysAgo(7),
    );
    insertAssistant.run(
      'asst_support',
      '客户成功助手',
      '基于产品知识库回答客户问题，语气可靠友好',
      '你是 ASTRA 的客户成功助手。请优先依据知识库内容回答，不要编造产品能力或价格。若知识库没有答案，坦诚说明并建议联系人工支持。语气友好、简洁、可信。',
      'prv_mock',
      'astra-sim-1',
      0.3,
      1600,
      'Headset',
      '#34D399',
      'kb_product',
      'usr_lin',
      daysAgo(35),
      hoursAgo(9),
    );
    insertAssistant.run(
      'asst_code',
      '代码审查员',
      '发现边界条件、安全隐患与可维护性问题',
      '你是一位资深软件工程师，专注代码审查。优先指出会导致故障、数据损坏或安全风险的问题，其次讨论可维护性。每条意见说明原因和修改建议，并给出严重级别。不要重写全部代码，只聚焦关键改动。',
      'prv_mock',
      'astra-sim-1',
      0.2,
      3000,
      'Code2',
      '#A78BFA',
      null,
      'usr_chen',
      daysAgo(19),
      daysAgo(5),
    );

    insertConversation.run(
      'conv_launch',
      'asst_copy',
      'usr_admin',
      '秋季新品发布文案',
      1,
      daysAgo(2),
      hoursAgo(4),
    );
    insertMessage.run(
      'msg_1',
      'conv_launch',
      'user',
      '我们要发布一款面向独立开发者的 AI 工作台，主打「把零散工具收进一个工作流」。帮我写一段发布会开场文案，控制在 120 字以内。',
      estimateTokens('我们要发布一款面向独立开发者的 AI 工作台，主打「把零散工具收进一个工作流」。帮我写一段发布会开场文案，控制在 120 字以内。'),
      0,
      daysAgo(2),
    );
    insertMessage.run(
      'msg_2',
      'conv_launch',
      'assistant',
      `过去，我们习惯在十几个标签页之间搬运想法：一个窗口写，一个窗口查，一个窗口改。
现在，把它们收进同一条工作流。不是再多一个工具，而是让工具之间的缝隙消失。
欢迎来到 ASTRA——让想法从出现到交付，只走一条路。`,
      estimateTokens('过去，我们习惯在十几个标签页之间搬运想法：一个窗口写，一个窗口查，一个窗口改。现在，把它们收进同一条工作流。不是再多一个工具，而是让工具之间的缝隙消失。欢迎来到 ASTRA——让想法从出现到交付，只走一条路。'),
      820,
      hoursAgo(4),
    );
    insertMessage.run(
      'msg_3',
      'conv_launch',
      'user',
      '不错。再给我一个更克制的版本，适合放在官网首屏。',
      estimateTokens('不错。再给我一个更克制的版本，适合放在官网首屏。'),
      0,
      hoursAgo(4),
    );
    insertMessage.run(
      'msg_4',
      'conv_launch',
      'assistant',
      `把 AI 放进工作流，而不是另一个标签页。
一个入口，连接理解、创作与交付。
ASTRA，为独立开发者而建。`,
      estimateTokens('把 AI 放进工作流，而不是另一个标签页。一个入口，连接理解、创作与交付。ASTRA，为独立开发者而建。'),
      640,
      hoursAgo(4),
    );

    insertConversation.run(
      'conv_security',
      'asst_support',
      'usr_lin',
      '企业版数据安全说明',
      0,
      hoursAgo(7),
      hoursAgo(7),
    );
    insertMessage.run(
      'msg_5',
      'conv_security',
      'user',
      '企业版的 API Key 是怎么保存的？会不会出现在日志里？',
      estimateTokens('企业版的 API Key 是怎么保存的？会不会出现在日志里？'),
      0,
      hoursAgo(7),
    );
    insertMessage.run(
      'msg_6',
      'conv_security',
      'assistant',
      `API Key 会先经过 AES-256-GCM 加密再写入数据库，密钥由独立的环境变量派生。接口返回时只展示掩码，例如 sk-••••••••3f9a。

操作日志只记录「谁在什么时候修改了哪个供应商」，不会记录密钥明文或完整请求头。生产环境仍建议配合磁盘加密与最小权限数据库账号。`,
      estimateTokens('API Key 会先经过 AES-256-GCM 加密再写入数据库，密钥由独立的环境变量派生。接口返回时只展示掩码。操作日志只记录谁在什么时候修改了哪个供应商，不会记录密钥明文或完整请求头。生产环境仍建议配合磁盘加密与最小权限数据库账号。'),
      930,
      hoursAgo(7),
    );

    insertConversation.run(
      'conv_growth',
      'asst_data',
      'usr_chen',
      'Q3 增长数据复盘',
      0,
      daysAgo(1),
      daysAgo(1),
    );
    insertMessage.run(
      'msg_7',
      'conv_growth',
      'user',
      '9 月新增注册 1,840，环比增长 18%，但次月留存从 42% 下降到 37%。帮我拆一下可能原因。',
      estimateTokens('9 月新增注册 1,840，环比增长 18%，但次月留存从 42% 下降到 37%。帮我拆一下可能原因。'),
      0,
      daysAgo(1),
    );
    insertMessage.run(
      'msg_8',
      'conv_growth',
      'assistant',
      `先给结论：增长与留存同时变化，通常意味着新增渠道结构发生了改变，而不是产品本身突然变差。

建议按三步验证：
1. 渠道拆分：对比 8/9 月各渠道新增占比与对应次月留存，确认是否被低留存渠道稀释。
2. 激活路径：把「注册后 7 天内完成首个 AI 助手创建」作为激活事件，观察新用户激活率是否同步下降。
3. 版本变量：检查 9 月是否有引导流程、定价页或模型能力变更。

如果低留存渠道贡献了超过 40% 的新增，优先做渠道质量筛选；否则回到激活漏斗定位断点。`,
      estimateTokens('先给结论：增长与留存同时变化，通常意味着新增渠道结构发生了改变。建议按三步验证：渠道拆分、激活路径、版本变量。'),
      1120,
      daysAgo(1),
    );

    const models = [
      { provider: 'prv_mock', model: 'astra-sim-1', weight: 7 },
      { provider: 'prv_mock', model: 'astra-sim-mini', weight: 2 },
      { provider: 'prv_deepseek', model: 'deepseek-chat', weight: 3 },
    ];
    const assistants = ['asst_copy', 'asst_data', 'asst_support', 'asst_code'];
    const users = ['usr_admin', 'usr_lin', 'usr_chen', 'usr_zhou'];
    let usageIndex = 0;

    for (let day = 89; day >= 0; day -= 1) {
      const count = 5 + Math.floor(rand() * 10);
      for (let i = 0; i < count; i += 1) {
        const modelPick = models[Math.floor(rand() * models.length)];
        const assistant = assistants[Math.floor(rand() * assistants.length)];
        const user = users[Math.floor(rand() * users.length)];
        const promptTokens = 280 + Math.floor(rand() * 1300);
        const completionTokens = 180 + Math.floor(rand() * 1100);
        const failed = rand() < 0.035;
        const created = new Date(
          Date.now() -
            day * 86_400_000 -
            (i % 9) * 3_600_000 -
            Math.floor(rand() * 1_500_000),
        ).toISOString();
        insertUsage.run(
          `use_${usageIndex}`,
          user,
          assistant,
          modelPick.provider,
          modelPick.model,
          failed ? 0 : promptTokens,
          failed ? 0 : completionTokens,
          failed ? 0 : promptTokens + completionTokens,
          failed ? 320 + Math.floor(rand() * 500) : 620 + Math.floor(rand() * 2600),
          failed ? 'error' : 'success',
          rand() > 0.82 ? 'playground' : 'chat',
          created,
        );
        usageIndex += 1;
      }
    }

    insertAudit.run(
      'aud_1',
      'usr_admin',
      'provider.update',
      'provider',
      'prv_deepseek',
      '更新供应商配置「DeepSeek」',
      '127.0.0.1',
      daysAgo(1, 2),
    );
    insertAudit.run(
      'aud_2',
      'usr_lin',
      'assistant.create',
      'assistant',
      'asst_support',
      '创建 AI 助手「客户成功助手」',
      '127.0.0.1',
      daysAgo(2, 3),
    );
    insertAudit.run(
      'aud_3',
      'usr_admin',
      'member.invite',
      'user',
      'usr_zhou',
      '邀请成员 周予安 加入工作区',
      '127.0.0.1',
      daysAgo(4, 1),
    );
    insertAudit.run(
      'aud_4',
      'usr_lin',
      'knowledge.update',
      'knowledge_base',
      'kb_product',
      '更新知识库「产品知识库」',
      '127.0.0.1',
      daysAgo(5, 6),
    );
    insertAudit.run(
      'aud_5',
      'usr_admin',
      'auth.login',
      'session',
      null,
      '登录控制台',
      '127.0.0.1',
      hoursAgo(2),
    );

    insertSetting.run('workspace_name', '星枢 AI 实验室');
    insertSetting.run('token_budget', '2000000');
    insertSetting.run('workspace_plan', 'Team');
    insertSetting.run('default_assistant', 'asst_copy');
    insertSetting.run('timezone', 'Asia/Shanghai');
    insertSetting.run('retention_days', '90');
    insertSetting.run('embedding_backend', 'local');
    insertSetting.run('embedding_provider_id', '');
    insertSetting.run('embedding_model', 'astra-hash-1536');
    insertSetting.run('embedding_dimensions', '1536');
    insertSetting.run('rag_top_k', '5');
    insertSetting.run('rag_min_score', '0.12');

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
