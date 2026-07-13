# 项目当前状态

**更新时间**: 2026-07-09 15:30  
**当前阶段**: MVP 探索期  
**代码状态**: 可运行，功能部分完整

---

## 快速理解

### 一句话描述
个人化的 AI 资讯工作台，从信息消费到内容创作的完整流程

### 核心流程
```
AI HOT 资讯 → 筛选标记 → 主题追踪 → 工作区研究 → LLM 对话 → 内容生成 → 发布
```

### 当前进度
- ✅ 数据获取（AI HOT API）
- ✅ 列表页 + 搜索功能
- ✅ 文章详情页（基础版）
  - ✅ 推荐理由展示
  - ✅ AI 摘要卡片
  - ✅ 文章标签
  - ✅ 中英文切换
- ⏳ 富文本正文（待接入 AI HOT 详情 API）
- ❌ 工作区对话（未开始）
- ❌ 主题追踪（未开始）
- ❌ 知识图谱（未开始）

---

## 架构概览

### 技术栈
- **前端**: React 18 + Vite + Tailwind CSS
- **后端**: Node.js 26 + Express
- **数据库**: SQLite (node:sqlite 内置模块)
- **数据源**: AI HOT 公开 API

### 目录结构
```
knowledge-workbench/
├── backend/
│   ├── src/
│   │   ├── server.js           # Express 服务器
│   │   ├── db/                 # 数据库
│   │   └── services/           # AI HOT 数据同步
│   └── data/app.db             # SQLite 数据库
│
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── pages/
    │   │   └── WorkspacePage.jsx    # 三栏主页面
    │   └── components/workspace/
    │       ├── Sidebar.jsx          # 左侧导航
    │       ├── MainContent.jsx      # 中间列表/详情
    │       ├── ArticleDetail.jsx    # 文章详情
    │       └── SearchBar.jsx        # 搜索框
    └── package.json
```

---

## 最近的重大变更

### 2026-07-09: UI 重设计
- **变更**: 深色主题 → 浅色主题，emoji → SVG 图标
- **原因**: 用户反馈深色主题不专业，emoji 不适合工作场景
- **影响**: 所有组件重新配色，使用 Heroicons SVG
- **详见**: `iterations/2026-07-09-ui-redesign.md`

### 2026-07-08: 项目初始化
- **变更**: 从零开始搭建前后端
- **技术选择**: Node.js 26 内置 sqlite，放弃 better-sqlite3
- **原因**: better-sqlite3 在 Node 26 编译失败
- **详见**: `iterations/2026-07-08-mvp.md`

---

## 已知的坑

### 1. AI HOT API 数据不完整
**问题**: `/api/public/items` 端点只返回基础字段（标题、摘要、评分），无完整正文、推荐理由、真实标签  
**影响**: 详情页无法显示富文本正文、真实的推荐理由和标签  
**临时方案**: 使用 mock 数据占位，显示提示文案  
**长期方案**: 需要研究 AI HOT 的详情 API 端点（可能需要认证）

### 2. Tailwind CSS 样式不生效
**问题**: 修改代码后热更新，样式突然丢失  
**原因**: `tailwind.config.js` 的 `content` 路径配置错误  
**解决**: 确保配置包含 `"./src/**/*.{js,jsx,ts,tsx}"`  
**预防**: 每次创建新目录后检查 tailwind 配置

### 3. React 组件导入路径问题
**问题**: `import ArticleDetail from './ArticleDetail'` 报错  
**原因**: 文件实际路径不对，或者组件没有 export default  
**解决**: 使用 IDE 的自动导入功能，确保相对路径正确

### 4. 前端服务端口冲突
**问题**: 后端和前端都想用 3000 端口  
**解决**: 后端用 3000，前端用 5173（Vite 默认），配置 proxy

---

## 如果你是新 AI 接手

### 第一步：快速了解
1. 读完本文档（5分钟）
2. 看 `handoff/TODO.md` 了解当前任务
3. 读 `docs/DECISIONS.md` 了解关键决策

### 第二步：启动项目
```bash
# 后端（Terminal 1）
cd /Users/USER/Documents/项目/knowledge-workbench/ai-insight-hub-v2/backend
node src/server.js

# 前端（Terminal 2）
cd /Users/USER/Documents/项目/knowledge-workbench/ai-insight-hub-v2/frontend
npm run dev

# 访问：http://localhost:5173
```

### 第三步：了解代码
- 入口：`frontend/src/App.jsx`
- 主页面：`frontend/src/pages/WorkspacePage.jsx`
- 关键组件：`frontend/src/components/workspace/`

### 第四步：查看已踩的坑
见本文档"已知的坑"部分 + `handoff/PITFALLS.md`

---

## 当前可用功能

### 列表页
- ✅ 显示 AI HOT 文章列表
- ✅ 搜索（标题、摘要、来源）
- ✅ 筛选（分类、排序）
- ✅ 精选标签显示
- ✅ 评分徽章

### 详情页
- ✅ 文章标题（中英文）
- ✅ 来源、时间、精选标签
- ✅ 推荐理由（mock 数据）
- ✅ AI 摘要卡片
- ✅ 文章标签（mock 数据）
- ✅ 中英文切换按钮（针对正文）
- ✅ 操作按钮：查看原文、在 AI HOT 查看、保存、加入工作区、导出 Markdown

---

## 数据源情况

### AI HOT API
- **端点**: `https://aihot.virxact.com/api/public/items?take=50`
- **可用字段**: id, title, title_en, summary, source, publishedAt, category, score, selected, url, permalink
- **缺失字段**: 完整正文、推荐理由、真实标签、多信源聚合

### 本地数据库
- **位置**: `backend/data/app.db`
- **记录数**: 100 条
- **表结构**: 7 张表（items, topics, topic_items, user_preferences, research_workspaces, research_items, user_settings）
- **同步机制**: 手动调用 `/api/sync` 端点

---

## 下一步开发

见 `handoff/TODO.md`
