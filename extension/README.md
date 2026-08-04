# 读懂 · 浏览器插件（P1，原名「KW 解读」）

刷 X / YouTube 时一键把英文富媒体变成中文卡片解读：推文旁的紫色「解读」按钮 → 右侧滑出面板（标题卡 / 中文全稿卡 / 解读卡：摘要·要点·金句）→ 可追问、可带感想存入灵感库。

选型记录：`prototype/mock-pages/x-interpret-mock-index.html`（方案 A 侧边面板 + 卡片风，接 ADR-064）。

## 安装（Chrome / Edge / Arc）

1. 地址栏打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点左上角「加载未打包的扩展程序」（英文界面叫 Load unpacked），文件框里 ⌘⇧G 粘贴本目录路径（`knowledge-workbench/extension/`）
4. 打开 x.com 或 youtube.com 即可看到「解读」按钮

## 依赖

- 本机 knowledge-workbench 后端（launchd 常驻 `localhost:3000`）——插件只是壳，摄入/转写/翻译/解读/灵感库全部走后端既有接口：
  - `POST /api/content/ingest` 摄入+翻译
  - `POST /api/chat/ephemeral` 流式解读与追问（SSE）
  - `POST /api/notes` 存灵感卡（ADR-060）
- 无任何第三方依赖、不申请除 localhost 外的权限；X/YouTube 页面仅做 DOM 注入。

## Mac App / 手机场景（ADR-067）

浏览器插件只能注入网页，X/YouTube 原生 App 里用这两条通路：

- **Mac App**：拷贝链接 → 点「读懂.app」（在 `~/Applications/`，可拖进 Dock / Spotlight 搜"读懂"）→ 自动打开 KW 工作台开始解读。源码 `mac-launcher/dudong.applescript`，改后 `osacompile -o ~/Applications/"读懂.app" extension/mac-launcher/dudong.applescript` 重编译。想进系统分享菜单：快捷指令 App 新建 →「接收 URL」→「打开 URL：`http://localhost:5173/?analyze=[快捷指令输入]`」→ 勾选"在共享工作表中显示"。
- **iPhone / 任意设备**：把链接直接发给飞书「KW 笔记助手」私信 → 机器人解读后回复；可追问、回「全文」拿完整中文稿、回一句感想立为灵感（ADR-066 同款分流）。
- 插件面板里的「✈ 转发到飞书」会把当前解读推到你的飞书私信（手机同步可见）。

## 已知边界（v0.2）

- X 的 DOM 结构随官方改版可能失效（选择器集中在 `content.js` 的 `scanX`，坏了改这一处）
- 受保护/NSFW 推文抓不到（后端如实报错，面板原样显示）
- 亮色主题下面板仍是暗色（v0.1 固定暗色）
