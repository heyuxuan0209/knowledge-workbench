# 平台数据导出（小红书 + 公众号 + 抖音 + 视频号 + 知乎 → 飞书）

内容发布数据进飞书多维表格「发布与复盘」做 D3/D7/D30 复盘。**Mac 本机取数**（登录态和家庭 IP 只能在本机），导出文件传飞书云盘交接文件夹，**云端 Claude** 据群通知自动入表。

工单原文见对话记录；踩坑见 `docs/process-log.md` 的 `[平台导出]` 条目，决策见 `docs/DECISIONS.md`。

## 为什么这么设计（硬约束，别"优化"掉）

- **有头真 Chrome + 持久化 profile，零反检测**：行为等同她自己开浏览器。海外机房 IP + 无头浏览器的组合会触发小红书风控（已实测否决），本机方案特征与真人无异。用的是真 `/Applications/Google Chrome.app`（`channel:'chrome'`），不是 playwright 自带 chromium。
- **每天最多一次、失败不自动重试**：失败发飞书通知，人来看。`run.mjs` 有当日 marker 防重复。
- **只走"点导出按钮 / 读当前页表格"这一条路**：不爬页、不翻页、不扫库。有导出按钮的（小红书/公众号，抖音部分版本）走下载捕获；没有的（视频号，抖音无按钮时）只读**当前页面已渲染的那张明细表**拼 CSV。
- **登录失效 → 通知扫码，不硬闯**。判不准登录态时**宁可通知扫码也不硬导**——避免导出一份空数据被误读成「没流量」。
- **但"判不准"和"真掉线"通知里要分开说**（ADR-079）：探测拿不到结论时先 **reload 一次**再判（只一次，视频号风控红线优先，见 `lib/browser.mjs:detectWithReload`），仍判不准就发 **⚠️「登录态判不准：页面没读到内容，多半不是真掉线，先直接 `--force` 补一次」**；只有真看到登录页/二维码才发 **❌「未登录，需扫码」**。`_debug` 截图也分名：`*-login`＝真登录页，`*-undetermined`＝没读到内容（多半是白屏）。由来：2026-08-07 视频号报"未登录"，截图是张 16KB 纯白图，其实登录态好好的。

## 四个平台的差异（实测 2026-08-06）

| 平台 | profile | 取数方式 | 落盘 | 登录态 |
|---|---|---|---|---|
| 小红书 xhs | `~/.playwright-profiles/xhs` | 导出「笔记列表明细表」 | `xhs-*.xlsx` | 较稳 |
| 公众号 mp | `~/.playwright-profiles/mp` | 导出内容分析 + 流量来源截图 | `mp-*.xlsx` / `mp-source-*.png` | **短命**，常需扫码 |
| 抖音 dy | `~/.playwright-profiles/dy` | 读**作品管理**卡片列表逐条解析（数据中心「内容数据」的导出是周期聚合表、无逐条，**弃用**） | `dy-*.csv` | 未登录**不跳 URL**、splash 有「作品数据分析」营销字（检测靠 body innerText，别用 getByText 判「作品数据」会误命中） |
| 视频号 sph | `~/.playwright-profiles/sph` | 无导出，视频列表在 **iframe** 里，读子 frame 文本逐条解析 | `sph-*.csv` | 和微信绑定，**比公众号更易失效**；**别反复自动开（风控），每天只跑一次** |
| 知乎 zhihu | `~/.playwright-profiles/zhihu` | 无导出，「内容管理·全部」列表 DOM 抽取（文章/视频/想法/回答一网打尽） | `zhihu-*.csv` | 较稳；发布时间可见文本只到日、但 `data-tooltip` 有到分的完整时间戳 |

> 抖音作品管理是卡片列表（无导出按钮、指标逐卡不同），解析器 `dy-export.mjs:parseDouyinWorks`：以「发布时间」行作锚、按指标标签取值。改版了先看 `_debug/dy-*.png`，再调 `METRIC_LABELS`/`ACTIONS`/锚点正则。
>
> 视频号视频列表在子 iframe（`/micro/content/post/list`）里（主 frame 只有导航），且子 frame 有反注入守卫——只读 innerText 稳、别做复杂 DOM 遍历。每条：标题 + 发布时间(精确到分) + **5 个无标签数字** + 操作按钮。5 数字从左到右＝**播放 / 在看 / 评论 / 转发 / 点赞**（图标无字、用户对着后台核过，`sph-export.mjs:METRIC_KEYS` 按位置映射）。视频号**列表不显示收藏**（收藏列留空），但多个微信特有的**在看**指标单列保留。改版了先看 `_debug/sph-*.png`。
>
> 知乎「内容管理·全部」四类内容一个列表（`zhihu-export.mjs:extractZhihu`，知乎允许 DOM eval、无守卫）：卡 = `.CreationManage-CreationCard`；类型取标题 `.CreationCardTitle-wrapper` 文本**前缀**（比 href 准，视频也可能挂 /pin/）；**发布时间取时间 div 的 `data-tooltip`**（可见文本只到日、tooltip 到分）；指标带标签、**逐类型不同**——文章/视频是「阅读/播放」，**想法是「被浏览」且有「转发」数**（文章那栏"分享"只是按钮无数字）；标签集务必含 `阅读/播放/被浏览/赞同/评论/收藏/喜欢/转发`（漏了想法的浏览/转发就抓空）。映射：阅读|播放|被浏览→播放量、赞同→点赞、转发→分享/转发、知乎特有「喜欢」单列。想法/视频无独立标题（塞的是正文），已去「收起」尾巴并截断 100 字。

页面抓表拼的 CSV 一律 UTF-8 带 BOM（Excel/飞书打开中文不乱码），并把原生表头归一到标准列：`标题 / 发布时间 / 曝光·播放量 / 点赞 / 评论 / 收藏 / 分享·转发 / 涨粉`（**发布时间**是入表匹配主键，务必抓准）。表头对不上（改版）时不硬映射，原样落盘并在日志标「原始表头未归一，请核对」。

## 首次使用（必须先手动登录一次，扫码/短信）

profile 是空的，第一次要人工登录，之后复用登录态：

```bash
cd backend
npm run export:xhs   # 打开小红书创作后台，按提示短信/扫码登录，登录后它会自动导出一次
npm run export:mp    # 打开公众号后台，微信扫码登录，登录后自动导出
npm run export:dy    # 打开抖音创作者后台，扫码/手机号登录，登录后自动导出（有导出按钮走下载，否则读页面表格）
npm run export:sph   # 打开视频号助手，微信扫码登录，登录后读动态列表拼 CSV
npm run export:zhihu # 打开知乎创作中心，扫码/密码登录，登录后读「内容管理·全部」列表拼 CSV
```

> 首次跑时若 `PLATFORM_EXPORT_MANUAL_CLICK=false`（默认），登录后脚本会自动找「导出」按钮。
> 若某平台后台改版、按钮找不到，脚本会截图存到 `~/Documents/platform-exports/_debug/` 并报「卡在哪一步」，
> 这时把 `.env` 里 `PLATFORM_EXPORT_MANUAL_CLICK=true` 打开——脚本只开到导出页，最后一下你自己点，一样省截图。

## 日常（自动）

launchd 每天 **10:07** 跑一次 `run.mjs`（两个平台都导 → 上传 → 发群通知）。装/查/卸：

```bash
# 安装（一次性）
cp backend/scripts/platform-export/com.knowledge-workbench.platform-export.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.knowledge-workbench.platform-export.plist

# 立刻手动触发一次（验证/补数，绕过当日 marker）
launchctl kickstart -k gui/$(id -u)/com.knowledge-workbench.platform-export
# 或直接：
cd backend && npm run export:platforms   # = node run.mjs --force

# 看日志
tail -f ~/Library/Logs/knowledge-workbench/platform-export.log

# 卸载
launchctl bootstrap gui/$(id -u) 相反：launchctl bootout gui/$(id -u)/com.knowledge-workbench.platform-export
```

## 手动补数

`npm run export:platforms`（带 `--force`，绕过"每天一次"限制）。单平台补：`npm run export:xhs` / `npm run export:mp` / `npm run export:dy` / `npm run export:sph` / `npm run export:zhihu`。

## 落盘与交接

- 文件：`~/Documents/platform-exports/` 下 `xhs-YYYYMMDD.xlsx`、`mp-YYYYMMDD.xlsx`、`mp-source-YYYYMMDD.png`（阅读来源）、`dy-YYYYMMDD.csv`、`sph-YYYYMMDD.csv`、`zhihu-YYYYMMDD.csv`。
- 上传：飞书云盘交接文件夹（token 由 `backend/.env` 的 `PLATFORM_EXPORT_FOLDER_TOKEN` 指定；用主应用 `FEISHU_APP_ID/SECRET`，`drive/v1/files/upload_all`）。
- 通知群：由 `backend/.env` 的 `PLATFORM_EXPORT_CHAT_ID` 指定。**用笔记机器人身份发**（`PLATFORM_EXPORT_NOTIFY_BOT=note`）——主应用是云端 Claude 的事件流身份，飞书不把它自己发的消息回推给它，得用另一个身份发进群，主应用桥接才收得到 → 转云端 Claude 入表。

## 配置（backend/.env）

| key | 默认 | 说明 |
|---|---|---|
| `PLATFORM_EXPORT_DIR` | `~/Documents/platform-exports` | 落盘目录 |
| `PLATFORM_EXPORT_FOLDER_TOKEN` | （必填，无默认） | 飞书云盘交接文件夹 token |
| `PLATFORM_EXPORT_CHAT_ID` | （必填，无默认） | 通知群 chat_id |
| `PLATFORM_EXPORT_MANUAL_CLICK` | `false` | true=最后一下真人点 |
| `PLATFORM_EXPORT_NOTIFY_BOT` | `note` | note=笔记机器人 / main=主应用 |
| `PLATFORM_EXPORT_XHS_PROFILE` | `~/.playwright-profiles/xhs` | 小红书登录态 |
| `PLATFORM_EXPORT_MP_PROFILE` | `~/.playwright-profiles/mp` | 公众号登录态 |
| `PLATFORM_EXPORT_DY_PROFILE` | `~/.playwright-profiles/dy` | 抖音登录态 |
| `PLATFORM_EXPORT_SPH_PROFILE` | `~/.playwright-profiles/sph` | 视频号登录态 |
| `PLATFORM_EXPORT_ZHIHU_PROFILE` | `~/.playwright-profiles/zhihu` | 知乎登录态 |

## 选择器会漂

四个后台改版都频繁，导出按钮的定位走**可见文本**（最稳），候选词写在各自 `*-export.mjs` 里。真漂了：看 `_debug/` 截图 → 往候选文本数组里加当前按钮的文字，或临时切 `MANUAL_CLICK=true`。

抖音/视频号走**页面抓表**时，表格解析在 `lib/scrape.mjs`（兼容语义 `<table>` / ARIA `role=table` / div 自绘表格，取数据行最多的那张）。若后台改版导致读不到表，脚本会 `_debug/` 截图 + 报「没读到表格」；表头改名导致归一失败会原样落盘并标注。改版时先看截图确认表格结构，再按需扩 `lib/scrape.mjs` 的选择器或 `STD_COLUMNS` 别名。
