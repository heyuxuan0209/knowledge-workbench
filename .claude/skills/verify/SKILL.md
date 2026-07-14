---
name: verify
description: 本项目（knowledge-workbench）的端到端验证方法：启动前后端 + Playwright 驱动真实 UI
---

# Knowledge Workbench 验证手册

## 启动

```bash
# 后端（:3000）。cd 后台运行；.env 在 backend/ 下（DEEPSEEK_API_KEY 已配置）
cd backend && (node src/server.js > /tmp/kw-server.log 2>&1 &)

# 前端 dev（:5173，vite，/api 代理到 :3000）。通常已在跑，先查：
lsof -nP -iTCP:5173 -sTCP:LISTEN || (cd frontend && npm run dev &)
```

改了后端代码必须重启 server 进程（`lsof -nP -iTCP:3000` 找 PID 后 kill 再启动），
vite 前端热更新不用重启。

## 浏览器驱动

系统无全局 playwright，用临时目录：

```bash
mkdir -p /tmp/verify-kw && cd /tmp/verify-kw && npm init -y && npm i playwright
npx playwright install chromium --only-shell   # 首次需要
```

驱动脚本要点（页面 http://localhost:5173，UI v2 起前缀为 .wb-*）：
- 导航：`.wb-nav-item:has-text("素材"|"信源"|"主题"|"创作"|"设置")`；折叠 `.wb-nav-toggle` / `.wb-panel-toggle`
- Feed：`.wb-fcard`、选中分析 `.wb-btn-outline`、`.wb-focus-row` 展开、`.wb-ideas-toggle` 选题、`.wb-acquire input`
- 右栏：`开始分析 →`、`.wb-msg.ai`、`.wb-msg-save(.saved)`、`.wb-chat-input` + `.wb-send`
- 素材/信源：`.wb-note-excerpt`/`.wb-note-del`、`.wb-src-preview`、`.wb-modal`（弹窗）、`.wb-toast`
- 创作台：`.wb-seg-btn`、`.wb-draft`（textarea，用 inputValue 读）、`.wb-insert-btn`
- 旧版选择器（FeedPage，已不挂载）：`.feed-card` / `.btn-save-note` / `.source-add-bar`
- 删除类操作有 `confirm()`：`page.on('dialog', d => d.accept())`
- SSE 对话真实调 Deepseek，等待 `.btn-save-note` 出现（timeout ≥ 90s）
- 测试后清理：取消关注所有登记源、删除测试笔记，恢复 DB 初始状态

## 坑

- 路径含中文目录「项目」：脚本入口判断不能用 `import.meta.url === 'file://'+argv[1]`
  （百分号编码不相等），要用 `fileURLToPath` 对比。
- 数据库直查：`node:sqlite`（`new DatabaseSync('./data/app.db')`，在 backend/ 下）。
- 数据同步脚本会调 Deepseek 翻译（花钱），验证时别随手跑全量 sync。
