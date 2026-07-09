# 5 分钟快速上手

**目标**: 让新接手的 AI 或开发者快速运行起来

---

## 1. 项目位置

```bash
/Users/USER/Documents/项目/knowledge-workbench/ai-insight-hub-v2/
```

---

## 2. 启动服务（2 步）

### 后端（Terminal 1）
```bash
cd /Users/USER/Documents/项目/knowledge-workbench/ai-insight-hub-v2/backend
node src/server.js
```
✅ 看到 `Server running on http://localhost:3000` 表示成功

### 前端（Terminal 2）
```bash
cd /Users/USER/Documents/项目/knowledge-workbench/ai-insight-hub-v2/frontend
npm run dev
```
✅ 看到 `Local: http://localhost:5173/` 表示成功

---

## 3. 访问应用

浏览器打开: **http://localhost:5173/**

---

## 4. 当前可用功能

| 功能 | 状态 | 备注 |
|------|------|------|
| 文章列表 | ✅ 可用 | 显示 AI HOT 文章 |
| 搜索 | ✅ 可用 | 按标题/摘要/来源搜索 |
| 文章详情 | ⚠️ 部分 | 推荐理由和标签是 mock 数据 |
| 工作区对话 | ❌ 未实现 | 点击左侧"工作区"会显示空状态 |
| 主题追踪 | ❌ 未实现 | - |
| 知识图谱 | ❌ 未实现 | - |

---

## 5. 如果出错

### 错误 1: 后端启动失败
```
Error: EADDRINUSE: address already in use :::3000
```
**原因**: 3000 端口被占用  
**解决**: `lsof -ti:3000 | xargs kill`

### 错误 2: 前端白屏
**原因**: 后端未启动或端口不对  
**解决**: 确保后端在 3000 端口运行

### 错误 3: 数据库错误
```
Error: SQLITE_ERROR: no such table: items
```
**原因**: 数据库未初始化  
**解决**:
```bash
cd backend
node src/db/init.js
node src/services/sync-aihot.js
```

---

## 6. 下一步

- 📖 读 `handoff/CONTEXT.md` 了解项目当前状态
- 📋 看 `handoff/TODO.md` 了解待办任务
- 🔍 查 `docs/DECISIONS.md` 了解重大决策
