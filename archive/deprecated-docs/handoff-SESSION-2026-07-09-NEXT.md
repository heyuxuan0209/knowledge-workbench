# 新会话交接文档 - v0.2.1 材料拖拽功能

**交接时间**: 2026-07-09 18:00  
**当前版本**: v0.2.0 ✅ 已完成并验证  
**下一步任务**: v0.2.1 材料拖拽功能开发

---

## 🚀 快速启动（2 分钟）

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
- 前端: http://localhost:5173/
- 后端: http://localhost:3000/

---

## ✅ v0.2.0 当前状态

### 已完成功能
1. ✅ **工作区管理** - 创建、列表、详情
2. ✅ **对话管理** - 创建、查看、多对话切换
3. ✅ **Deepseek 集成** - 流式对话、Token 统计
4. ✅ **成本控制** - 实时统计（¥1/M tokens）、¥100/月预算
5. ✅ **文章显示** - 列表、详情、标签、AI HOT 链接
6. ✅ **标签系统** - 使用 source + category（100% 覆盖）
7. ✅ **浏览器 CDP 测试** - 真实环境自动化测试

### 待完善功能（v0.2.1）
1. ⏳ **材料拖拽** - 从推送页拖拽文章到对话
2. ⏳ **产出面板** - 结构化展示分析结果
3. ⏳ **Claude API** - 备选高质量 LLM

---

## 🎯 下一步任务：材料拖拽功能

### 功能描述
**目标**: 让用户能从文章列表拖拽文章到对话，作为分析材料

**用户流程**:
1. 在文章列表页看到感兴趣的文章
2. 拖拽文章卡片
3. 进入工作区对话页面
4. 松手到材料面板，文章添加成功
5. 在材料列表中看到该文章
6. 点击材料快速引用到对话中

### 技术实现要点

#### 前端（React + HTML5 Drag & Drop）
1. **文章列表项**（`MainContent.jsx`）
   - 添加 `draggable={true}`
   - 实现 `onDragStart` - 存储文章 ID
   - 添加拖拽视觉反馈

2. **材料面板**（`MaterialsPanel.jsx`）
   - 实现 `onDrop` - 接收文章 ID
   - 调用 API 添加材料
   - 显示材料列表（标题、来源、添加时间）
   - 点击材料 → 插入引用到输入框

3. **状态管理**
   - 材料列表状态（useState）
   - 加载状态和错误处理

#### 后端（已有 API）
- `POST /api/conversations/:id/materials` - 添加材料 ✅
- `GET /api/conversations/:id` - 获取对话（含材料列表）✅

#### 数据库（已有表）
- `conversation_materials` 表 ✅
  - id, conversation_id, item_id, added_at

### 验证清单
- [ ] 文章可以拖拽（视觉反馈正常）
- [ ] 材料面板能接收 drop
- [ ] 材料成功添加到数据库
- [ ] 材料列表正确显示
- [ ] 点击材料能引用到对话
- [ ] 错误处理（重复添加、网络失败）

---

## 📂 关键文件路径

### 前端
```
frontend/src/
├── pages/
│   ├── WorkspacePage.jsx         # 主页面（文章列表）
│   ├── ConversationPage.jsx      # 对话页面
│   └── WorkspaceListPage.jsx     # 工作区列表
├── components/workspace/
│   ├── MainContent.jsx            # 文章列表（需修改：添加拖拽）
│   ├── ArticleDetail.jsx          # 文章详情
│   ├── ChatInterface.jsx          # 聊天界面
│   ├── MaterialsPanel.jsx         # 材料面板（需修改：接收 drop）
│   ├── CostTracker.jsx            # 成本追踪
│   └── Sidebar.jsx                # 左侧导航
└── App.jsx                        # 路由
```

### 后端
```
backend/src/
├── server.js                      # API 路由（已有材料相关端点）
├── db/
│   ├── db.js                      # 基础数据操作
│   ├── workspaces.js              # 工作区数据操作
│   └── schema-v2.sql              # v0.2.0 表结构
└── services/
    ├── llm.js                     # Deepseek 集成
    └── stats.js                   # 成本统计
```

---

## 🛠 技术栈和约定

### 前端
- React 18 + Vite
- Tailwind CSS（stone 色系）
- Axios（API 请求）
- react-markdown（Markdown 渲染）

### 后端
- Node.js 26 + Express
- SQLite (node:sqlite)
- OpenAI SDK（Deepseek 兼容）
- SSE（流式输出）

### 代码风格
- 组件文件名：PascalCase.jsx
- 函数名：camelCase
- CSS 类：Tailwind utilities
- 不写多余注释（代码自解释）
- API 响应格式：`{success, data, error}`

---

## 🎨 设计系统

### 颜色
- 背景：#fafaf9 (stone-50)
- 边框：#e7e5e4 (stone-200)
- 文字：#1c1917 (stone-900)
- 强调：#0c4a6e (sky-900)
- 标签：bg-blue-50 border-blue-200 text-blue-700

### 布局
- 左侧导航：256px 固定
- 右侧面板：384px 固定
- 中间内容：自适应
- 圆角：rounded-lg (8px)
- 间距：p-4 (16px), gap-4

---

## 📊 数据库状态

### 统计
- 文章总数：100 篇
- 标签覆盖：100%（source + category）
- 工作区：1 个
- 对话：2 个
- 消息：3 条

### 重要表
```sql
-- 工作区
workspaces: id, name, description, created_at, updated_at

-- 对话
conversations: id, workspace_id, title, llm_provider, created_at, updated_at

-- 消息
messages: id, conversation_id, role, content, tokens_used, cost_yuan, created_at

-- 材料关联（重点）
conversation_materials: id, conversation_id, item_id, added_at
```

---

## 🔧 环境配置

### 环境变量（backend/.env）
```
PORT=3000
DEEPSEEK_API_KEY=sk-***REDACTED***
DB_PATH=./data/app.db
```

### 数据库位置
```
backend/data/app.db
```

---

## 🧪 测试方法

### 手动测试
1. 访问 http://localhost:5173/
2. 点击侧边栏"工作区"
3. 进入对话页面
4. 返回文章列表
5. 拖拽文章到材料面板

### 浏览器 CDP 自动化测试
```bash
# 使用 web-access skill
# 在真实浏览器中自动化测试
# 可以截图验证
```

**重要**：记住以后用浏览器 CDP 进行完整测试（已建立流程）

---

## 💰 成本信息

### Deepseek 定价
- 价格：¥1/M tokens
- 月度预算：¥100
- 当前消耗：¥0.000087（87 tokens）

### 关键词提取
- 已废弃 Deepseek 提取方案
- 改用 source + category（免费）

---

## 🐛 已知问题

### P1 问题（不阻塞新功能）
1. 详情页按钮选择器冲突
2. 列表页当前视图不明显
3. 标签显示逻辑可优化

### P2 问题（可延后）
1. 对话历史长列表性能
2. 错误重试机制

---

## 📝 Git 状态

### 最近提交
```bash
a7c5b05 fix: 修复关键词提取脚本入口判断
428ceab fix: 修复 AI HOT 链接并添加关键词提取功能
9044f9a fix: 修复文章显示问题
053e2a9 feat: v0.2.0 工作区对话功能
```

### 当前分支
```
main
```

---

## 🎯 开发建议

### 第一步：设计交互
1. 画出拖拽流程草图
2. 确定视觉反馈（拖拽时的样式）
3. 确定材料列表展示格式

### 第二步：前端实现
1. 修改 `MainContent.jsx` - 添加拖拽能力
2. 修改 `MaterialsPanel.jsx` - 接收 drop + 显示列表
3. 添加状态管理和 API 调用

### 第三步：测试验证
1. 手动测试完整流程
2. 用 CDP 自动化测试
3. 验证数据库数据正确性

---

## 📚 参考文档

### 项目文档
- `README.md` - 项目总览
- `handoff/NEW-SESSION-HANDOFF.md` - v0.2.0 交接文档
- `iterations/2026-07-09-v0.2.0-workspace-chat.md` - 开发记录

### 技术文档
- React DnD: https://react-dnd.github.io/react-dnd/
- HTML5 Drag & Drop: https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API

---

## ⚠️ 重要提醒

1. **Deepseek API Key 已配置** - 可直接使用流式对话
2. **标签使用 source + category** - 不要再用 Deepseek 提取
3. **浏览器 CDP 测试** - 新功能完成后用 CDP 完整测试
4. **成本控制** - 保持 ¥100/月预算限制

---

## 🎉 上一会话总结

### 完成的工作
1. ✅ 修复 AI HOT 链接（URL 更正）
2. ✅ 实现标签显示（source + category）
3. ✅ 建立 CDP 测试流程
4. ✅ 验证所有 P0 问题已修复

### 协作模式
- 用 CDP 自动化测试
- 批量修复而非逐个修复
- 问题分优先级（P0/P1/P2）

---

**准备好开始材料拖拽功能开发了吗？** 🚀

**下一步**: 
1. 设计拖拽交互流程
2. 实现前端拖拽功能
3. 完善材料面板
4. 测试验证
