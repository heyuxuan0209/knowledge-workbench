# 新会话交接文档

**创建时间**: 2026-07-09 16:45  
**当前版本**: v0.1.0  
**下一步**: 开发 v0.2.0 工作区对话功能

---

## 🚀 快速开始（5 分钟）

### 1. 项目位置
```bash
cd /Users/USER/Documents/项目/knowledge-workbench/
```

### 2. 启动服务
```bash
# Terminal 1 - 后端
cd backend && node src/server.js

# Terminal 2 - 前端  
cd frontend && npm run dev
```

### 3. 访问应用
http://localhost:5173/

---

## 📊 当前状态

### ✅ 已完成（v0.1.0）
- 三栏工作台架构（左侧导航 + 中间内容 + 右侧面板）
- 浅色主题设计（#fafaf9 + stone 色系）
- SVG 图标系统（Heroicons）
- AI HOT 数据源集成
- 文章列表页（搜索、筛选、评分显示）
- 文章详情页（推荐理由、AI 摘要、标签、中英文切换）
- 项目重组（代码在根目录，文档规范化）
- Git 仓库初始化，打上 v0.1.0 标签

### ⏳ 进行中
- 设计方案综合分析（已完成文档）
- v0.2.0 规划（工作区对话功能）

### ❌ 未实现
- 工作区对话（核心功能）
- 主题追踪
- 知识图谱
- LLM 集成（Deepseek/Claude）

---

## 📂 项目结构

```
knowledge-workbench/
├── backend/              # 后端代码 (7.5M)
│   ├── src/
│   │   ├── server.js     # Express 服务器
│   │   ├── db/           # SQLite 数据库
│   │   └── services/     # AI HOT 数据同步
│   └── data/app.db       # 数据库文件（100 条记录）
│
├── frontend/             # 前端代码 (74M)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   └── WorkspacePage.jsx    # 三栏主页面
│   │   └── components/workspace/
│   │       ├── Sidebar.jsx          # 左侧导航
│   │       ├── MainContent.jsx      # 中间内容
│   │       ├── ArticleDetail.jsx    # 文章详情
│   │       └── SearchBar.jsx        # 搜索框
│   └── package.json
│
├── docs/                 # 核心文档
│   ├── README.md
│   └── DECISIONS.md      # 5 个 ADR 决策记录
│
├── handoff/              # 交接文档
│   ├── QUICK-START.md    # 快速上手
│   ├── CONTEXT.md        # 项目当前状态
│   ├── TODO.md           # 待办事项
│   └── NEW-SESSION-HANDOFF.md  # 本文件
│
├── iterations/           # 迭代记录
│   ├── 2026-07-09-ui-redesign.md
│   └── README.md
│
├── explorations/         # 探索记录
│   └── design-options/
│       └── comprehensive-comparison.md  # 设计方案对比
│
└── planning/
    └── PRD.md
```

---

## 🎯 下一步：开发 v0.2.0 工作区对话

### 目标
实现核心差异化功能：工作区对话 + LLM 集成

### 时间
2 周

### 关键任务

#### Week 1: 基础架构
1. **数据库设计**
   ```sql
   CREATE TABLE workspaces (
     id TEXT PRIMARY KEY,
     name TEXT,
     created_at TIMESTAMP
   );
   
   CREATE TABLE conversations (
     id TEXT PRIMARY KEY,
     workspace_id TEXT,
     title TEXT,
     llm_provider TEXT,
     created_at TIMESTAMP
   );
   
   CREATE TABLE messages (
     id TEXT PRIMARY KEY,
     conversation_id TEXT,
     role TEXT,
     content TEXT,
     tokens_used INTEGER,
     cost_yuan REAL,
     created_at TIMESTAMP
   );
   ```

2. **后端 API**
   ```
   POST   /api/workspaces
   GET    /api/workspaces/:id
   POST   /api/conversations
   GET    /api/conversations/:id
   POST   /api/conversations/:id/messages
   POST   /api/llm/deepseek
   ```

3. **前端组件**
   ```
   src/components/workspace/
   ├── ChatInterface.jsx       # 对话界面
   ├── MessageList.jsx         # 消息列表
   ├── MessageInput.jsx        # 输入框
   ├── MaterialsPanel.jsx      # 材料面板
   └── OutputsPanel.jsx        # 产出面板
   ```

#### Week 2: 完善功能
4. **流式输出**（SSE）
5. **右侧面板**（上下文材料 + 产出结果）
6. **LLM 切换器**（Deepseek/Claude）
7. **成本统计**
8. **测试和优化**

### 技术选型

| 组件 | 选择 | 原因 |
|------|------|------|
| LLM 主力 | Deepseek | 便宜，¥1/M tokens |
| LLM 备选 | Claude API | 高质量 |
| 流式输出 | SSE | 简单可靠 |
| Markdown | react-markdown | 已安装 |
| 状态管理 | useState/Context | 够用 |

---

## 📖 必读文档

**优先级顺序**：

1. **本文件**（你正在读）- 5 分钟
2. `handoff/CONTEXT.md` - 项目当前状态（10 分钟）
3. `explorations/design-options/comprehensive-comparison.md` - 设计方案对比（15 分钟）
4. `handoff/TODO.md` - 详细待办清单（5 分钟）
5. `docs/DECISIONS.md` - 重大决策记录（10 分钟）

**总计 45 分钟即可完全了解项目**

---

## 🔑 关键决策

### 决策 1: 不重构，迭代式融合
- ✅ 保留当前浅色主题和架构
- ✅ 逐步添加核心功能
- ❌ 不推倒重来

### 决策 2: 优先工作区对话
- ✅ 这是核心竞争力
- ✅ 与 AI HOT 的差异化
- ❌ 其他功能延后

### 决策 3: LLM 成本控制
- ✅ Deepseek 为主（¥100/月预算）
- ✅ Claude 备选（高质量任务）
- ✅ 可跳转到 Claude.ai/ChatGPT

### 决策 4: 技术债务优先级
- ⚠️  推荐理由和标签是 mock 数据（中优先级）
- ⚠️  富文本正文待接入（中优先级）
- ❌ 移动端优化（低优先级）
- ❌ 向量数据库（暂不需要）

---

## 🐛 已知问题

### 1. AI HOT API 数据不完整
- **问题**: 只返回基础字段，无完整正文
- **影响**: 详情页推荐理由和标签是 mock 数据
- **临时方案**: 使用占位数据
- **长期方案**: 研究详情 API（v0.3.0）

### 2. 右侧面板未充分利用
- **问题**: 当前只在推送模式显示快速操作
- **影响**: 空间浪费
- **解决**: v0.2.0 在对话模式显示材料和产出

### 3. 搜索功能简单
- **问题**: 仅前端过滤
- **影响**: 性能差
- **解决**: v0.3.0 后端全文搜索

---

## 💻 开发环境

### 技术栈
- **前端**: React 18 + Vite + Tailwind CSS
- **后端**: Node.js 26 + Express
- **数据库**: SQLite (node:sqlite)
- **数据源**: AI HOT API

### 端口
- 后端: 3000
- 前端: 5173

### 依赖
- 前端已安装: react, vite, tailwindcss, react-markdown
- 后端已安装: express, cors

### 待安装（v0.2.0）
```bash
# 后端
npm install openai  # Deepseek 兼容 OpenAI SDK

# 前端
# 无需额外依赖
```

---

## 🚨 注意事项

### 1. 代码风格
- 使用 Tailwind CSS，不写自定义 CSS
- 组件使用函数式 + Hooks
- 保持简洁，不过度抽象

### 2. Git 提交
- 每个功能独立提交
- Commit message: `feat/fix/docs: 描述`
- 重要节点打 tag（v0.2.0）

### 3. 文档更新
- 每次迭代完成后更新 `iterations/`
- 重大决策记录到 `docs/DECISIONS.md`
- 更新 `handoff/CONTEXT.md` 的当前状态

### 4. 成本控制
- 实时显示 LLM 使用成本
- 月度上限 ¥100
- 达到 80% 时提醒

---

## 🔧 故障排查

### 后端启动失败
```bash
lsof -ti:3000 | xargs kill
cd backend && node src/server.js
```

### 前端白屏
- 检查后端是否运行（http://localhost:3000/health）
- 清除浏览器缓存
- 检查 console 错误

### 数据库错误
```bash
cd backend
node src/db/init.js
node src/services/sync-aihot.js
```

---

## 📞 联系方式

如果遇到问题：
1. 查看 `handoff/CONTEXT.md` 的"已知的坑"部分
2. 查看 `iterations/2026-07-09-ui-redesign.md` 的"踩坑记录"
3. 查看 Git 历史：`git log --oneline`

---

## ✅ 验收清单（开始前确认）

- [ ] 能访问 http://localhost:5173/
- [ ] 能看到文章列表
- [ ] 能搜索文章
- [ ] 能点击文章查看详情
- [ ] 后端数据库有 100 条记录
- [ ] Git 状态干净（`git status`）

---

## 🎯 成功标准（v0.2.0 完成时）

- [ ] 可以创建工作区
- [ ] 可以在工作区创建对话
- [ ] 可以从推送页添加文章到对话
- [ ] 可以与 Deepseek 流式对话
- [ ] 可以查看对话历史
- [ ] 可以查看和复制产出
- [ ] 可以切换 LLM（Deepseek/Claude）
- [ ] 可以看到成本统计

---

## 📚 参考资料

- Deepseek API: https://platform.deepseek.com/docs
- Claude API: https://docs.anthropic.com/
- React-Markdown: https://github.com/remarkjs/react-markdown
- Tailwind CSS: https://tailwindcss.com/docs

---

**祝开发顺利！遇到问题先看文档，文档里有答案。**
