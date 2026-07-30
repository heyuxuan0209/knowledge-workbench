# KW 解读 · 浏览器插件（P1）

刷 X / YouTube 时一键把英文富媒体变成中文卡片解读：推文旁的紫色「解读」按钮 → 右侧滑出面板（标题卡 / 中文全稿卡 / 解读卡：摘要·要点·金句）→ 可追问、可带感想存入灵感库。

选型记录：`prototype/mock-pages/x-interpret-mock-index.html`（方案 A 侧边面板 + 卡片风，接 ADR-064）。

## 安装（Chrome / Edge / Arc）

1. 地址栏打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录（`knowledge-workbench/extension/`）
4. 打开 x.com 或 youtube.com 即可看到「解读」按钮

## 依赖

- 本机 knowledge-workbench 后端（launchd 常驻 `localhost:3000`）——插件只是壳，摄入/转写/翻译/解读/灵感库全部走后端既有接口：
  - `POST /api/content/ingest` 摄入+翻译
  - `POST /api/chat/ephemeral` 流式解读与追问（SSE）
  - `POST /api/notes` 存灵感卡（ADR-060）
- 无任何第三方依赖、不申请除 localhost 外的权限；X/YouTube 页面仅做 DOM 注入。

## 已知边界（v0.1）

- X 的 DOM 结构随官方改版可能失效（选择器集中在 `content.js` 的 `scanX`，坏了改这一处）
- 受保护/NSFW 推文抓不到（后端如实报错，面板原样显示）
- 亮色主题下面板仍是暗色（v0.1 固定暗色）
