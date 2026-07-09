# AI Insight Hub - 项目需求文档

**创建时间：** 2026-07-06  
**目标用户：** AI 产品人/OPC  
**核心目标：** 构建个人 AI 信息获取→筛选→沉淀→加工→分享的完整管道

---

## 一、用户背景与核心诉求

### 用户画像
- **角色**：AI 产品人（非技术背景）
- **工作场景**：产品思路启发、内容创作、行业洞察
- **信息需求**：
  - 新产品/工具发布（能解决什么问题）
  - 新模型动态（新能力，应用场景）
  - AI 投资圈/创投圈动态
  - 商业洞察和产品策略

### 核心诉求（按优先级）

1. **发现高质量内容** - 产品灵感 + 深度文章
2. **快速筛选判断** - 每天30条内，不浪费时间
3. **深度阅读** - 完整内容 + 中文翻译，不只是标题党
4. **知识沉淀** - 方便二次加工和分享
5. **持续优化** - 信息源质量迭代

### 现有信息获取习惯
- 听播客：张小珺商业访谈、硅谷101、晚点、42章经
- 关注中文 AI 博主和公众号
- 浏览 GitHub Trending
- 关注头部公司（OpenAI、Anthropic、Google）官方动态

---

## 二、产品定位

### 本质定义
> **不是**一个"AI 资讯聚合器"  
> **而是**一个帮你筛选、理解、沉淀 AI 领域高质量内容的个人知识管道

### 核心原则
- **质量 > 数量**：10个高质量源 > 50个泛泛之交
- **一手 > 二手**：直接关注建设者，而非转述者
- **产品商业视角 > 技术细节**：关注应用和商业模式，非底层算法

---

## 三、参考项目分析

### Follow Builders
- **GitHub**：https://github.com/zarazhangrui/follow-builders
- **优势**：
  - ✅ 信息源质量高（26个 AI 建设者 + 6个播客）
  - ✅ 哲学清晰：Follow builders, not influencers
  - ✅ 中心化 feed + 本地处理（降低用户门槛）
- **局限**：
  - ❌ 信息源固定，不可定制
  - ❌ 只有摘要，缺少完整内容
  - ❌ 无知识沉淀机制

### AI HOT (aihot.virxact.com)
- **GitHub**：https://github.com/KKKKhazix/khazix-skills/tree/main/aihot
- **优势**：
  - ✅ 信息源广泛，适合大众
  - ✅ 网页设计友好，分类清晰
  - ✅ 卡片式布局，可扩展性强
  - ✅ REST API 简单易用
- **局限**：
  - ❌ 覆盖面太广，不够聚焦
  - ❌ 缺少个性化定制

### 借鉴策略
- **信息源质量**：学习 Follow Builders 的筛选标准
- **产品形态**：学习 AI HOT 的网页设计和交互
- **技术架构**：复用两者的 Skill + API 架构

---

## 四、第一版需求（MVP）

### 产品定位
**小而精 > 大而全**

第一版只做 **3 件核心事**：
1. 获取 15 个核心信息源
2. 网页快速浏览 + 标记
3. 导出到 Obsidian

**不做**（留待第二阶段）：
- ❌ 复杂的自动分类
- ❌ 分享稿自动生成
- ❌ 个性化推荐算法

---

## 五、信息源设计（15个核心）

### 官方博客（4个）- 权威一手信息
```
1. Anthropic Engineering - https://www.anthropic.com/engineering
2. Anthropic News - https://www.anthropic.com/news
3. OpenAI Blog - https://openai.com/blog
4. Google DeepMind - https://deepmind.google/discover/blog/
```

### X/Twitter 核心账号（10个）- 产品商业视角
```
产品人 & 创始人：
1. Alex Albert (@alexalbert__) - Anthropic 产品
2. Guillermo Rauch (@rauchg) - Vercel CEO, AI 产品化
3. Amjad Masad (@amasad) - Replit CEO
4. Aaron Levie (@levie) - Box CEO, 企业 AI 视角
5. Sam Altman (@sama) - OpenAI CEO

投资人 & 观察者：
6. Garry Tan (@garrytan) - YC President
7. Swyx (@swyx) - AI 工程实践

中文 AI 产品人：
8. 宝玉 (@dotey) - AI 工具推荐
9. 歸藏 (@op7418) - AI 产品发现
10. Shao (@shao__meng) - AI 产品人
```

### 补充源（1个）- 覆盖广度
```
AI HOT API - 精选模式
- 已筛选的每日精选内容
- 补充其他重要动态
```

### 信息源总量预估
- 10个 X 账号 × 1-2条/天 = 10-20条
- 4个官方博客 × 0-2篇/周 = 2-5条
- AI HOT 精选 = 10-15条
- **总计：每天 20-30 条**

---

## 六、内容处理策略

### 英文内容处理
```
标题：保持英文原文
摘要：自动翻译成中文（150字）✅
正文：按需翻译（用户点击"翻译全文"按钮时）✅
链接：保留原文 URL
```

### 中文内容处理
```
标题：保持中文
摘要：提取前150字
正文：保持原文
链接：保留原文 URL
```

### 分类体系
直接复用 AI HOT 的分类：
- 🚀 产品发布/更新
- 💰 融资动态
- 🔧 技术突破
- 💡 行业观点
- 🛠️ 工具推荐

### 成本估算
```
每日处理：
- 摘要翻译：30条 × 200 tokens = 6,000 tokens
- 按需全文翻译：2-3篇 × 1,500 tokens = 4,500 tokens
- 总计：约 10,500 tokens/天 ≈ $0.15/天
```

---

## 七、网页界面设计

### 布局参考
**风格**：类似 aihot.virxact.com，卡片式布局

### 主页面结构
```
┌──────────────────────────────────────────────────────┐
│  AI Insight Hub · 2026年7月6日          [搜索🔍]     │
│  [全部30] [产品10] [融资2] [技术15] [观点3]         │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [卡片区域 - 可滚动]                                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 卡片设计（默认状态）
```
┌──────────────────────────────────────────────────────┐
│  OpenAI releases GPT-5.6                            │
│  OpenAI Blog · 2小时前 · 🚀 产品发布                │
│  ──────────────────────────────────────────         │
│  【中文摘要】                                        │
│  GPT-5.6 在数学推理上取得重大突破，成功解决         │
│  IMO（国际数学奥林匹克）级别问题，推理能力          │
│  提升3倍，API价格下降40%...                          │
│                                                      │
│  [查看原文 ↗] [🌐 翻译全文] [💾 保存] [⏭️ 跳过]    │
└──────────────────────────────────────────────────────┘
```

### 交互功能

#### 1. 查看原文
- 在新标签页打开原文链接

#### 2. 翻译全文（按需）
点击后，卡片展开显示：
```
【完整翻译】▼
今天，OpenAI 发布了 GPT-5.6，这是我们在数学
推理能力上的重大突破...

关键亮点：
• 数学推理能力提升 3 倍
• API 价格降低 40%
• 新增多模态输入支持
...
```

#### 3. 保存到知识库
- 导出 Markdown 文件到 Obsidian
- 格式见下文

#### 4. 跳过
- 记录用户反馈
- 用于后续优化信息源质量

---

## 八、知识沉淀机制

### Obsidian 导出格式

用户点击"保存"后，生成如下 Markdown 文件：

```markdown
---
title: OpenAI releases GPT-5.6
title_zh: OpenAI 发布 GPT-5.6
source: OpenAI Blog
url: https://openai.com/blog/gpt-56
date: 2026-07-06
category: 产品发布
language: en
saved_at: 2026-07-06 09:30
---

## 中文摘要

GPT-5.6 在数学推理上取得重大突破，成功解决 IMO（国际数学
奥林匹克）级别问题，推理能力提升3倍，API价格下降40%...

## 完整翻译

今天，OpenAI 发布了 GPT-5.6，这是我们在数学推理能力上的
重大突破。新模型成功解决了国际数学奥林匹克竞赛级别的问题...

**关键亮点：**
- 数学推理能力提升 3 倍
- API 价格降低 40%
- 新增多模态输入支持
- 响应速度提升 2 倍

## 原文链接

https://openai.com/blog/gpt-56

## 我的笔记

<!-- 在这里添加你的想法和笔记 -->

## 相关链接

- [[]]

---
Tags: #OpenAI #GPT #产品发布 #数学推理
```

### 导出路径
```
~/Documents/Obsidian/llm-wiki/
  └── ai-insights/
      └── 2026-07-06/
          ├── openai-gpt-56.md
          ├── anthropic-prompt-caching.md
          └── ...
```

---

## 九、技术架构

### 整体架构
```
┌─────────────────────────────────────────────┐
│            信息获取层                        │
│  官方博客RSS + X账号API + AI HOT API        │
└─────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│            处理层                            │
│  - 合并去重                                  │
│  - 英文摘要 → 中文翻译（Claude API）        │
│  - 使用 AI HOT 分类                         │
└─────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│            展示层                            │
│  本地网页（静态 HTML + JSON）               │
│  - 卡片式布局                               │
│  - 按需翻译（点击时调用 Claude）            │
└─────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│            沉淀层                            │
│  Markdown 导出到 Obsidian                   │
└─────────────────────────────────────────────┘
```

### 技术选型
- **内容获取**：Node.js + curl
- **AI 处理**：Claude API（翻译、摘要）
- **网页**：静态 HTML + Vanilla JS + CSS
- **数据存储**：JSON 文件（本地）
- **Skill 集成**：SKILL.md（Claude Code 标准）

### 目录结构
```
ai-insight-hub/
├── config/
│   └── sources.json              # 信息源配置
│
├── scripts/
│   ├── fetch-feed.js             # 获取内容
│   ├── process-content.js        # AI 处理
│   └── serve-web.js              # 启动本地服务器
│
├── prompts/
│   ├── summarize-en.md           # 英文摘要提取
│   └── translate-full.md         # 全文翻译
│
├── web/
│   ├── index.html                # 主页面
│   ├── style.css                 # 样式
│   └── app.js                    # 交互逻辑
│
├── data/
│   ├── content-YYYY-MM-DD.json   # 每日内容
│   └── user-feedback.json        # 用户反馈
│
├── obsidian-export/              # Obsidian 导出
│   └── YYYY-MM-DD/
│
└── SKILL.md                      # Claude Code 技能
```

---

## 十、使用流程

### 每日工作流（5-10分钟）

```
1. 早上运行命令
   /ai-insight
   或说："今天的 AI 资讯"

2. 系统自动执行（30秒）
   - 调用 AI HOT API
   - 抓取官方博客 RSS
   - 抓取 10 个 X 账号
   - 合并去重
   - AI 翻译英文摘要
   - 生成网页并自动打开浏览器

3. 你在网页上操作（5-10分钟）
   - 快速扫描 30 条标题 + 中文摘要
   - 感兴趣的点击"查看原文"
   - 需要深读的点击"翻译全文"
   - 有价值的点击"保存"→ 自动导出到 Obsidian
   - 不感兴趣的点击"跳过"→ 记录反馈

4. 系统自动记录
   - 保存的内容 → Obsidian 知识库
   - 跳过的内容 → 反馈记录
   - 用于后续优化信息源质量
```

---

## 十一、实施计划

### Phase 1: MVP（1周内完成）

**目标**：验证信息管道是否适合用户

**功能清单**：
- ✅ 配置 15 个信息源（4官方 + 10 X + 1 AI HOT）
- ✅ 内容获取脚本（复用 follow-builders + AI HOT API）
- ✅ 摘要自动翻译（Claude API）
- ✅ 网页界面（卡片式，参考 AI HOT）
- ✅ 按需全文翻译（点击按钮触发）
- ✅ 保存到 Obsidian（Markdown 导出）
- ✅ 跳过反馈记录
- ✅ Skill 定义（SKILL.md）

**成功标准**：
- 每天能稳定获取 20-30 条内容
- 网页加载速度 < 2秒
- 翻译质量可读
- 导出的 Markdown 格式正确

### Phase 2: 优化（2-4周）

基于用户使用反馈：
- 调整信息源（哪些质量高？增加类似的）
- 优化分类和筛选
- 增加搜索功能
- 优化翻译质量

### Phase 3: 智能化（长期）

- 学习用户偏好（常保存哪类内容）
- 自动推荐类似内容
- 生成周报/月报
- 分享稿自动生成

---

## 十二、技术实现细节

### 1. 信息源获取

#### 官方博客（RSS）
```javascript
// 使用 RSS parser
const blogs = [
  'https://www.anthropic.com/engineering/rss.xml',
  'https://openai.com/blog/rss.xml',
  // ...
];
```

#### X 账号（复用 follow-builders）
```javascript
// 使用 follow-builders 的中心化 feed
const feedUrl = 'https://follow-builders-feed-url/x-feed.json';
// 筛选指定账号
const accounts = ['alexalbert__', 'rauchg', ...];
```

#### AI HOT API
```bash
# 精选模式
curl -H "User-Agent: Mozilla/5.0..." \
  "https://aihot.virxact.com/api/public/items?mode=selected&take=30"
```

### 2. AI 处理（Claude API）

#### 摘要翻译 Prompt
```markdown
# 任务
将以下英文内容翻译成中文摘要，150字以内。

# 要求
- 保留关键信息（产品名、数字、核心能力）
- 口语化，适合快速阅读
- 突出"为什么重要"

# 内容
{content}
```

#### 全文翻译 Prompt
```markdown
# 任务
将以下英文文章完整翻译成中文。

# 要求
- 准确传达原文意思
- 保持技术术语的专业性
- 自然流畅，适合中文读者
- 如有列表、标题，保持格式

# 内容
{content}
```

### 3. 网页实现

#### 技术栈
- HTML5
- CSS3（Flexbox/Grid布局）
- Vanilla JavaScript（无框架）
- 本地 HTTP 服务器（Node.js http-server）

#### 关键功能
```javascript
// 按需翻译
async function translateArticle(articleId) {
  const article = articles.find(a => a.id === articleId);
  if (!article.translation) {
    // 调用后端 API 翻译
    article.translation = await fetch('/api/translate', {
      method: 'POST',
      body: JSON.stringify({ content: article.content })
    }).then(r => r.json());
  }
  renderTranslation(article);
}

// 保存到 Obsidian
async function saveToObsidian(article) {
  await fetch('/api/save', {
    method: 'POST',
    body: JSON.stringify({ article })
  });
  showNotification('已保存到 Obsidian');
}
```

---

## 十三、关键决策说明

### 为什么不做全自动翻译？
- ✅ 降低成本（按需翻译）
- ✅ 用户能读英文（AI 产品人基本能力）
- ✅ 真正有价值的内容会主动深读
- ✅ 摘要翻译已足够筛选

### 为什么不做复杂分类？
- ✅ AI HOT 的分类已足够
- ✅ 避免过度设计
- ✅ 用户看标题也能快速判断

### 为什么选择这15个信息源？
- ✅ 覆盖官方动态（3大厂）
- ✅ 产品商业视角（10个核心人物）
- ✅ 补充广度（AI HOT）
- ✅ 数量适中（每天20-30条）

### 为什么不做分享稿生成？
- ✅ 第一版聚焦核心流程
- ✅ 待验证是否真正需要
- ✅ 留待 Phase 2 根据反馈决定

---

## 十四、成功指标

### 短期指标（1-2周）
- 能稳定每日生成内容
- 用户每天实际使用
- 保存到 Obsidian 的内容 > 3条/天

### 中期指标（1个月）
- 信息源质量稳定（跳过率 < 50%）
- 形成使用习惯（每日打开）
- Obsidian 积累 > 50 篇笔记

### 长期指标（3个月）
- 产出内容创作素材
- 产生产品灵感
- 形成个人知识库

---

## 十五、风险与应对

### 风险1：信息源失效
- **应对**：多源冗余，单个源失效不影响整体

### 风险2：API 限流
- **应对**：合理控制请求频率，使用缓存

### 风险3：翻译质量不佳
- **应对**：优化 prompt，必要时切换模型

### 风险4：维护成本高
- **应对**：第一版极简，确认有效后再扩展

---

## 附录：参考资源

### 相关项目
- Follow Builders: https://github.com/zarazhangrui/follow-builders
- Khazix Skills (AI HOT): https://github.com/KKKKhazix/khazix-skills
- AI HOT 网站: https://aihot.virxact.com

### 技术文档
- Claude API: https://docs.anthropic.com/
- Agent Skills 标准: https://agentskills.io
- Obsidian: https://obsidian.md

---

**文档版本：** v1.0  
**最后更新：** 2026-07-06  
**下一步：** 开始 Phase 1 MVP 实现
