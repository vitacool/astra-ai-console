interface MockContext {
  assistantName: string;
  userMessage: string;
  knowledge?: string;
}

function brief(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function copyReply(message: string): string {
  return `你给的信息很具体，我先抓住核心：**${brief(message)}**

下面给你 3 个可直接使用的方向，语气从外放到克制递进。

### 方向一 · 场景切入
> 不是再多一个工具，而是让每一个想法都有下一步。

从用户最熟悉的动作写起：打开、输入、交付。先让人看见自己的日常，再给出变化。

### 方向二 · 对比收束
> 把散落在十几个标签页里的工作，收进同一条路径。

适合官网首屏或发布会大屏。前半句制造共鸣，后半句给出产品位置。

### 方向三 · 价值主张
> 让 AI 进入工作流，而不是停留在对话框。

适合作为品牌主张长期使用。它没有承诺夸张结果，但把差异讲清楚了。

**下一步建议**：确定渠道后，我可以把选定方向扩展成 30 字标题、80 字摘要和 3 条卖点。你更偏向发布会现场，还是官网首屏？`;
}

function dataReply(message: string): string {
  return `先对齐口径：你描述的是「${brief(message)}」。在拆原因之前，需要确认分母、时间窗口和渠道结构是否发生变化。

### 初步判断
增长和留存同时波动，通常不是单点问题。最值得先排除的是**新增结构变化**，其次才是产品体验。

| 假设 | 可能解释 | 验证方式 |
| --- | --- | --- |
| 渠道结构变化 | 低留存渠道贡献了更多新增，拉低整体留存 | 按渠道拆分新增占比与次月留存 |
| 激活路径变长 | 新用户没有完成关键动作 | 对比注册后 7 天激活率 |
| 版本或定价影响 | 9 月改动影响首周体验 | 对比版本上线前后同期队列 |

### 建议动作
1. 拉取近 3 个月的分渠道 cohort 表，统一按注册周分组。
2. 定义可观测的激活事件，例如「创建首个助手并完成一次对话」。
3. 对贡献新增最多的两个渠道做用户访谈，验证意图是否匹配。

> 结论要等数据验证后再下。当前最有价值的不是解释，而是把假设变成可验证的指标。

如果你把渠道占比和激活漏斗数据贴过来，我可以继续往下拆。`;
}

function codeReply(message: string): string {
  return `我会按「会出故障 → 会泄露数据 → 难维护」的顺序审查。针对你提到的 **${brief(message)}**，先列出最值得检查的几处。

### 高优先级
1. **边界输入**：空数组、超长文本、重复提交是否都有明确处理？建议在入口统一校验，而不是在业务逻辑里分散判断。
2. **失败路径**：外部模型调用超时后，是否会留下半条消息或重复计费？需要把「生成中」和「已完成」显式建模。
3. **权限边界**：每次读取会话时都要校验归属，不能只依赖前端传入的 ID。

### 中优先级
- 把模型调用、Token 统计、审计写入拆成独立函数，避免路由层承担过多职责。
- 对用户输入做长度限制，并在流式输出时处理客户端中断。
- 错误信息对外脱敏，详细堆栈只写服务端日志。

### 一个可复用的检查清单
\`\`\`text
[ ] 输入有 schema 校验
[ ] 资源读取校验 owner
[ ] 外部调用有超时
[ ] 失败会回滚或补偿
[ ] 敏感字段不写日志
\`\`\`

把具体代码片段发我，我可以定位到行并给出最小改动方案。`;
}

function supportReply(message: string, knowledge?: string): string {
  const hasKnowledge = Boolean(knowledge);
  return `这个问题很关键。${hasKnowledge ? '我查阅了团队知识库中的相关资料，先给你一个基于现有信息的答复。' : '当前知识库里没有完全匹配的资料，以下是一般性建议，涉及具体承诺时请再和产品团队确认。'}

### 简要回答
${hasKnowledge ? '平台会对模型密钥进行加密保存，接口只返回掩码；操作日志记录「谁修改了什么」，不会记录密钥明文。' : '建议先确认数据流向：哪些内容会发送给模型服务、保存多久、谁有权限查看。'}

### 你可以这样向客户解释
> 我们默认按工作区隔离数据，密钥加密存储，敏感操作全程留痕。企业版还可以配置更严格的数据保留策略和私有化部署。

### 还需要确认
- 客户是否要求数据不出境或私有化部署？
- 是否需要单独配置日志保留周期？
- 是否涉及个人敏感信息？

如果告诉我客户所在的行业与合规要求，我可以帮你整理一版更完整的回复。`;
}

function genericReply(message: string, assistantName: string, knowledge?: string): string {
  return `收到。作为「${assistantName}」，我先把你这次的需求拆成三层：

**1. 目标**
你想解决的是：${brief(message, 56)}

**2. 关键约束**
在给方案之前，需要明确时间、受众和成功标准。否则很容易做出「看起来完整、但无法验收」的结果。

**3. 建议的下一步**
- 先用一句话写下最终要交付的东西；
- 列出 3 个必须满足的条件；
- 选一个最小版本，今天就能验证。

${knowledge ? '我已经参考了团队知识库中的相关材料，上面的方向与现有规范保持一致。' : '目前没有检索到直接相关的团队资料，所以以上是通用建议。'}

如果你愿意补充背景，我可以继续把它变成一份可执行的方案。`;
}

export function mockReply(context: MockContext): string {
  const { userMessage, assistantName, knowledge } = context;
  if (/文案|标题|发布|品牌|营销|开场|slogan|copy/i.test(userMessage)) {
    return copyReply(userMessage);
  }
  if (
    /安全|密钥|隐私|合规|部署|权限|数据保留|api\s*key/i.test(userMessage)
  ) {
    return supportReply(userMessage, knowledge);
  }
  if (/数据|留存|增长|指标|转化|分析|报表|cohort/i.test(userMessage)) {
    return dataReply(userMessage);
  }
  if (/代码|审查|bug|函数|接口|性能|重构/i.test(userMessage)) {
    return codeReply(userMessage);
  }
  return genericReply(userMessage, assistantName, knowledge);
}
