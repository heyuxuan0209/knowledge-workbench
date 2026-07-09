# Knowledge Workbench

个人 AI 资讯工作台 - 从信息到洞察的完整流程

---

## 📌 当前版本

**v0.2.0** - 工作区对话功能（2026-07-09）

---

## 🎯 项目定位

一个专注于深度分析的 AI 资讯工具，核心差异化功能：

1. **智能推送** - 基于兴趣的内容筛选（已完成）
2. **工作区对话** - 与 LLM 深度分析文章（已完成）
3. **主题追踪** - 长期追踪感兴趣的主题（未实现）
4. **知识图谱** - 可视化知识网络（未实现）

---

## ✨ 核心功能

### v0.1.0 - 基础信息浏览
- ✅ 三栏工作台架构
- ✅ AI HOT 数据源集成
- ✅ 文章列表和详情
- ✅ 搜索和筛选
- ✅ 评分显示

### v0.2.0 - 工作区对话
- ✅ 创建工作区
- ✅ 多对话管理
- ✅ Deepseek 流式对话
- ✅ 成本统计（¥1/M tokens）
- ✅ 材料和产出面板
- ⏳ API Key 配置（需用户提供）
- ⏳ 材料拖拽功能
- ⏳ 产出结构化展示

---

## 🚀 快速开始

### 1. 安装依赖

```bash
# 后端
cd backend
npm install

# 前端
cd frontend
npm install
```

### 2. 配置环境变量

```bash
cd backend
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY（从 https://platform.deepseek.com 获取）
```

### 3. 初始化数据库

```bash
cd backend
node src/db/init.js
node src/services/sync-aihot.js
sqlite3 data/app.db < src/db/schema-v2.sql
```

### 4. 启动服务

```bash
# 后端（Terminal 1）
cd backend && node src/server.js

# 前端（Terminal 2）
cd frontend && npm run dev
```

### 5. 访问应用

http://localhost:5173/

---

## 📂 项目结构

```
knowledge-workbench/
├── backend/              # 后端代码
│   ├── src/
│   │   ├── server.js     # Express 服务器
│   │   ├── db/           # 数据库
│   │   │   ├── schema.sql        # v0.1.0 表结构
│   │   │   ├── schema-v2.sql     # v0.2.0 新增表
│   │   │   ├── workspaces.js     # 工作区数据操作
│   │   │   └── db.js             # 基础数据操作
│   │   └── services/     # 业务服务
│   │       ├── llm.js            # LLM 集成
│   │       ├── stats.js          # 成本统计
│   │       └── sync-aihot.js     # AI HOT 同步
│   └── data/app.db       # SQLite 数据库
│
├── frontend/             # 前端代码
│   ├── src/
│   │   ├── App.jsx       # 路由入口
│   │   ├── pages/
│   │   │   ├── WorkspacePage.jsx        # 主页面
│   │   │   ├── WorkspaceListPage.jsx    # 工作区列表
│   │   │   ├── WorkspaceDetailPage.jsx  # 工作区详情
│   │   │   └── ConversationPage.jsx     # 对话页面
│   │   └── components/workspace/
│   │       ├── Sidebar.jsx              # 左侧导航
│   │       ├── MainContent.jsx          # 中间内容
│   │       ├── ChatInterface.jsx        # 聊天界面
│   │       ├── MaterialsPanel.jsx       # 材料面板
│   │       └── CostTracker.jsx          # 成本追踪
│   └── package.json
│
├── docs/                 # 核心文档
│   ├── README.md
│   └── DECISIONS.md      # 决策记录
│
├── handoff/              # 交接文档
│   ├── QUICK-CONTEXT.md
│   └── NEW-SESSION-HANDOFF.md
│
├── iterations/           # 迭代记录
│   ├── 2026-07-09-ui-redesign.md
│   └── 2026-07-09-v0.2.0-workspace-chat.md
│
└── planning/
    └── PRD.md
```

---

## 🛠 技术栈

### 后端
- Node.js 26 + Express
- SQLite (node:sqlite)
- OpenAI SDK（Deepseek 兼容）
- SSE（流式输出）

### 前端
- React 18 + Vite
- Tailwind CSS
- Axios
- react-markdown

---

## 💰 成本控制

### Deepseek 定价
- **价格**: ¥1/M tokens
- **预算**: ¥100/月
- **预警**: 80% 时提醒

### 使用建议
- 日常分析优先 Deepseek（便宜）
- 高质量写作考虑 Claude（可选）
- 超预算可跳转到 Claude.ai/ChatGPT

---

## 🔗 主要 API 端点

### 工作区
- `POST /api/workspaces` - 创建工作区
- `GET /api/workspaces` - 获取工作区列表
- `GET /api/workspaces/:id` - 获取工作区详情

### 对话
- `POST /api/conversations` - 创建对话
- `GET /api/conversations/:id` - 获取对话详情
- `POST /api/conversations/:id/messages` - 添加消息
- `POST /api/llm/chat` - 流式聊天（SSE）

### 统计
- `GET /api/stats/cost` - 成本统计

完整 API 文档见 [handoff/NEW-SESSION-HANDOFF.md](handoff/NEW-SESSION-HANDOFF.md)

---

## 📖 文档

- **快速上手**: [handoff/QUICK-CONTEXT.md](handoff/QUICK-CONTEXT.md)
- **完整交接**: [handoff/NEW-SESSION-HANDOFF.md](handoff/NEW-SESSION-HANDOFF.md)
- **决策记录**: [docs/DECISIONS.md](docs/DECISIONS.md)
- **迭代记录**: [iterations/](iterations/)

---

## 🐛 已知问题

1. **Deepseek API Key 需配置** - 需要用户自行申请和配置
2. **Token 计数为估算** - 实际成本可能有偏差
3. **材料拖拽未实现** - 无法从推送页添加文章到对话
4. **产出面板为占位** - 结构化产出功能未实现
5. **Claude API 未集成** - 只支持 Deepseek

---

## 🚧 Roadmap

### v0.2.1（本周）
- [ ] 配置 Deepseek API Key
- [ ] 完善材料拖拽功能
- [ ] 优化流式输出
- [ ] 错误处理完善

### v0.3.0（下周）
- [ ] 产出面板实现
- [ ] 主题追踪初版
- [ ] 完整正文接入
- [ ] 后端全文搜索

### v0.4.0（未来）
- [ ] 知识图谱
- [ ] Claude API 集成
- [ ] 移动端优化

---

**最后更新**: 2026-07-09  
**当前版本**: v0.2.0  
**下一步**: 配置 API Key 并测试完整流程
