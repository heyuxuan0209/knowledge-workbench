# AI Insight Hub - 开发交接文档

**交接时间**: 2026-07-08  
**交接对象**: Sonnet 5  
**项目阶段**: 需求和架构设计完成，准备进入开发阶段

---

## 一、快速开始

### 如果你是 Sonnet 5，从这里开始：

1. **阅读本文档** (15分钟)
2. **查看 PRD**: `AI-INSIGHT-HUB-PRD.md` (30分钟)
3. **查看现有项目结构**: `ls -la /Users/USER/Documents/项目/knowledge-workbench`
4. **开始开发 MVP**: 按照第六章节的开发计划执行

---

## 二、项目背景

### 2.1 用户是谁

- **角色**: AI 产品人
- **背景**: 有足够时间投入，每天愿意花 1-2 小时使用这个系统
- **现有习惯**: 刷 X、看公众号、看 AI HOT 推送的信息
- **核心需求**: 从信息过载中找到对产品/内容创作有价值的启发

### 2.2 核心问题

用户每天面对 AI HOT 100+ 条资讯，存在以下痛点：

1. **信息过载**: 不知道哪些内容值得看
2. **主题散落**: 同一话题的内容分散在不同时间，难以追踪
3. **缺少深度研究工具**: 想对比分析多篇文章，但没有好工具
4. **知识难以沉淀**: 看完就忘，没有形成知识积累
5. **从看到创作的鸿沟**: 很难从"看内容"转化为"创作内容"

### 2.3 核心使用场景

**场景1: 主题追踪 + 深度研究 + 二次创作**

> 从 AI HOT 每天的推文中找到我感兴趣的话题，把同一话题的推文、博文等放在一起，以周/月为单位追踪某个 topic，挑选出一些进行深度研究，激发我的二次创作。我可能会在产品中直接使用 LLM 创作，也可能跳转到 ChatGPT、Claude 链接中让他们帮我分析这些文章。

**场景2: GitHub 项目发现 + 产品启发**

> 通过推送的 GitHub 高星和热门项目，追踪的 X 平台 AI builders，对我的产品产生一些启发。我不想从0造轮子，而是想知道市面上有哪些开源项目可以复用或者二次魔改。

---

## 三、产品定位

### 3.1 核心定位

**不是**: AI 资讯聚合器（AI HOT 已经做了）  
**而是**: 个人化的 AI 信息工作台 + 知识炼金术

### 3.2 与 AI HOT 的差异

| 维度 | AI HOT | AI Insight Hub |
|-----|--------|----------------|
| 定位 | 大众信息广场 | 个人工作台 |
| 内容量 | 100+ 条/天 | 15-20 条精选/天 |
| 筛选 | 通用算法 | 学习个人偏好 |
| 组织方式 | 分类标签 | **主题追踪**（周/月维度）|
| 深度功能 | 无 | **研究工作区**（多篇对比分析）|
| 项目关联 | 无 | **GitHub 项目匹配** |
| 知识沉淀 | 无 | 导出到 Obsidian |
| 创作支持 | 无 | 一键发送到 ChatGPT/Claude |

### 3.3 核心价值链

```
AI HOT 信息源 (100+条/天)
    ↓ 个性化筛选
精选推荐 (15-20条)
    ↓ 主题自动聚类
主题追踪 (周/月维度)
    ↓ 深度研究
多篇对比分析 + GitHub项目匹配
    ↓ 创作辅助
发送到 ChatGPT/Claude 或 导出 Obsidian
    ↓ 知识沉淀
内容创作 + 产品构思
```

---

## 四、核心设计决策

### 决策 #1: 三栏布局（主题工作流模式）

**为什么**: 用户有足够时间投入，需要信息密度高、功能完整的界面

```
┌──────────────────┬────────────────────────┬──────────────────────────┐
│ 📌 追踪的主题     │  📰 今日内容            │  🔬 研究工作区            │
│  (左侧)          │  (中间)                │  (右侧)                  │
│                  │                        │                          │
│ 主题列表          │ 当前主题的内容列表      │ 深度研究 + 创作辅助       │
│ - 本周热门        │ - 标题 + 摘要          │ - 已选内容               │
│ - 我的追踪        │ - 来源 + 评分          │ - AI 综合分析            │
│ - 预设主题        │ - 推荐理由             │ - 相关 GitHub 项目       │
│ - 已归档          │ - 操作按钮             │ - 发送到 ChatGPT/Claude  │
└──────────────────┴────────────────────────┴──────────────────────────┘
```

### 决策 #2: 复用 AI HOT 数据

**为什么**: 不重复造轮子

- ✅ 直接使用 AI HOT API
- ✅ 已有中文摘要（避免翻译成本）
- ✅ 已有分类和评分
- ✅ 专注于"筛选 + 主题追踪 + 深度研究"

### 决策 #3: 混合主题识别方案

**为什么**: 平衡准确性和成本

```
关键词提取（本地，快速，成本$0）
    ↓
相似度计算（本地，快速，成本$0）
    ↓
初步聚类（本地，快速，成本$0）
    ↓
LLM 验证和命名（仅对候选主题，成本可控）
    ↓
用户确认（可选，提高准确性）
```

**成本估算**: 每天 $0.01-0.02

### 决策 #4: 不做极简 MVP

**为什么**: 用户明确表示"不要再做极简的 MVP 了"

- ✅ 用户有足够时间投入
- ✅ 需要"能用起来"的完整产品
- ✅ 包含 Web 前端 + 后端 + 反馈学习

### 决策 #5: 首次使用引导

**为什么**: 解决冷启动问题

1. 兴趣标注（选择感兴趣的领域）
2. 基于兴趣推荐今日内容
3. 用户标记"感兴趣"时自动创建主题
4. 系统持续学习用户偏好

---

## 五、技术架构

### 5.1 技术栈

**前端**:
- React 18+
- Tailwind CSS
- Zustand (状态管理)
- React Query (数据获取)

**后端**:
- Node.js 18+ + Express
- SQLite + better-sqlite3
- node-cron (定时任务)

**AI 服务**:
- DeepSeek API (主要，成本低)
- Claude API (可选，深度分析)

### 5.2 数据库表（核心）

```sql
-- 内容表
items (id, source, title, url, summary, category, score, pub_date, 
       extracted_keywords, user_action, created_at, updated_at)

-- 主题表
topics (id, name, description, keywords, status, total_items, 
        items_this_week, items_this_month, is_tracking, created_at)

-- 主题-内容关联
topic_items (topic_id, item_id, relevance, is_confirmed, added_method)

-- 用户偏好
user_preferences (id, type, key, weight, count, updated_at)

-- 研究工作区
research_workspaces (id, topic_id, name, description, ai_analysis)
research_items (workspace_id, item_id, sort_order, notes)

-- GitHub 项目（Phase 2）
github_projects (id, name, full_name, description, url, stars, ...)
user_needs (id, name, description, target_user, ...)
need_project_matches (need_id, project_id, match_score, analysis)
```

完整 schema 见 `AI-INSIGHT-HUB-PRD.md` 第三章节。

### 5.3 核心 API

```
GET  /api/items              # 获取推荐内容
POST /api/feedback           # 记录用户反馈
GET  /api/topics             # 获取主题列表
POST /api/topics             # 创建主题追踪
GET  /api/topics/:id         # 获取主题详情
POST /api/research           # 创建研究工作区
POST /api/generate-prompt    # 生成 ChatGPT 提示词
POST /api/export             # 导出到 Obsidian
```

完整 API 设计见 PRD 第五章节。

### 5.4 核心算法

**内容筛选算法**:
```javascript
recommendScore = 
  关键词匹配 (40%) + 
  分类匹配 (30%) + 
  AI HOT 评分 (20%) + 
  来源权重 (10%)
```

**主题识别算法**:
```javascript
1. 提取关键词（TF-IDF）
2. 计算余弦相似度
3. 聚类（相似度 > 0.75）
4. LLM 验证和命名（DeepSeek API）
5. 用户确认（可选）
```

**偏好学习算法**:
```javascript
动作权重：
- interested: +0.15 (关键词), +0.10 (分类)
- saved: +0.20 (关键词), +0.15 (分类)
- not_interested: -0.10 (关键词), -0.08 (分类)
- skipped: -0.05 (关键词), -0.03 (分类)
```

代码示例见 PRD 第四章节。

---

## 六、MVP 开发计划 (Phase 1)

### 6.1 目标

**时间**: Week 1-2 (12-15 天)

**验证标准**:
- 推荐准确率 >70%
- 主题识别准确率 >60%
- 用户连续使用 3 天以上
- 每天保存内容 >2 条

### 6.2 功能范围

**包含**:
1. ✅ 首次使用引导（兴趣标注）
2. ✅ AI HOT 数据获取和存储
3. ✅ 基于偏好的内容筛选和推荐
4. ✅ 主题自动识别（关键词 + LLM 验证）
5. ✅ 主题工作流界面（三栏式）
6. ✅ 用户反馈收集（感兴趣/不感兴趣/保存）
7. ✅ 简单的研究工作区（选中内容列表）
8. ✅ 发送到 ChatGPT/Claude（生成提示词 + 跳转）
9. ✅ 导出到 Obsidian（Markdown 格式）

**不包含** (Phase 2+):
- ❌ GitHub 项目匹配
- ❌ AI 综合分析（对比多篇文章）
- ❌ 日报/周报视图
- ❌ 项目匹配视图
- ❌ 高级可视化

### 6.3 推荐开发顺序

**Day 1-2: 项目初始化 + 数据获取**
```bash
# 创建项目结构
mkdir -p ai-insight-hub-v2/{backend,frontend}
cd ai-insight-hub-v2

# 后端
cd backend
npm init -y
npm install express better-sqlite3 node-cron axios dotenv

# 前端
cd ../frontend
npm create vite@latest . -- --template react
npm install zustand @tanstack/react-query axios tailwindcss

# 数据库初始化
创建 backend/src/db/schema.sql
实现 backend/src/db/init.js

# AI HOT API 集成
实现 backend/src/services/aihot.js
测试数据获取
```

**Day 3: 内容筛选引擎**
```bash
# 实现关键词提取
npm install natural stopword

# 实现筛选算法
backend/src/core/filter.js
backend/src/core/nlp-utils.js

# 实现偏好学习
backend/src/core/preference-learner.js

# API 实现
backend/src/api/items.js
backend/src/api/feedback.js
```

**Day 4-5: 主题识别**
```bash
# LLM 集成（DeepSeek）
backend/src/services/llm.js

# 主题识别算法
backend/src/core/topic-identifier.js

# API 实现
backend/src/api/topics.js

# 测试主题识别效果
```

**Day 6: 首次使用引导（前端）**
```bash
# 兴趣标注组件
frontend/src/components/onboarding/InterestSelector.jsx
frontend/src/components/onboarding/FirstTimeGuide.jsx

# 首页路由
frontend/src/pages/OnboardingPage.jsx

# 状态管理
frontend/src/store/userStore.js
```

**Day 7-9: 主题工作流界面（前端）**
```bash
# 主布局
frontend/src/components/layout/MainLayout.jsx
frontend/src/pages/HomePage.jsx

# 左侧：主题列表
frontend/src/components/topic/TopicList.jsx
frontend/src/components/topic/TopicCard.jsx

# 中间：内容池
frontend/src/components/content/ContentList.jsx
frontend/src/components/content/ContentCard.jsx

# 右侧：研究工作区
frontend/src/components/research/ResearchWorkspace.jsx

# API 集成
frontend/src/services/api.js
frontend/src/hooks/useTopics.js
frontend/src/hooks/useContents.js
```

**Day 10-11: 研究工作区 + 生成提示词**
```bash
# 后端
backend/src/api/research.js
backend/src/api/generate-prompt.js
backend/src/core/prompt-generator.js

# 前端
frontend/src/components/research/PromptModal.jsx
frontend/src/utils/chatgpt-url.js
```

**Day 12: 导出到 Obsidian**
```bash
# 后端
backend/src/api/export.js
backend/src/core/markdown-generator.js

# 前端
frontend/src/components/export/ExportModal.jsx
```

**Day 13-15: 测试 + 优化 + 文档**
```bash
# 端到端测试
# Bug 修复
# 性能优化
# 用户文档编写
```

### 6.4 目录结构

```
ai-insight-hub-v2/
├── backend/
│   ├── src/
│   │   ├── api/              # API 路由
│   │   │   ├── items.js
│   │   │   ├── feedback.js
│   │   │   ├── topics.js
│   │   │   ├── research.js
│   │   │   ├── generate-prompt.js
│   │   │   └── export.js
│   │   ├── core/             # 核心业务逻辑
│   │   │   ├── filter.js
│   │   │   ├── topic-identifier.js
│   │   │   ├── preference-learner.js
│   │   │   ├── nlp-utils.js
│   │   │   ├── prompt-generator.js
│   │   │   └── markdown-generator.js
│   │   ├── services/         # 外部服务
│   │   │   ├── aihot.js
│   │   │   └── llm.js
│   │   ├── db/               # 数据库
│   │   │   ├── schema.sql
│   │   │   ├── init.js
│   │   │   └── db.js
│   │   ├── config/           # 配置
│   │   │   └── constants.js
│   │   └── server.js         # 入口文件
│   ├── data/                 # 数据存储
│   │   └── app.db
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   ├── onboarding/
│   │   │   ├── topic/
│   │   │   ├── content/
│   │   │   ├── research/
│   │   │   └── export/
│   │   ├── pages/
│   │   │   ├── OnboardingPage.jsx
│   │   │   ├── HomePage.jsx
│   │   │   └── SettingsPage.jsx
│   │   ├── store/
│   │   │   ├── userStore.js
│   │   │   ├── topicStore.js
│   │   │   └── contentStore.js
│   │   ├── hooks/
│   │   │   ├── useTopics.js
│   │   │   ├── useContents.js
│   │   │   └── useFeedback.js
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── utils/
│   │   │   ├── format.js
│   │   │   └── chatgpt-url.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── docs/
│   ├── AI-INSIGHT-HUB-PRD.md
│   ├── ARCHITECTURE-V2.md
│   └── HANDOFF.md (本文档)
│
└── README.md
```

---

## 七、关键 Prompts

### 7.1 主题识别 Prompt

```
以下 N 篇文章是否属于同一主题？

1. 标题: [标题1]
   摘要: [摘要1]

2. 标题: [标题2]
   摘要: [摘要2]

...

返回 JSON 格式：
{
  "is_same_topic": true/false,
  "topic_name": "主题名称",
  "confidence": 0-1,
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "reason": "为什么认为是/不是同一主题"
}
```

### 7.2 生成 ChatGPT 提示词 Prompt

```
我正在研究 [主题名称]，收集了以下 N 篇文章：

1. [标题]
   来源: [来源]
   核心内容: [摘要]

2. ...

请帮我：
1. 总结这些文章的共同观点和差异点
2. 从产品视角分析，有哪些可落地的应用场景
3. 如果我要做 [相关产品]，应该重点关注哪些功能
4. 目前市面上有哪些开源项目可以参考或二次开发
```

---

## 八、约束条件

### 8.1 必须遵守

1. **用户数据本地存储**: 所有数据存在 SQLite，不上传到云端
2. **成本可控**: 月度 LLM API 成本控制在 $10 以内
3. **单用户设计**: 不需要考虑多用户、权限等
4. **响应速度**: 主界面加载 <2秒
5. **AI HOT API 调用频率**: 每小时最多1次

### 8.2 技术约束

1. **不要使用**: Monorepo, Turborepo, 独立的 fetcher service
2. **数据库**: 只用 SQLite，不要 PostgreSQL/MySQL
3. **前端框架**: React，不要 Vue/Angular
4. **AI 服务**: 优先 DeepSeek API（成本低），可选 Claude API

### 8.3 避免过度设计

1. 不要做"完美"的类型系统（TypeScript 够用就行）
2. 不要做复杂的权限控制（单用户不需要）
3. 不要做完整的测试覆盖（手动测试核心流程即可）
4. 不要做完美的错误处理（MVP 阶段能用即可）

---

## 九、未解决问题

### 9.1 需要在开发中决策

1. **关键词提取算法选择**
   - 选项A: TF-IDF (simple, 够用)
   - 选项B: TextRank (更准确，但复杂)
   - 建议: 先用 TF-IDF，Phase 2 再优化

2. **主题相似度阈值**
   - 当前设置: 0.75
   - 需要根据实际效果调整

3. **推荐内容数量**
   - 当前设置: Top 20
   - 可能需要根据用户反馈调整

### 9.2 Phase 2 考虑

1. **主题生命周期管理**: 什么时候归档主题？
2. **间歇性使用**: 用户3天不用，再打开应该看到什么？
3. **GitHub 项目匹配准确性**: 如何确保推荐的项目真的可用？

---

## 十、重要提醒

### 10.1 用户期望

- ✅ 用户有足够时间投入（每天 1-2 小时）
- ✅ 用户需要"能用起来"的完整产品，不是玩具
- ✅ 用户会提供反馈，系统需要能学习和自生长
- ✅ Web 前端必须做，后端必须做，不能只是脚本

### 10.2 成功关键

1. **主题识别准确性**: 这是核心价值，必须做好
2. **推荐准确性**: 第一周能达到 70% 就算成功
3. **用户体验流畅**: 不要让用户等待（异步处理 LLM 调用）
4. **偏好学习有效**: 随着使用，推荐应该越来越准

### 10.3 开发建议

1. **先跑通端到端**: Day 1-2 就要能从 AI HOT 获取数据并显示
2. **每天都要能 demo**: 每天结束时都应该有可运行的版本
3. **遇到问题及时沟通**: 不要自己猜用户需求
4. **代码质量适度**: MVP 阶段重点是验证价值，不是完美代码

---

## 十一、参考资料

### 11.1 已有代码

```
/Users/USER/Documents/项目/knowledge-workbench/
├── ai-insight-hub/        # v1 原型（参考）
│   ├── scripts/          # 数据获取脚本
│   ├── data/             # 示例数据
│   └── output/           # HTML 输出示例
├── ai-insight-hub-v2/    # 新系统（待开发）
└── docs/                 # 文档
    ├── brief.md
    ├── ARCHITECTURE.md (旧版)
    ├── AI-INSIGHT-HUB-PRD.md (新版)
    ├── ARCHITECTURE-V2.md (新版)
    └── HANDOFF.md (本文档)
```

### 11.2 AI HOT API

```bash
# 获取今日内容
curl "https://aihot.virxact.com/api/public/items?take=100" \
  -H "User-Agent: Mozilla/5.0"

# 返回格式
{
  "count": 100,
  "hasNext": true,
  "items": [
    {
      "id": "...",
      "title": "...",
      "title_en": "...",
      "url": "...",
      "summary": "...",
      "category": "tip|industry|ai-products|ai-models|paper",
      "score": 80,
      "source": "...",
      "publishedAt": "2026-07-08T10:00:00Z"
    }
  ]
}
```

### 11.3 DeepSeek API

```bash
# 申请地址: https://platform.deepseek.com/

# API 调用示例
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'

# 成本: $0.001 / 1k tokens
```

### 11.4 Obsidian 导出路径

```bash
# 用户的 Obsidian Vault
~/Documents/Obsidian/llm-wiki/

# 建议导出路径
~/Documents/Obsidian/llm-wiki/ai-insights/[主题名称]/[日期]/
```

---

## 十二、联系方式

### 如果遇到问题

1. **不确定需求**: 直接询问用户 @heyuxuan
2. **技术选型**: 参考本文档第五章节
3. **API 设计**: 参考 PRD 第五章节
4. **算法实现**: 参考 PRD 第四章节

---

## 十三、检查清单

开始开发前，请确认：

- [ ] 已阅读完本文档
- [ ] 已查看 AI-INSIGHT-HUB-PRD.md
- [ ] 已了解用户的核心需求
- [ ] 已理解三栏布局设计
- [ ] 已理解主题识别算法
- [ ] 已理解偏好学习机制
- [ ] 已准备好 DeepSeek API Key
- [ ] 已规划好开发顺序

开始开发！

---

**交接完成时间**: 2026-07-08  
**文档版本**: v1.0  
**祝开发顺利！** 🚀
