# AI Insight Personal Hub - 完整架构设计

**创建日期**: 2026-07-08  
**版本**: v1.0  
**目标**: 构建个人化 AI 信息工作台，服务于内容创作和产品开发

---

## 一、系统定位

### 1.1 核心价值主张

**不是**：AI 资讯聚合器（AI HOT 已经做了）  
**而是**：个人化的 AI 信息工作台 + 知识炼金术

**价值链**：
```
信息过载 (100条) 
    ↓ 筛选
个性化推荐 (15-20条)
    ↓ 理解
产品启发 + 应用场景
    ↓ 沉淀
知识库 (Obsidian)
    ↓ 创造
内容创作 + 产品构思
```

### 1.2 与 AI HOT 的差异

| 维度 | AI HOT | 你的系统 |
|-----|--------|---------|
| 定位 | 大众信息广场 | 个人工作台 |
| 内容量 | 100+ 条 | 15-20 条精选 |
| 筛选 | 通用算法 | 学习你的偏好 |
| 分析 | 无 | 产品视角深度分析 |
| 沉淀 | 无 | 导出到 Obsidian |
| 创作 | 无 | 二次加工生成 |

---

## 二、系统架构

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────┐
│                  用户交互层                          │
│  Web UI (React/Vue) + CLI (可选)                    │
└─────────────────────────────────────────────────────┘
                      ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────┐
│                  API 服务层                          │
│  Express.js + RESTful API                           │
│  ├─ /api/items - 获取内容                            │
│  ├─ /api/feedback - 记录反馈                         │
│  ├─ /api/analyze - 深度分析                          │
│  ├─ /api/topics - 主题聚合                           │
│  └─ /api/export - 导出到 Obsidian                   │
└─────────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────────┐
│                  核心业务层                          │
│  ├─ FilterEngine - 筛选引擎                         │
│  ├─ PreferenceLearner - 偏好学习                    │
│  ├─ TopicDetector - 主题识别                        │
│  ├─ ContentAnalyzer - 内容分析                      │
│  └─ ExportManager - 导出管理                        │
└─────────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────────┐
│                  数据源适配层                        │
│  ├─ AIHotAdapter - AI HOT API                       │
│  ├─ GitHubAdapter - GitHub Trending                 │
│  ├─ CustomAdapter - 自定义源                        │
│  └─ InboxAdapter - 手工收件箱                        │
└─────────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────────┐
│                  数据持久层                          │
│  ├─ SQLite - 结构化数据                             │
│  ├─ JSON Files - 配置和缓存                         │
│  └─ Obsidian Vault - 知识沉淀                       │
└─────────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────────┐
│                  外部服务层                          │
│  ├─ LLM API (Claude/ChatGPT/DeepSeek)              │
│  ├─ AI HOT API                                      │
│  └─ GitHub API                                      │
└─────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
[获取阶段]
外部数据源 → 适配器标准化 → 原始数据存储

[筛选阶段]
原始数据 → 规则筛选 → 偏好学习 → 推荐队列

[分析阶段]
推荐内容 → 主题识别 → LLM分析 → 分析结果缓存

[交互阶段]
用户浏览 → 反馈收集 → 偏好更新 → 下次推荐

[沉淀阶段]
保存操作 → Markdown生成 → Obsidian导出
```

---

## 三、核心模块设计

### 3.1 筛选引擎 (FilterEngine)

**职责**: 从 100 条筛选到 15-20 条

**算法**:
```javascript
function calculateScore(item, userPreferences) {
  let score = 0;
  
  // 1. 关键词匹配 (30分)
  score += matchKeywords(item, userPreferences.keywords) * 30;
  
  // 2. 分类偏好 (25分)
  score += matchCategory(item, userPreferences.categories) * 25;
  
  // 3. 数据源权重 (20分)
  score += matchSource(item, userPreferences.sources) * 20;
  
  // 4. AI HOT 自带分数 (15分)
  score += (item.score / 100) * 15;
  
  // 5. 新鲜度 (10分)
  score += calculateFreshness(item.pub_date) * 10;
  
  return score;
}
```

**优化方向**:
- Phase 1: 简单规则匹配
- Phase 2: 加入历史反馈权重
- Phase 3: 协同过滤（如果有多用户）

### 3.2 偏好学习 (PreferenceLearner)

**职责**: 从用户反馈中学习偏好

**数据结构**:
```javascript
{
  keywords: {
    "agent": { weight: 0.85, count: 12 },
    "product": { weight: 0.78, count: 8 },
    "cost": { weight: 0.72, count: 6 }
  },
  categories: {
    "tip": { weight: 0.9, count: 15 },
    "ai-products": { weight: 0.7, count: 10 }
  },
  sources: {
    "aihot": { weight: 0.8, count: 50 },
    "github": { weight: 0.6, count: 20 }
  },
  patterns: [
    {
      description: "喜欢成本优化相关内容",
      keywords: ["cost", "optimize", "降低"],
      confidence: 0.85
    }
  ]
}
```

**学习策略**:
- Approve/Save: 权重 +0.1
- Ignore: 权重 -0.05
- Skip: 权重 -0.02
- 权重范围: [0, 1]

### 3.3 主题识别 (TopicDetector)

**职责**: 识别相关内容并聚合

**算法**:
```
1. 提取每篇内容的关键词
2. 计算内容之间的相似度
3. 使用聚类算法分组
4. 生成主题标签
```

**实现方式**:
- **Phase 1**: TF-IDF + 余弦相似度
- **Phase 2**: 调用 LLM 做语义聚类
- **Phase 3**: 向量数据库 (如 ChromaDB)

**成本控制**:
- 只对当天内容聚类（100条以内）
- 缓存聚类结果
- 相似度阈值可调

### 3.4 内容分析 (ContentAnalyzer)

**职责**: 生成产品启发、应用场景等

**Prompt 设计**:
```markdown
# 角色
你是一位有10年经验的 AI 产品经理

# 任务
分析以下内容，从产品视角给出洞察

# 内容
标题: {{title}}
摘要: {{summary}}
分类: {{category}}

# 输出格式 (JSON)
{
  "product_insights": [
    "具体的产品启发1",
    "具体的产品启发2"
  ],
  "use_cases": [
    {
      "scenario": "场景描述",
      "target_user": "目标用户",
      "pain_point": "解决什么痛点",
      "solution": "怎么解决"
    }
  ],
  "business_model": ["可能的变现方式1", "可能的变现方式2"],
  "technical_feasibility": {
    "difficulty": "low|medium|high",
    "tech_stack": ["技术1", "技术2"],
    "timeline": "预估时间"
  }
}

# 要求
- 启发要具体，不要泛泛而谈
- 场景要真实，不要凭空想象
- 数据要有根据，不要瞎编
```

**成本优化**:
- 单篇分析: ~$0.02 (1k tokens)
- 只对"保存"的内容做完整分析
- 快速启发可以用缓存模板

### 3.5 主题追踪 (TopicTracker)

**职责**: 持续追踪用户关注的主题

**数据结构**:
```javascript
{
  id: "topic-001",
  name: "多智能体架构",
  keywords: ["agent", "multi-agent", "orchestrator"],
  created_at: "2026-07-08",
  status: "active",
  notification_settings: {
    frequency: "realtime", // realtime | daily | weekly
    channels: ["web", "email"]
  },
  related_topics: ["prompt-engineering", "cost-optimization"],
  stats: {
    total_items: 12,
    saved_items: 5,
    last_update: "2026-07-08T15:30:00Z"
  }
}
```

**实现**:
- 新内容到达 → 匹配追踪主题 → 触发通知
- 每周生成主题进展报告
- 自动发现关联主题

---

## 四、数据模型

### 4.1 数据库设计 (SQLite)

```sql
-- 内容表
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  summary TEXT,
  category TEXT,
  pub_date DATETIME,
  score INTEGER,
  raw_data JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户反馈表
CREATE TABLE feedbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  action TEXT NOT NULL, -- approve, ignore, save, skip
  context JSON, -- 用户当时的状态（如查询条件等）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- 主题表
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keywords TEXT, -- JSON array
  status TEXT DEFAULT 'active',
  settings JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 主题-内容关联表
CREATE TABLE topic_items (
  topic_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  relevance REAL, -- 0-1
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (topic_id, item_id),
  FOREIGN KEY (topic_id) REFERENCES topics(id),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- 分析缓存表
CREATE TABLE analysis_cache (
  item_id TEXT PRIMARY KEY,
  analysis_type TEXT NOT NULL, -- quick | full
  result JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- 导出记录表
CREATE TABLE exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  export_path TEXT NOT NULL,
  export_type TEXT DEFAULT 'obsidian',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- 索引
CREATE INDEX idx_items_category ON items(category);
CREATE INDEX idx_items_pub_date ON items(pub_date DESC);
CREATE INDEX idx_feedbacks_action ON feedbacks(action);
CREATE INDEX idx_feedbacks_created_at ON feedbacks(created_at DESC);
```

### 4.2 配置文件结构

**config/preferences.json**
```json
{
  "filters": {
    "categories": ["ai-products", "tip", "industry"],
    "keywords": {
      "include": ["agent", "product", "cost"],
      "exclude": ["paper", "research"]
    },
    "sources": {
      "aihot": { "enabled": true, "weight": 1.0 },
      "github": { "enabled": false, "weight": 0.8 }
    },
    "min_score": 60,
    "max_items": 20
  },
  "learned": {
    "keyword_weights": {},
    "category_weights": {},
    "source_weights": {},
    "last_updated": "2026-07-08T10:00:00Z"
  }
}
```

---

## 五、技术栈选型

### 5.1 后端

| 技术 | 选择 | 理由 |
|------|------|------|
| **运行时** | Node.js | 现有代码基于 Node.js |
| **Web 框架** | Express.js | 轻量、生态成熟 |
| **数据库** | SQLite | 单用户足够，无需部署 |
| **ORM** | better-sqlite3 | 性能好，同步 API 简单 |
| **任务调度** | node-cron | 定时获取数据 |

### 5.2 前端

| 技术 | 选择 | 理由 |
|------|------|------|
| **框架** | React | 组件化，生态丰富 |
| **状态管理** | Zustand | 比 Redux 简单 |
| **UI 库** | Tailwind CSS | 快速开发 |
| **图表** | Recharts | 主题图谱可视化 |
| **HTTP** | Fetch API | 原生支持 |

### 5.3 AI 服务

| 服务 | 用途 | 成本 |
|------|------|------|
| **Claude API** | 内容分析、主题聚合 | $0.015/1k tokens (input) |
| **ChatGPT API** | 备选方案 | $0.01/1k tokens |
| **DeepSeek API** | 低成本方案 | $0.001/1k tokens |

**策略**:
- 快速分析用 DeepSeek
- 深度分析用 Claude
- 用户可选择跳转到 ChatGPT/Claude

---

## 六、API 设计

### 6.1 核心 API

```javascript
// 获取推荐内容
GET /api/items?limit=20&category=tip
Response: {
  items: [...],
  total: 98,
  filtered: 20,
  topics: [...]
}

// 记录反馈
POST /api/feedback
Body: {
  item_id: "xxx",
  action: "save|approve|ignore|skip"
}

// 深度分析
POST /api/analyze
Body: {
  item_ids: ["xxx", "yyy"],
  analysis_type: "quick|full|compare",
  prompt: "optional custom prompt"
}

// 主题相关
GET /api/topics
GET /api/topics/:id/items
POST /api/topics/:id/track
DELETE /api/topics/:id/untrack

// 导出
POST /api/export
Body: {
  item_ids: ["xxx"],
  format: "obsidian|markdown|json",
  options: {}
}
```

### 6.2 WebSocket 事件

```javascript
// 实时推送
ws.on('new_item', (item) => {})
ws.on('topic_update', (topic) => {})
ws.on('analysis_complete', (result) => {})
```

---

## 七、部署架构

### 7.1 本地开发模式

```
┌─────────────────┐
│   开发机器       │
│                 │
│  ├─ Backend     │ → http://localhost:3000
│  ├─ Frontend    │ → http://localhost:5173
│  ├─ SQLite      │ → ./data/app.db
│  └─ Obsidian    │ → ~/Documents/Obsidian/
└─────────────────┘
```

**启动**:
```bash
npm run dev:backend  # 后端
npm run dev:frontend # 前端
```

### 7.2 生产部署（可选）

```
┌─────────────────────────────────┐
│   云服务器 (VPS)                 │
│                                 │
│  ├─ Nginx (反向代理)             │
│  ├─ Node.js (PM2)               │
│  ├─ SQLite                      │
│  └─ 定时任务 (cron)              │
└─────────────────────────────────┘
         ↕
┌─────────────────────────────────┐
│   本地 Obsidian                  │
│   (通过 rsync 同步)              │
└─────────────────────────────────┘
```

---

## 八、成本估算

### 8.1 开发成本

| 模块 | 工作量 | 说明 |
|------|--------|------|
| **MVP 核心** | 3-5 天 | 筛选、展示、保存 |
| **偏好学习** | 2 天 | 反馈收集、权重计算 |
| **主题识别** | 3 天 | 聚类算法、可视化 |
| **内容分析** | 2 天 | LLM 集成、Prompt 优化 |
| **主题追踪** | 2 天 | 通知系统、报告生成 |
| **二次创作** | 3 天 | 模板系统、内容生成 |
| **总计** | 15-20 天 | 分阶段实施 |

### 8.2 运营成本

| 项目 | 月成本 | 说明 |
|------|--------|------|
| **LLM API** | $5-20 | 取决于使用量 |
| **VPS** | $0 (本地) / $5 (部署) | 可选 |
| **域名** | $0 (本地) / $10/年 | 可选 |
| **总计** | $5-30/月 | 主要是 API 费用 |

---

## 九、风险与应对

### 9.1 技术风险

| 风险 | 影响 | 应对 |
|------|------|------|
| **主题聚合不准确** | 用户体验差 | 提供手动调整，不强制使用 |
| **LLM API 限流** | 功能不可用 | 多服务商备份，本地缓存 |
| **SQLite 性能** | 数据量大时变慢 | 分表、索引优化、定期清理 |
| **前端加载慢** | 用户流失 | 懒加载、虚拟滚动 |

### 9.2 产品风险

| 风险 | 影响 | 应对 |
|------|------|------|
| **用户不用** | 系统无价值 | MVP 快速验证，及时调整 |
| **AI HOT 依赖** | 数据源失效 | 多数据源，自定义源 |
| **偏好学习失效** | 推荐不准 | 保留手动筛选，学习可关闭 |

---

## 十、优先级与路线图

### 10.1 优先级定义

| 优先级 | 定义 | 验证方式 |
|--------|------|---------|
| **P0** | 没有就不能用 | 系统无法启动 |
| **P1** | 核心价值功能 | 用户留存关键 |
| **P2** | 重要但非必须 | 提升体验 |
| **P3** | 锦上添花 | 长期优化 |

### 10.2 功能优先级

```
P0 (必须):
├─ 数据获取 (AI HOT)
├─ 基础筛选
├─ Web 展示
└─ 基础反馈收集

P1 (核心):
├─ 偏好学习
├─ Obsidian 导出
├─ 快速分析
└─ 主题聚合（简单版）

P2 (重要):
├─ 主题图谱可视化
├─ 深度分析（LLM）
├─ 主题追踪
└─ GitHub 数据源

P3 (锦上添花):
├─ 二次创作
├─ 协同过滤
├─ 移动端适配
└─ 多语言支持
```


---

## 十一、分阶段实施计划

### Phase 1: MVP 核心（Week 1-2）

**目标**: 验证核心价值 - 筛选是否准确，用户是否会用

**功能**:
```
✅ 数据获取
  - AI HOT API 集成
  - 数据标准化存储

✅ 基础筛选
  - 规则匹配（关键词、分类）
  - Top 20 推荐

✅ Web 界面
  - 内容列表展示
  - 分类 Tab
  - 单篇查看

✅ 基础交互
  - 👍 有用
  - 💾 保存（导出 Markdown）
  - ⏭️ 跳过

✅ 反馈存储
  - 记录到 SQLite
```

**技术方案**:
- 后端: Express.js + SQLite
- 前端: React + Tailwind CSS
- 无 LLM 调用（降低成本）

**验证标准**:
- [ ] 每天推荐的 20 条中，有 >70% 你觉得有价值
- [ ] 你连续使用 3 天以上
- [ ] 保存的内容 >5 条/周

**时间**: 5-7 天

---

### Phase 2: 智能化（Week 3-4）

**前置条件**: Phase 1 验证通过，有 >20 条反馈数据

**功能**:
```
✅ 偏好学习
  - 从反馈中提取偏好
  - 计算关键词/分类权重
  - 个性化评分

✅ 快速分析
  - 调用 LLM 生成产品启发
  - 只对"保存"的内容做完整分析
  - 结果缓存

✅ 主题聚合（简单版）
  - TF-IDF 提取关键词
  - 余弦相似度计算
  - 简单分组展示

✅ 优化导出
  - 自动生成 Obsidian 笔记
  - 包含分析结果
  - 标签自动化
```

**新增 API**:
- `POST /api/analyze` - 内容分析
- `GET /api/preferences` - 查看学到的偏好
- `GET /api/topics` - 今日主题

**验证标准**:
- [ ] 推荐准确率提升到 >80%
- [ ] LLM 分析有实际启发
- [ ] 主题聚合 >50% 准确

**时间**: 5-7 天

---

### Phase 3: 深度功能（Week 5-8）

**前置条件**: Phase 2 用户满意，愿意深度使用

**功能**:
```
✅ 主题图谱可视化
  - 节点表示主题
  - 连线表示关联
  - 点击展开详情

✅ 主题追踪
  - 订阅感兴趣的主题
  - 新内容推送
  - 周报生成

✅ 批量分析
  - 选中多篇内容
  - 对比分析
  - 生成综合报告

✅ GitHub 数据源
  - GitHub Trending 集成
  - 项目深度分析
  - README 提取

✅ 深度对话集成
  - 一键跳转 Claude Code
  - 自动填充上下文
  - 对话历史记录
```

**验证标准**:
- [ ] 主题图谱有实际价值
- [ ] 追踪功能被使用
- [ ] GitHub 项目分析准确

**时间**: 10-15 天

---

### Phase 4: 创作工具（Week 9-12）

**前置条件**: 知识库积累 >50 篇内容

**功能**:
```
✅ 二次创作
  - 基于内容生成公众号文章
  - 生成产品方案文档
  - 生成技术调研报告

✅ 想法池
  - 从内容中提取产品 idea
  - 标记可行性
  - 追踪进展

✅ 内容管理
  - 草稿管理
  - 版本控制
  - 发布工作流
```

**验证标准**:
- [ ] 生成的内容可用
- [ ] 产出 >2 篇文章
- [ ] 产品 idea >5 个

**时间**: 15-20 天

---

## 十二、MVP 详细设计

### 12.1 目录结构

```
ai-insight-hub/
├── backend/                 # 后端服务
│   ├── src/
│   │   ├── api/            # API 路由
│   │   │   ├── items.js
│   │   │   ├── feedback.js
│   │   │   └── export.js
│   │   ├── core/           # 核心业务
│   │   │   ├── filter.js
│   │   │   ├── preference.js
│   │   │   └── export.js
│   │   ├── adapters/       # 数据源适配器
│   │   │   └── aihot.js
│   │   ├── db/             # 数据库
│   │   │   ├── schema.sql
│   │   │   └── db.js
│   │   └── server.js       # 入口
│   ├── data/               # 数据文件
│   │   ├── app.db
│   │   └── cache/
│   └── package.json
│
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── components/    # 组件
│   │   │   ├── ItemCard.jsx
│   │   │   ├── ItemList.jsx
│   │   │   ├── FilterPanel.jsx
│   │   │   └── StatsBar.jsx
│   │   ├── pages/         # 页面
│   │   │   ├── Home.jsx
│   │   │   └── Settings.jsx
│   │   ├── services/      # API 调用
│   │   │   └── api.js
│   │   ├── store/         # 状态管理
│   │   │   └── store.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── public/
│   └── package.json
│
├── shared/                 # 共享代码
│   ├── types.ts           # TypeScript 类型
│   └── constants.js       # 常量
│
├── docs/                   # 文档
│   ├── ARCHITECTURE.md
│   ├── MVP.md
│   └── API.md
│
├── scripts/               # 工具脚本
│   ├── init-db.js        # 初始化数据库
│   ├── fetch-daily.js    # 定时任务
│   └── migrate.js        # 数据迁移
│
└── package.json          # 根配置
```

### 12.2 MVP 核心代码示例

**后端 - 筛选引擎**:
```javascript
// backend/src/core/filter.js
import { loadPreferences } from './preference.js';

export function filterItems(items, userPreferences) {
  // 1. 计算每条内容的分数
  const scored = items.map(item => ({
    ...item,
    score: calculateRelevanceScore(item, userPreferences)
  }));
  
  // 2. 排序
  scored.sort((a, b) => b.score - a.score);
  
  // 3. 取 Top 20
  return scored.slice(0, 20);
}

function calculateRelevanceScore(item, prefs) {
  let score = 0;
  
  // 关键词匹配
  const titleLower = item.title.toLowerCase();
  const summaryLower = (item.summary || '').toLowerCase();
  
  prefs.keywords.include.forEach(keyword => {
    if (titleLower.includes(keyword) || summaryLower.includes(keyword)) {
      score += 15;
    }
  });
  
  prefs.keywords.exclude.forEach(keyword => {
    if (titleLower.includes(keyword)) {
      score -= 20;
    }
  });
  
  // 分类匹配
  if (prefs.categories.includes(item.category)) {
    score += 25;
  }
  
  // AI HOT 自带分数
  score += (item.score || 50) * 0.3;
  
  return Math.max(0, Math.min(100, score));
}
```

**前端 - 内容卡片**:
```jsx
// frontend/src/components/ItemCard.jsx
export function ItemCard({ item, onFeedback }) {
  return (
    <div className="border rounded-lg p-6 hover:shadow-lg transition">
      {/* 标题 */}
      <h3 className="text-xl font-bold mb-2">{item.title}</h3>
      
      {/* 元信息 */}
      <div className="flex gap-2 mb-4 text-sm">
        <span className="px-2 py-1 bg-blue-100 rounded">
          {item.source}
        </span>
        <span className="px-2 py-1 bg-purple-100 rounded">
          {item.category}
        </span>
        <span className="text-gray-500">
          {formatTime(item.pub_date)}
        </span>
      </div>
      
      {/* 摘要 */}
      <p className="text-gray-700 mb-4 line-clamp-3">
        {item.summary}
      </p>
      
      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button 
          onClick={() => onFeedback(item.id, 'approve')}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          👍 有用
        </button>
        
        <button 
          onClick={() => onFeedback(item.id, 'save')}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          💾 保存
        </button>
        
        <button 
          onClick={() => onFeedback(item.id, 'skip')}
          className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
        >
          ⏭️ 跳过
        </button>
        
        <a 
          href={item.url} 
          target="_blank"
          className="px-4 py-2 border rounded hover:bg-gray-50"
        >
          🔗 原文
        </a>
      </div>
    </div>
  );
}
```

### 12.3 启动流程

**开发环境**:
```bash
# 1. 初始化数据库
npm run init-db

# 2. 启动后端
cd backend && npm run dev
# → http://localhost:3000

# 3. 启动前端
cd frontend && npm run dev
# → http://localhost:5173

# 4. 获取今日数据
npm run fetch-daily
```

**使用流程**:
```bash
# 每天早上
npm run fetch-daily  # 获取并筛选数据

# 打开浏览器
open http://localhost:5173

# 浏览、反馈、保存
# ...

# 查看保存的笔记
ls ~/Documents/Obsidian/AI-Insights/2026-07/
```

---

## 十三、成功指标

### 13.1 MVP 阶段（Week 1-2）

**使用指标**:
- [ ] 连续使用天数 ≥ 3 天
- [ ] 每天浏览时间 ≥ 5 分钟
- [ ] 保存内容 ≥ 3 条/天

**质量指标**:
- [ ] 推荐准确率 ≥ 70%
- [ ] 保存率（save/total） ≥ 15%
- [ ] 跳过率（skip/total） ≤ 50%

### 13.2 Phase 2（Week 3-4）

**使用指标**:
- [ ] 连续使用 ≥ 7 天
- [ ] 偏好数据 ≥ 50 条反馈
- [ ] Obsidian 笔记 ≥ 20 篇

**质量指标**:
- [ ] 推荐准确率 ≥ 80%
- [ ] LLM 分析被保存率 ≥ 60%
- [ ] 主题聚合准确率 ≥ 50%

### 13.3 长期目标（3 个月）

**产出指标**:
- [ ] 内容创作 ≥ 5 篇
- [ ] 产品 idea ≥ 10 个
- [ ] Obsidian 笔记 ≥ 100 篇

**习惯养成**:
- [ ] 每天打开系统
- [ ] 形成固定使用时间
- [ ] 产生实际价值（文章/产品）

---

## 十四、关键决策记录

### 决策 #001: 不做通用平台，只做个人工具

**背景**: 考虑是否支持多用户

**决策**: 只做单用户

**理由**:
- 减少复杂度（无需权限、账号系统）
- 专注个性化（不需要考虑通用性）
- 快速迭代（本地部署，无服务器成本）

---

### 决策 #002: 主题聚合不用 LLM（Phase 1）

**背景**: 主题聚合可以用 TF-IDF 或 LLM

**决策**: Phase 1 用 TF-IDF，Phase 2 考虑 LLM

**理由**:
- 降低成本（100 条内容两两对比 = 4950 次 LLM 调用）
- TF-IDF 够用（聚类准确率 50% 也能接受）
- 可以后续优化

---

### 决策 #003: 使用 SQLite 而非 JSON 文件

**背景**: 数据存储方案选择

**决策**: 用 SQLite

**理由**:
- 结构化查询（方便按时间、分类筛选）
- 性能更好（大数据量时）
- 支持事务（数据一致性）
- 迁移成本低（后续可换 PostgreSQL）

---

### 决策 #004: 前端用 React 而非纯 HTML

**背景**: 前端技术选型

**决策**: 用 React

**理由**:
- 组件化（便于复用和维护）
- 状态管理（复杂交互需要）
- 生态丰富（UI 库、工具链）
- 学习成本可接受

---

## 十五、FAQ

**Q: 为什么不用向量数据库？**  
A: Phase 1 用不到。如果 Phase 2/3 需要语义搜索，再考虑 ChromaDB 等。

**Q: 为什么不做移动端？**  
A: 信息筛选是桌面场景，移动端优先级低。Phase 3 可以考虑响应式适配。

**Q: 能不能支持其他知识库（Notion/Logseq）？**  
A: 可以。导出逻辑抽象成接口，实现不同的 Exporter。

**Q: AI 分析的成本会不会很高？**  
A: 可控。只对"保存"的内容做完整分析，预计 $5-10/月。

**Q: 主题图谱真的有用吗？**  
A: 不确定。所以放在 Phase 3，先验证其他核心功能。

**Q: 能不能离线使用？**  
A: 部分可以。数据获取需要网络，但浏览、筛选、导出都可以离线。

---

## 十六、总结

这是一个**渐进式、价值驱动**的架构设计：

1. **Phase 1 (MVP)**: 验证核心价值 - 筛选是否准确
2. **Phase 2**: 加入智能 - 偏好学习、LLM 分析
3. **Phase 3**: 深度功能 - 图谱、追踪、GitHub
4. **Phase 4**: 创作工具 - 二次加工、内容生成

**核心原则**:
- ✅ 每个阶段独立验证
- ✅ 不确定的功能延后
- ✅ 用户反馈驱动迭代
- ✅ 成本可控，价值可见

**下一步**: 开始实施 MVP（Week 1-2）

---

**文档版本**: v1.0  
**最后更新**: 2026-07-08  
**维护者**: @heyuxuan
