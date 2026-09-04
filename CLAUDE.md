# knowledge-workbench — 工作纪律（每个对话窗口都适用）

## 决策与踩坑必须留痕

### 留痕门槛（不要为了形式硬凑）

- **普通 Bug 修复、权限位、路径、部署细节**：只写 git commit 和必要的技术说明，不进 ADR，不进 process-log。
- **只有形成可复用经验、发生重大踩坑、改变架构或产品口径时**，才写 `docs/process-log.md`；不能为了填「能长出的选题」而把普通修复包装成选题。
- **只有真正作出了会影响后续实现的决策时**，才写 `docs/DECISIONS.md`。沿用既有决定、执行既定方案、常规修错都不新增 ADR。
- 判断顺序是：先问“未来接手者是否需要知道这项取舍或经验”；不需要就留在 commit/技术说明中。不要因为“不确定算不算”而机械双写。

在结束一段工作前，只要发生了**决策**、**踩坑/改主意**、或完成一个**里程碑**，就必须留痕，不能让上下文随对话窗口关闭而丢失：

1. **决策 → `docs/DECISIONS.md`**：追加一条 ADR，沿用现有格式（`背景（踩坑，有实证）` / `决策` / `思考逻辑` / `后果` / `备选方案`），编号接续——**查 DECISIONS.md 末尾的最新号再 +1**（多会话都在加、号会变，别写死也别撞号），ADR 追加到**文件末尾**。
2. **踩坑 / 过程 → `docs/process-log.md`**：追加一条（新条目置顶，插在标题 `# 过程…` 那行下面），带数字和真实情绪，并填「能长出的选题」栏——这是选题的活燃料。
3. **不确定算不算时先按上面的留痕门槛判断**：普通修复留在 commit；确有可复用经验才进 process-log；确有后续约束力的取舍才进 ADR。

## 这两个文件纯本地留痕（不进 git）

- `docs/DECISIONS.md` 和 `docs/process-log.md` 是内部记录，**不 git、不 push**——直接编辑保存进本地文件即可，别丢就行，**不要对它俩执行 `git add` / commit**（`docs/` 本就被 .gitignore 排除）。
- 关键是"每次有决策/踩坑就及时写进去"，靠可靠地写、不靠 git。
- 其它代码改动照常提交，但 push / 发布由用户手动确认（遵全局纪律）。
- **权威源＝Mac 本地这一份，VPS 上的 docs/ 只读、不写**（ADR-080 修订 ADR-074 里"以 VPS 为准"那条）：实测真正在写留痕的一直是 Mac 会话（VPS 停在 ADR-074，Mac 已到 ADR-080），两边各写各的必然合不回来。VPS 上的 agent／飞书机器人要留痕，走"给 Mac 指令"，不要直接改 VPS 的 docs/。

## 并发安全：多会话同时在写这两个文件（硬纪律）

多个 agent 会话可能同时在跑、都往 `DECISIONS.md` / `process-log.md` 写。已真实发生过整段记录被覆盖丢失（一轮 feed 的 process-log 被冲掉、标题被挤到第 98 行）。根因是**用 Write 整体重写**——它基于"读文件那一刻"的旧快照，中间别的会话写的全被覆盖。所以：

1. **只用 Edit 局部插入，禁止 Write / 读全文再整体 prepend / 整体重排。** Edit 只动锚点附近，别的会话刚写的会自动保留；万一撞车 Edit 会报错（可察觉、可重试），而不是像 Write 那样静默吞掉别人的记录。
2. **每条记录开头带会话标记**：如 `[feed]`、`[series]`、`[创作台]`。这样一处看全时间线时能区分谁记的、也能 grep 检索——既保时间线又可追溯。
3. process-log 新条用 Edit **锚定标题行插入到其下**（最新置顶），DECISIONS 的 ADR **append 到文件末尾**（append 天然不撞）。

## 文件放哪（2026-07-28 整理后的边界，别再乱回去）

- **UI mock / 选型 HTML**：一律进 `prototype/`（单文件放 `prototype/mock-pages/`），**禁止再往 `frontend/public/` 塞**——那里只放正式前端资源。mock 选完型、决策进了 ADR 后，及时在 `prototype/README.md` 索引里标记状态。
- **交接文档＝工单**：只进 `handoff/`（docs/ 里不再放 HANDOFF-*），**谁干完活谁当场把工单移入 `archive/handoffs/`**——handoff/ 只放未完工单，空着=没有未完事项。禁止放"项目现状"类快照（会烂、烂了会骗新 agent）；新 agent 接手走 `handoff/README.md` 的五步协议。
- **创作类文件**（草稿/成品/发布模板/灵感）：**本仓不收**，一律去独立工作区 `~/Documents/项目/writing/`（纯本地私有仓）。本仓的 process-log/DECISIONS 是它的选题燃料源，只读引用。
- **实验输出**（cluster dump 之类一次性数据）：进 `archive/experiments/`。
- 每轮开发收尾跑 `/tidy-closeout`（残留巡检 + 留痕检查 + git 边界检查）。

## 部署拓扑与入口（2026-08-07 起，接手必读 · ADR-074/080/081/082/083）

**产品不在本机跑。** 排障前先认清代码跑在哪台机器上——报错路径出现 `/home/bot/...` 就是服务器侧问题，别在 Mac 上查环境（已误判过一轮）。

- **用户入口**：桌面双击 `KW-知识工作台.command`，脚本优先打开 `http://localhost:3000`（常驻 SSH 隧道 → VPS 真后端/真数据），隧道不通才退到 `http://kw-vps:3000`（Tailscale tailnet；洛杉矶 VPS tailnet IP `100.114.12.120`）。MultiPost 扩展只允许 https/localhost/127.0.0.1 注入，所以 **一键发布只在 localhost 入口可用**；`kw-vps` 是能看能写但不能一键发布的退路。
- **后端**：VPS `vultr-lax`（`104.207.154.248`，美国洛杉矶；兼容别名 `vultr-paris` 也指向现生产机）systemd `kw-backend.service`，user=bot，repo `/home/bot/projects/knowledge-workbench`。巴黎回滚机只允许通过 `vultr-paris-rollback` 访问，业务服务保持停用，禁止双端飞书长连接。**前端构建产物由生产 VPS 的 `express.static` 托管**（`frontend/dist`，`existsSync` 守卫；回滚＝`rm -rf frontend/dist` + 重启）。
- **Mac 访问通道**：ssh 隧道 `localhost:3000`，Mac launchd `com.knowledge-workbench.tunnel` 常驻自动重连（plist 在 `backend/scripts/`）；当前经本机 `127.0.0.1:7897` 代理访问洛杉矶公网 SSH 443，不依赖 Mac Tailscale 客户端。它是日常主入口，不是 Mac 本地后端。
- **公网零暴露**：ufw 只放 22/443 + `3000/tcp on tailscale0`。别为了图方便去开公网端口。
- **本机 5173 的 vite dev 仅开发用**；桌面 `KW-本地开发.command` 会自动避让并恢复常驻隧道。

### 工作循环：改 → 本地预览 → 用户点头 → 才 push（ADR-089，硬纪律）

用户要的是**先看效果、满意了再统一发布**。所以默认循环是：

1. 改完**主动 commit**（本地存档、可回退、不出门），**不要 push**；
2. **起本地预览并把页面开给用户**：`cd frontend && npm run dev` → `http://localhost:5173`。它的 `/api` 经 vite 代理 → localhost:3000 → 常驻隧道 → **VPS 真后端**，所以**本地预览看到的是线上真数据**（已实测：本地与线上同为 72 条素材、ID 一致）。**别用 `KW-本地开发.command` 做预览**——那个会起本地后端、数据是 8/3 旧快照，还要抢 3000。
3. 用户说"可以/推吧" → 才 `git push` + 部署（下面四步）。用户说"不行" → 继续改，**什么都没发出去**。

**改动能不能本地预览，必须当场判断并主动说，不能等用户发现**（用户明确要求）：

| 改了哪里 | 能本地预览吗 | 该说什么 |
|---|---|---|
| `frontend/**` | ✅ 能，热重载 + 线上真数据 | 直接开页面给他看 |
| `backend/**` 接口逻辑 | ❌ 不能 | **"这个改动本地预览不出来，得推上去才能看真效果"**；或本地起后端验逻辑，但要注明"数据是 8/3 旧快照，只验了逻辑" |
| python 脚本 / 服务器环境 / systemd / cron / 字体 | ❌ 不能 | 同上，明确告诉他要部署才能验 |
| 前后端都动了 | ⚠️ 只能看到前端那半 | 说清楚"界面能看，接口那部分要推上去" |

**部署一次改动（用户说「部署一下 / 推吧」时照做）**：
```
git push                                   # 先 fetch 查分叉！本仓多端在写，曾差点冲掉远端 7 个提交
ssh vultr-lax 'sudo -u bot -H git -C /home/bot/projects/knowledge-workbench pull --ff-only'
# 动了前端就必须 build，否则线上是旧包且【不会报错】：
ssh vultr-lax 'cd /home/bot/projects/knowledge-workbench/frontend && sudo -u bot -H npm run build'
ssh vultr-lax 'systemctl restart kw-backend'
```
VPS 每天 07:00 有 root cron 跑 `backend/scripts/auto-deploy.sh`（ADR-085）：自动拉取→按改动 build/重启→三条自检→**不过就回滚上一版并飞书通知**。但**当天要生效仍需手动部署**（等到第二天太慢），且自检只发现"起不来"、发现不了"能跑但功能坏"，所以改完自己验。

**服务器环境变更一律固化成幂等脚本**（范例 `backend/scripts/provision-render-env.sh`：头图渲染要 playwright+Pillow+Chromium+中文字体+fontconfig 别名），只在机器上手改＝重建就丢。

**用户桌面只有三个 KW 文件，别再加第四个**：`KW-知识工作台.command`（用产品）/ `KW-改代码.command`（自动 cd + 起官方订阅 Codex，用户改需求的入口）/ `KW-本地开发.command`（离线调试，会自动避让并恢复常驻隧道）。**用户说「部署一下」＝执行上面那四步**。

**用户面文档是桌面 `使用手册-Claude与VPS.md`**——改了拓扑/入口/部署方式，**必须同步更新它**，否则用户按旧手册操作会踩空（已发生：手册还按迁云前写，用户读完仍不知道改代码该开哪个）。用户说"打不开"时，先让他双击 `KW-知识工作台.command` 把自检输出念给你，比盲猜快。

## 运维红线

- **正式后端唯一由 VPS systemd `kw-backend.service` 托管**（user=bot）。在 VPS 上禁止手动跑 `node src/server.js` / `npm start` / `npm run dev`：已有一个手动孤儿进程霸占 3000 长达 22 小时，systemd 重启 15468 次但健康检查照样报绿（ADR-101）。
- **Mac 的 `localhost:3000` 默认是 SSH 隧道，不是本地后端。** 只有明确做离线/本地逻辑调试时，才用 `KW-本地开发.command` 临时停隧道、起本地 Node+Vite；退出后必须恢复隧道。这时数据是 8/3 死快照，且一键发布链路不完整。

## 产品灵感库·无界面试点（2026-07-28 → 08-11，ADR-060，所有会话生效）

试点期 agent 就是灵感库的界面，两条义务：

1. **捕获**：用户丢来项目/文章并流露"想用/有启发/可以用到产品"，或明说"存一下"——当场攒卡入素材库：`POST /api/notes`，`noteType:'insight'`，excerpt 首行标记定卡型：
   - 方案卡（需求驱动）：`【方案卡·问题】<用户会用来搜回它的大白话>\n【方案】<名> — <url>\n【要点】…\n【怎么改造进我的产品】…`
   - 灵感卡（供给驱动）：`【灵感卡·启发】…\n【来源】…\n【对我产品的应用】…`
   - 「怎么改造/应用」是判断字段：AI 只起草，须向用户明示可裁决（ADR-044）。
2. **检索**：接到"我想做X / 怎么解决Y"类需求，**动手前先** `GET /api/notes/search-semantic?q=<问题大白话>` 查一遍；命中就明说"你之前存过：…"再干活。**真帮上忙时在 process-log 记一行 `[灵感库捞回]`**（试点就靠这个计数验收，工单见 handoff/）。

## 创作产出落飞书文档（ADR-062/063，评审场搬家）

起草出的**母稿不再放本地文件夹**——调 `POST /api/feishu/draft-doc {title, markdown, brief:{topic,thesis,sources,genre,platform,voice}}`，自动建飞书文档并挂进**用户个人知识库「✍️ 内容工场」节点**（用户全部内容产出物的唯一的家——工厂不拥有产品，节点名不带项目名；权限随空间：用户是主人、机器人可编辑），把返回的 url 给用户去评审。内容工场内**状态靠 bitable「发布与复盘」的状态字段，不建状态文件夹**，母稿平铺。用户在文档里评论、或在群里 @机器人改稿；定稿后再进创作台出平台内容。两条硬规矩（ADR-063）：

1. **母稿一律干净 markdown**——正文+结构，禁止排版样式（公众号排版 HTML 等成品样式属于创作台产出，不是母稿；已实证用户否决）。
2. 落点是**知识库不是云盘**（云盘仅 `destination:'drive'` 兜底）。

历史补档脚本见 `backend/scripts/backfill-published-to-feishu.mjs`。

## 北极星五问（ADR-070，内容与产品的决策关卡）

**每次内容发布决策、每个产品/skill 立项，先过 `reference/prompts/creation/north-star.md` 的五问**：①为筛同频人还是为数据好看 ②我是这个主张的活证据吗（转述必须注入自己的实证）③有没有"会有人不同意"的观点 ④有没有把模糊感受压成一句可转述的机制命名 ⑤人味是否人产、入口是否在用户已经在的地方。答不上→改到能答，或不做。北极星：max(同频密度)≠max(流量)；人机分界线：人做观点/品味/判断/真实性，AI 做其余。voice-profile 管"怎么说像我"，north-star 管"该不该做"——north-star 在上游。

## 内容创作模板（ADR-026）

创作层模板是「文体 × 平台形态」正交组合：`reference/prompts/creation/genres/`（6 文体）× `platform-forms/`（10 平台形态），生成 = `draft-frame + genre + platform-form`。改动守 ADR-025 三层原则、ADR-026 价值优先于爆款；每个模板必须接真实语料（`docs/teardowns/`）。
