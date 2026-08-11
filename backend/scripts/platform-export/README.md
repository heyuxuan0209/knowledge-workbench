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
| 公众号 mp | `~/.playwright-profiles/mp` | 内容分析 + 流量来源截图 + **逐篇明细** + **逐篇互动** | `mp-*.xlsx` / `mp-source-*.png` / `mp-detail[-nonotice]-*.xls` / `mp-engage-*.csv` | **短命**，常需扫码 |
| 抖音 dy | `~/.playwright-profiles/dy` | 读**作品管理**卡片列表逐条解析（数据中心「内容数据」的导出是周期聚合表、无逐条，**弃用**） | `dy-*.csv` | 未登录**不跳 URL**、splash 有「作品数据分析」营销字（检测靠 body innerText，别用 getByText 判「作品数据」会误命中） |
| 视频号 sph | `~/.playwright-profiles/sph` | 无导出，视频列表在 **iframe** 里，读子 frame 文本逐条解析 | `sph-*.csv` | 和微信绑定，**比公众号更易失效**；**别反复自动开（风控），每天只跑一次** |
| 知乎 zhihu | `~/.playwright-profiles/zhihu` | 无导出，「内容管理·全部」列表 DOM 抽取（文章/视频/想法/回答一网打尽） | `zhihu-*.csv` | 较稳；发布时间可见文本只到日、但 `data-tooltip` 有到分的完整时间戳 |
| X | `~/.playwright-profiles/x` | 无导出，账号分析 `/i/account_analytics` 的逐帖表 | `x-*.csv` | 首次要人工登录一次 |

### 公众号逐篇明细（2026-08-11 补的最大缺口）

在此之前公众号**只有全号汇总**：每天各渠道多少阅读人数。复盘时一篇文章只剩一个「阅读 N」，
而 N 小根本不等于内容差——实测某篇「101 阅读」看着像扑街，逐篇明细一开是
「送达 64 → 公众号消息里打开 11 → 4 人转发带来 85 次阅读，完读率 50.6%」：不是内容不行，是**分发盘子小**。
这两件事的复盘动作完全相反（改选题 vs 改推送/引流），只看汇总必然误判。

四个 tab 的「下载数据明细」各指向一个后台接口，`mp-export.mjs:downloadPerArticle` 直接拼 URL 拿：

| tab | 接口 | 内容 | 取不取 |
|---|---|---|---|
| 已发表内容 | `appmsganalysis?action=download_summary_tendency` | 日期 × 渠道，全号汇总 | ✅ 原来那份 `mp-*.xlsx` |
| 已通知内容 | `datacubequery?busi=3&tmpl=19` | **逐篇 16 列，含送达人数/送达阅读率** | ✅ `mp-detail-*.xls` |
| 未开启通知内容 | `datacubequery?busi=3&tmpl=20` | 逐篇 14 列，无送达（没推送） | ✅ `mp-detail-nonotice-*.xls` |
| 全部 | `datacubequery?busi=3&tmpl=14` | 日期 × 渠道聚合，**不是逐篇** | ❌ 对复盘没用 |

**为什么直接拼 URL 而不是点按钮**：页面上那张逐篇表**是坏的**——日期控件默认停在一年前
（2025-09-30~2025-10-30），表里恒显示「暂无数据」，`fill()` 也改不动（自绘控件不吃 value）。
但下载接口本身好好的，把 `args` 里的日期换成最近的（默认近 60 天，`PLATFORM_EXPORT_MP_DETAIL_DAYS` 可调）就是全量。
顺带也就不用逐篇点进详情页——一次请求覆盖全部文章，正好躲开「登录态短命、点 N 次多半中途掉线」。

点赞/在看/评论那几个数**不在**上面这份里，它们在 内容管理 → 发表记录：整页数据以
`publish_page = {...}` **内联在 HTML 里**（`mp-export.mjs:extractPublishPage`），比读 DOM 稳得多
（页面上那些数字是 tooltip 结构、没有语义标签）。字段对照（对着后台 tooltip 核过）：
`read_num`=阅读人数、`old_like_num`=点赞、`like_num`=在看、`comment_num`=评论、`share_num`=分享、
`sent_status.total`=送达人数 → 落 `mp-engage-*.csv`。

**没拿到的**（如实记着，别以为拿全了）：性别/年龄/地域分布、平均停留时长——只在**单篇详情页**里有，
而单篇详情页的入口没在 DOM 里找到（列表页的数字都是 tooltip 不是链接，`action=detail&msgid=…` 几种拼法也都不通）。
收藏公众号后台逐篇也不给，`mp-engage` 那列一律留空（别写 0，会被复盘读成"没人收藏"）。

> 抖音作品管理是卡片列表（无导出按钮、指标逐卡不同），解析器 `dy-export.mjs:parseDouyinWorks`：以「发布时间」行作锚、按指标标签取值。改版了先看 `_debug/dy-raw-*.txt`（每次跑都存页面原文）和 `_debug/dy-*.png`，再调 `METRIC_LABELS`/`ACTIONS`/`ANCHORS`。
>
> ⚠️ **抖音有两套后台在灰度**（2026-08-11 同一天两次跑分别撞到）：老版导航是「作品管理/合集管理/共创中心」+ 计数「共 N 个作品」+ 指标 播放/点赞/评论/分享/收藏/弹幕；新版导航是「AI分身/AI工坊/创作服务」+ 计数「**作品 (N)**」+ 多出 完播率/2秒跳出率/**吸粉量**/划走率/平均浏览图片**数**。所以锚点是一组候选取**最后一个命中**、指标标签两套都收，且对「短、以 率/量/数/比/长 结尾、下一行像个值」的**没见过的标签也吃掉两行**——宁可丢一个新指标，也别让它污染标题（标题是入表匹配主键）。
>
> 视频号视频列表在子 iframe（`/micro/content/post/list`）里（主 frame 只有导航），且子 frame 有反注入守卫——只读 innerText 稳、别做复杂 DOM 遍历。每条：标题 + 发布时间(精确到分) + **5 个无标签数字** + 操作按钮。**声明了原创的视频会在发布时间和 5 个数字之间多一行「已声明原创」**（2026-08-11 踩到）——`BADGES` 里的徽章必须先跳过再收数字，否则那条指标全空、徽章连着 5 个数字一起串进**下一条的标题**（双杀：两条都进不了表）。5 数字从左到右＝**播放 / 在看 / 评论 / 转发 / 点赞**（图标无字、用户对着后台核过，`sph-export.mjs:METRIC_KEYS` 按位置映射）。视频号**列表不显示收藏**（收藏列留空），但多个微信特有的**在看**指标单列保留。改版了先看 `_debug/sph-*.png`。
>
> 知乎「内容管理·全部」四类内容一个列表（`zhihu-export.mjs:extractZhihu`，知乎允许 DOM eval、无守卫）：卡 = `.CreationManage-CreationCard`；类型取标题 `.CreationCardTitle-wrapper` 文本**前缀**（比 href 准，视频也可能挂 /pin/）；**发布时间取时间 div 的 `data-tooltip`**（可见文本只到日、tooltip 到分）；指标带标签、**逐类型不同**——文章/视频是「阅读/播放」，**想法是「被浏览」且有「转发」数**（文章那栏"分享"只是按钮无数字）；标签集务必含 `阅读/播放/被浏览/赞同/评论/收藏/喜欢/转发`（漏了想法的浏览/转发就抓空）。映射：阅读|播放|被浏览→播放量、赞同→点赞、转发→分享/转发、知乎特有「喜欢」单列。想法/视频无独立标题（塞的是正文），已去「收起」尾巴并截断 100 字。

> **X（2026-08-11 加，用户拍板走浏览器方案）**：官方 API 里能拿到自己帖子曝光/互动的档位是按月订阅的付费档，为了十几行复盘数据不值当，所以照抄这套架构。比别处更保守——**只读账号分析页首屏渲染好的那张表，不滚动加载、不翻页**（X 对自动化比国内平台敏感）。列名按关键词匹配中英双语（`x-export.mjs:X_ALIASES`），**认不出「哪列是帖子」或「哪列是曝光」就直接报错**，不落一份看着像数据的空表。
>
> ⚠️ X 和视频号同一个毛病：**帖子没有标题**，导出里那列是正文，跟表里她自己起的「平台化标题」对不上——靠 `backfill-from-exports.mjs` 的第三级「按发布日兜底」。所以**同一天发多条 X**（比如 thread 拆成几条）时会如实报「匹配不上」，需要人工看一眼，这是有意的：宁可漏，不可错。

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

launchd **登录时跑一次 + 白天 10/12/14/16/18/20 点 07 分各一次**（五个平台都导 → 上传 → 发群通知）。
不是"定点跑一次"而是"当天没成就一直找机会补"——当天成过的日子后面每次读一下 marker 就退（约 0.3 秒，
不开浏览器、不碰平台）。理由见 ADR-097：定点等于把成败押在"那一分钟她电脑什么状态"上。

```bash
# 安装（一次性）
cp backend/scripts/platform-export/com.knowledge-workbench.platform-export.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.knowledge-workbench.platform-export.plist

# 让 Mac 每天 9:55 自己醒（否则合盖睡着时 launchd 会"唤醒即补跑"，那会儿 Wi-Fi 还没连上）
sudo pmset repeat wakeorpoweron MTWRFSU 09:55:00
# 已登记为 `wakepoweron at 9:55AM every day`（2026-08-11 装）。注意：Apple Silicon 只有
# 「从睡眠唤醒」确定生效，「从完全关机开机」历来不支持，别指望关机后还能跑。查：pmset -g sched
#
# ⚠️ 没有 TTY 的场景（agent 会话里 sudo 读不到密码）走 GUI 授权弹窗，密码不经过任何日志：
# osascript -e 'do shell script "/usr/bin/pmset repeat wakeorpoweron MTWRFSU 09:55:00" with administrator privileges'

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
