# AI Insight Hub - MVP 开发交接文档

**交接时间**: 2026-07-08  
**交接给**: Sonnet 5  
**文档目的**: 提供完整的 MVP 实施方案，可直接开始开发

---

## 一、快速理解

### 1.1 这是什么项目？

一个**个人化的 AI 信息工作台**，帮助用户：
1. 从 AI HOT 100 条内容中筛选出 15-20 条相关的
2. 快速浏览并保存到 Obsidian
3. 学习用户偏好，下次推荐更准确

**不是**：AI 资讯聚合器（AI HOT 已经做了）  
**而是**：个性化筛选 + 知识沉淀工具

### 1.2 核心价值

```
AI HOT 100条 → 你的系统筛选 → 推荐15-20条 → 用户5分钟看完 → 保存5条到 Obsidian
```

**价值**：节省时间 + 提高准确率 + 知识沉淀

### 1.3 MVP 范围

**只做 3 件事**：
1. ✅ **筛选**：从 100 条筛到 20 条
2. ✅ **展示**：Web 界面浏览
3. ✅ **保存**：导出到 Obsidian

**不做的**（后续阶段）：
- ❌ LLM 分析
- ❌ 主题图谱
- ❌ 主题追踪
- ❌ GitHub 数据源
- ❌ 二次创作

---

## 二、技术架构

### 2.1 技术栈

**后端**:
- Node.js + Express.js
- SQLite (better-sqlite3)
- node-fetch（调用 AI HOT API）

**前端**:
- React + Vite
- Tailwind CSS
- Zustand（状态管理）

**数据**:
- SQLite 数据库
- JSON 配置文件
- Markdown 导出文件

### 2.2 目录结构

```
ai-insight-hub/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── items.js       # GET /api/items
│   │   │   ├── feedback.js    # POST /api/feedback
│   │   │   └── export.js      # POST /api/export
│   │   ├── core/
│   │   │   ├── filter.js      # 筛选引擎
│   │   │   ├── preference.js  # 偏好管理
│   │   │   └── exporter.js    # Obsidian 导出
│   │   ├── adapters/
│   │   │   └── aihot.js       # AI HOT API 适配器
│   │   ├── db/
│   │   │   ├── schema.sql     # 数据库 Schema
│   │   │   └── db.js          # 数据库连接
│   │   └── server.js          # Express 服务器入口
│   ├── data/
│   │   ├── app.db             # SQLite 数据库
│   │   └── config.json        # 配置文件
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ItemCard.jsx   # 内容卡片
│   │   │   ├── ItemList.jsx   # 内容列表
│   │   │   └── Header.jsx     # 页头
│   │   ├── pages/
│   │   │   ├── Home.jsx       # 主页
│   │   │   └── Settings.jsx   # 设置页
│   │   ├── services/
│   │   │   └── api.js         # API 封装
│   │   ├── store/
│   │   │   └── store.js       # Zustand store
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   └── package.json
│
├── scripts/
│   ├── init-db.js             # 初始化数据库
│   └── fetch-daily.js         # 定时获取数据
│
├── docs/
│   ├── ARCHITECTURE.md        # 完整架构
│   └── MVP-HANDOFF.md         # 本文档
│
└── package.json               # 根 package.json
```

---

## 三、数据库设计

### 3.1 Schema

```sql
-- 内容表
CREATE TABLE items (
  id TEXT PRIMARY KEY,              -- AI HOT 的 item id
  source TEXT NOT NULL,             -- 'aihot'
  title TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  summary TEXT,                     -- AI HOT 的 summary
  category TEXT,                    -- tip, industry, ai-models 等
  pub_date TEXT,                    -- ISO 8601
  score INTEGER DEFAULT 0,          -- AI HOT 的 score
  relevance_score INTEGER DEFAULT 0, -- 我们计算的相关度分数
  raw_data TEXT,                    -- JSON 字符串，保存完整原始数据
  created_at TEXT DEFAULT (datetime('now'))
);

-- 用户反馈表
CREATE TABLE feedbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  action TEXT NOT NULL,             -- 'approve', 'save', 'skip'
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- 导出记录表
CREATE TABLE exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  export_path TEXT NOT NULL,        -- Obsidian 文件路径
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- 索引
CREATE INDEX idx_items_category ON items(category);
CREATE INDEX idx_items_relevance ON items(relevance_score DESC);
CREATE INDEX idx_items_created ON items(created_at DESC);
CREATE INDEX idx_feedbacks_action ON feedbacks(action);
CREATE INDEX idx_feedbacks_created ON feedbacks(created_at DESC);
```

### 3.2 配置文件 (config.json)

```json
{
  "preferences": {
    "keywords": {
      "include": ["agent", "product", "startup", "cost"],
      "exclude": ["paper", "research", "benchmark"]
    },
    "categories": ["ai-products", "tip", "industry"],
    "sources": {
      "aihot": {
        "enabled": true,
        "weight": 1.0
      }
    },
    "min_score": 60,
    "max_items": 20
  },
  "obsidian": {
    "vault_path": "~/Documents/Obsidian/AI-Insights",
    "folder_pattern": "{year}-{month}/{date}"
  },
  "aihot": {
    "api_url": "https://aihot.virxact.com/api/public/items",
    "mode": "selected",
    "take": 100
  }
}
```

---

## 四、API 设计

### 4.1 后端 API

```javascript
// 1. 获取推荐内容
GET /api/items?date=2026-07-08&limit=20

Response:
{
  "success": true,
  "data": {
    "items": [...],
    "total": 98,
    "filtered": 20,
    "date": "2026-07-08"
  }
}

// 2. 记录反馈
POST /api/feedback
Body: {
  "item_id": "cmrbdqlcv02y4ihl11xbxx9xs",
  "action": "save" // approve | save | skip
}

Response:
{
  "success": true,
  "message": "Feedback recorded"
}

// 3. 导出到 Obsidian
POST /api/export
Body: {
  "item_id": "cmrbdqlcv02y4ihl11xbxx9xs"
}

Response:
{
  "success": true,
  "data": {
    "file_path": "~/Documents/Obsidian/AI-Insights/2026-07/2026-07-08/claude-multi-agent.md"
  }
}

// 4. 获取统计
GET /api/stats

Response:
{
  "success": true,
  "data": {
    "total_items": 500,
    "total_feedbacks": 120,
    "saved_items": 45,
    "approve_rate": 0.75
  }
}

// 5. 获取偏好
GET /api/preferences

Response:
{
  "success": true,
  "data": {
    "keywords": {...},
    "categories": {...}
  }
}

// 6. 更新偏好
PUT /api/preferences
Body: {
  "keywords": {
    "include": ["agent", "product"],
    "exclude": ["paper"]
  }
}
```

---

## 五、核心算法

### 5.1 筛选算法

```javascript
// backend/src/core/filter.js

/**
 * 计算内容相关度分数
 * @param {Object} item - 内容项
 * @param {Object} preferences - 用户偏好
 * @returns {Number} 0-100 的分数
 */
function calculateRelevanceScore(item, preferences) {
  let score = 0;
  
  const titleLower = item.title.toLowerCase();
  const summaryLower = (item.summary || '').toLowerCase();
  const text = `${titleLower} ${summaryLower}`;
  
  // 1. 包含关键词 (+15 分/个，最多 30 分)
  let keywordScore = 0;
  preferences.keywords.include.forEach(keyword => {
    if (text.includes(keyword.toLowerCase())) {
      keywordScore += 15;
    }
  });
  score += Math.min(keywordScore, 30);
  
  // 2. 排除关键词 (-20 分/个)
  preferences.keywords.exclude.forEach(keyword => {
    if (text.includes(keyword.toLowerCase())) {
      score -= 20;
    }
  });
  
  // 3. 分类匹配 (+25 分)
  if (preferences.categories.includes(item.category)) {
    score += 25;
  }
  
  // 4. AI HOT 自带分数 (0-30 分)
  score += (item.score || 50) * 0.3;
  
  // 5. 新鲜度 (0-15 分)
  const hoursSincePublish = getHoursSince(item.pub_date);
  if (hoursSincePublish < 6) {
    score += 15;
  } else if (hoursSincePublish < 24) {
    score += 10;
  } else if (hoursSincePublish < 48) {
    score += 5;
  }
  
  // 限制在 0-100
  return Math.max(0, Math.min(100, score));
}

/**
 * 筛选并排序内容
 */
export function filterItems(items, preferences) {
  // 1. 计算分数
  const scored = items.map(item => ({
    ...item,
    relevance_score: calculateRelevanceScore(item, preferences)
  }));
  
  // 2. 过滤低分
  const filtered = scored.filter(
    item => item.relevance_score >= preferences.min_score
  );
  
  // 3. 排序
  filtered.sort((a, b) => b.relevance_score - a.relevance_score);
  
  // 4. 取 Top N
  return filtered.slice(0, preferences.max_items);
}
```

### 5.2 偏好学习算法

```javascript
// backend/src/core/preference.js

/**
 * 从反馈历史中学习偏好
 */
export function learnPreferences(feedbacks, items) {
  // 1. 分类反馈
  const approved = feedbacks.filter(f => f.action === 'approve' || f.action === 'save');
  const skipped = feedbacks.filter(f => f.action === 'skip');
  
  // 2. 提取关键词
  const approvedItems = approved.map(f => items.find(i => i.id === f.item_id));
  const skippedItems = skipped.map(f => items.find(i => i.id === f.item_id));
  
  // 3. 关键词频率统计
  const keywordCount = {};
  
  approvedItems.forEach(item => {
    if (!item) return;
    const words = extractKeywords(item.title + ' ' + item.summary);
    words.forEach(word => {
      keywordCount[word] = (keywordCount[word] || 0) + 1;
    });
  });
  
  skippedItems.forEach(item => {
    if (!item) return;
    const words = extractKeywords(item.title + ' ' + item.summary);
    words.forEach(word => {
      keywordCount[word] = (keywordCount[word] || 0) - 0.5;
    });
  });
  
  // 4. 排序取 Top 关键词
  const topKeywords = Object.entries(keywordCount)
    .filter(([word, count]) => count > 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);
  
  // 5. 分类偏好统计
  const categoryCount = {};
  approvedItems.forEach(item => {
    if (item && item.category) {
      categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
    }
  });
  
  const topCategories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat);
  
  return {
    keywords: {
      include: topKeywords,
      exclude: [] // 可以从 skipped 中提取
    },
    categories: topCategories,
    confidence: approved.length >= 10 ? 'high' : 'low'
  };
}

/**
 * 提取关键词（简单版本）
 */
function extractKeywords(text) {
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for'];
  
  return text
    .toLowerCase()
    .split(/[\s\-_,\.]+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .filter(word => !/^\d+$/.test(word)); // 排除纯数字
}
```

### 5.3 Obsidian 导出

```javascript
// backend/src/core/exporter.js

/**
 * 生成 Obsidian Markdown
 */
export function generateMarkdown(item) {
  const date = new Date(item.pub_date || item.created_at);
  
  return `---
title: ${item.title}
source: ${item.source}
category: ${item.category || 'unknown'}
url: ${item.url}
date: ${date.toISOString().split('T')[0]}
score: ${item.score || 0}
relevance: ${item.relevance_score || 0}
tags:
  - ai-insights
  - ${item.category || 'uncategorized'}
created: ${new Date().toISOString()}
---

# ${item.title}

## 📊 元信息

- **来源**: ${item.source}
- **分类**: ${item.category || '未分类'}
- **发布时间**: ${formatDate(item.pub_date)}
- **AI HOT 评分**: ${item.score || 'N/A'}
- **相关度**: ${item.relevance_score || 0}/100

## 📝 摘要

${item.summary || '暂无摘要'}

## 🔗 原文链接

${item.url}

## 💭 我的想法

<!-- 在这里添加你的笔记和想法 -->

---

**保存时间**: ${new Date().toLocaleString('zh-CN')}
`;
}

/**
 * 导出到 Obsidian
 */
export async function exportToObsidian(item, config) {
  const fs = require('fs').promises;
  const path = require('path');
  const os = require('os');
  
  // 1. 解析路径
  const vaultPath = config.obsidian.vault_path.replace('~', os.homedir());
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  const folderPath = path.join(vaultPath, `${year}-${month}`, `${year}-${month}-${day}`);
  
  // 2. 创建目录
  await fs.mkdir(folderPath, { recursive: true });
  
  // 3. 生成文件名（安全化）
  const safeName = item.title
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .substring(0, 50);
  const fileName = `${safeName}.md`;
  const filePath = path.join(folderPath, fileName);
  
  // 4. 生成内容
  const markdown = generateMarkdown(item);
  
  // 5. 写入文件
  await fs.writeFile(filePath, markdown, 'utf-8');
  
  return filePath;
}
```

---

## 六、开发步骤

### Step 1: 初始化项目（30分钟）

```bash
# 1. 创建项目结构
mkdir -p backend/src/{api,core,adapters,db}
mkdir -p backend/data
mkdir -p frontend/src/{components,pages,services,store}
mkdir -p scripts docs

# 2. 初始化 package.json
cd backend && npm init -y
npm install express better-sqlite3 node-fetch cors dotenv

cd ../frontend && npm init -y
npm install react react-dom
npm install -D vite @vitejs/plugin-react tailwindcss postcss autoprefixer
npm install zustand

# 3. 配置 Tailwind
npx tailwindcss init -p

# 4. 创建数据库
node scripts/init-db.js
```

### Step 2: 后端开发（4-6小时）

**优先级顺序**:
1. ✅ 数据库连接 (`db/db.js`)
2. ✅ AI HOT 适配器 (`adapters/aihot.js`)
3. ✅ 筛选引擎 (`core/filter.js`)
4. ✅ API 路由 (`api/*.js`)
5. ✅ Express 服务器 (`server.js`)

**测试点**:
```bash
# 测试 AI HOT API
curl http://localhost:3000/api/items

# 测试反馈
curl -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"item_id":"xxx","action":"save"}'
```

### Step 3: 前端开发（4-6小时）

**优先级顺序**:
1. ✅ API 封装 (`services/api.js`)
2. ✅ Store (`store/store.js`)
3. ✅ ItemCard 组件
4. ✅ ItemList 组件
5. ✅ Home 页面
6. ✅ 路由和入口

**测试点**:
- [ ] 能看到内容列表
- [ ] 能点击反馈按钮
- [ ] 能保存到 Obsidian

### Step 4: 集成测试（2小时）

1. ✅ 运行完整流程
2. ✅ 修复 bug
3. ✅ 优化样式
4. ✅ 编写 README

---

## 七、代码模板

### 7.1 Express 服务器入口

```javascript
// backend/src/server.js
import express from 'express';
import cors from 'cors';
import { itemsRouter } from './api/items.js';
import { feedbackRouter } from './api/feedback.js';
import { exportRouter } from './api/export.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 路由
app.use('/api/items', itemsRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/export', exportRouter);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
```

### 7.2 React 主页面

```jsx
// frontend/src/pages/Home.jsx
import { useEffect } from 'react';
import { useStore } from '../store/store';
import { ItemList } from '../components/ItemList';
import { Header } from '../components/Header';

export function Home() {
  const { items, loading, error, fetchItems, submitFeedback } = useStore();
  
  useEffect(() => {
    fetchItems();
  }, [fetchItems]);
  
  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="text-xl">加载中...</div>
    </div>;
  }
  
  if (error) {
    return <div className="flex items-center justify-center h-screen">
      <div className="text-xl text-red-500">错误: {error}</div>
    </div>;
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <ItemList 
          items={items} 
          onFeedback={submitFeedback}
        />
      </main>
    </div>
  );
}
```

### 7.3 Zustand Store

```javascript
// frontend/src/store/store.js
import { create } from 'zustand';
import * as api from '../services/api';

export const useStore = create((set, get) => ({
  items: [],
  loading: false,
  error: null,
  
  fetchItems: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.getItems();
      set({ items: data.items, loading: false });
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },
  
  submitFeedback: async (itemId, action) => {
    try {
      await api.submitFeedback(itemId, action);
      
      // 如果是 save，调用导出
      if (action === 'save') {
        await api.exportItem(itemId);
      }
      
      // 从列表中移除
      set(state => ({
        items: state.items.filter(item => item.id !== itemId)
      }));
    } catch (error) {
      console.error('Feedback error:', error);
    }
  }
}));
```

---

## 八、验证清单

### 8.1 功能验证

- [ ] 启动后端服务器成功
- [ ] 启动前端开发服务器成功
- [ ] 能获取 AI HOT 数据
- [ ] 能看到推荐的 20 条内容
- [ ] 能点击"有用"按钮，记录反馈
- [ ] 能点击"保存"按钮，导出到 Obsidian
- [ ] Obsidian 文件格式正确
- [ ] 能点击"跳过"按钮，内容消失
- [ ] 刷新页面后数据持久化

### 8.2 数据验证

- [ ] SQLite 数据库创建成功
- [ ] items 表有数据
- [ ] feedbacks 表能记录
- [ ] exports 表有记录
- [ ] config.json 能读取

### 8.3 性能验证

- [ ] 首次加载 < 2 秒
- [ ] 反馈响应 < 500ms
- [ ] 导出文件 < 1 秒

---

## 九、常见问题

### Q1: AI HOT API 调用失败怎么办？

**A**: 检查网络，添加 User-Agent header，使用缓存数据

```javascript
headers: {
  'User-Agent': 'Mozilla/5.0...',
  'Accept': 'application/json'
}
```

### Q2: Obsidian 路径找不到？

**A**: 检查 config.json 中的 vault_path，使用绝对路径

### Q3: 前端连不上后端？

**A**: 检查 CORS 配置，确保后端有 `cors()` 中间件

### Q4: 筛选结果为空？

**A**: 调低 min_score，检查 keywords 是否过于严格

### Q5: 数据库锁定错误？

**A**: 使用 WAL 模式：`PRAGMA journal_mode=WAL;`

---

## 十、交接检查清单

### 给 Sonnet 5 的检查清单

在开始开发前，确认以下内容：

- [ ] 已阅读 `ARCHITECTURE.md`
- [ ] 已阅读本文档 `MVP-HANDOFF.md`
- [ ] 理解项目目标和 MVP 范围
- [ ] 理解技术栈和目录结构
- [ ] 理解数据库设计
- [ ] 理解 API 设计
- [ ] 理解核心算法
- [ ] 准备好开发环境（Node.js, npm）

开始开发后：

- [ ] 按步骤创建项目结构
- [ ] 先开发后端，再开发前端
- [ ] 每个模块完成后测试
- [ ] 遇到问题查看本文档 FAQ
- [ ] 完成后运行验证清单

---

## 十一、预期输出

完成 MVP 后，用户应该能：

1. 运行 `npm run dev:backend` 启动后端
2. 运行 `npm run dev:frontend` 启动前端
3. 打开 `http://localhost:5173`
4. 看到今日推荐的 20 条内容
5. 点击"保存"后，在 Obsidian 中看到新笔记
6. 第二天运行后，推荐更准确

---

## 十二、后续阶段预告

MVP 完成并验证后，Phase 2 将增加：

1. 偏好学习（自动调整推荐）
2. LLM 分析（产品启发、应用场景）
3. 主题聚合（相关内容归类）

这些功能的详细设计在 `ARCHITECTURE.md` 中。

---

**文档版本**: v1.0  
**创建时间**: 2026-07-08  
**维护者**: Opus 4.8  
**接手者**: Sonnet 5

**祝开发顺利！** 🚀
