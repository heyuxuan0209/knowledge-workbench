# knowledge-workbench — 工作纪律（每个对话窗口都适用）

## 决策与踩坑必须留痕

在结束一段工作前，只要发生了**决策**、**踩坑/改主意**、或完成一个**里程碑**，就必须留痕，不能让上下文随对话窗口关闭而丢失：

1. **决策 → `docs/DECISIONS.md`**：追加一条 ADR，沿用现有格式（`背景（踩坑，有实证）` / `决策` / `思考逻辑` / `后果` / `备选方案`），编号接续——**查 DECISIONS.md 末尾的最新号再 +1**（多会话都在加、号会变，别写死也别撞号），ADR 追加到**文件末尾**。
2. **踩坑 / 过程 → `docs/process-log.md`**：追加一条（新条目置顶，插在标题 `# 过程…` 那行下面），带数字和真实情绪，并填「能长出的选题」栏——这是选题的活燃料。
3. **不确定算不算"决策"时**，宁可在 process-log 记一句，也别让它丢。

## 这两个文件纯本地留痕（不进 git）

- `docs/DECISIONS.md` 和 `docs/process-log.md` 是内部记录，**不 git、不 push**——直接编辑保存进本地文件即可，别丢就行，**不要对它俩执行 `git add` / commit**（`docs/` 本就被 .gitignore 排除）。
- 关键是"每次有决策/踩坑就及时写进去"，靠可靠地写、不靠 git。
- 其它代码改动照常提交，但 push / 发布由用户手动确认（遵全局纪律）。

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

## 运维红线

- **后端由 launchd 常驻托管**（`gui/501/com.knowledge-workbench.backend`，`node --watch` 自动热重载）：**禁止手动 `npm start` / `npm run dev`**——会和它抢 3000 端口（已实际冲突过）。另有 sync-sources / daily·weekly·monthly-report / active-query 五个定时服务同样归 launchd 管。

## 产品灵感库·无界面试点（2026-07-28 → 08-11，ADR-060，所有会话生效）

试点期 agent 就是灵感库的界面，两条义务：

1. **捕获**：用户丢来项目/文章并流露"想用/有启发/可以用到产品"，或明说"存一下"——当场攒卡入素材库：`POST /api/notes`，`noteType:'insight'`，excerpt 首行标记定卡型：
   - 方案卡（需求驱动）：`【方案卡·问题】<用户会用来搜回它的大白话>\n【方案】<名> — <url>\n【要点】…\n【怎么改造进我的产品】…`
   - 灵感卡（供给驱动）：`【灵感卡·启发】…\n【来源】…\n【对我产品的应用】…`
   - 「怎么改造/应用」是判断字段：AI 只起草，须向用户明示可裁决（ADR-044）。
2. **检索**：接到"我想做X / 怎么解决Y"类需求，**动手前先** `GET /api/notes/search-semantic?q=<问题大白话>` 查一遍；命中就明说"你之前存过：…"再干活。**真帮上忙时在 process-log 记一行 `[灵感库捞回]`**（试点就靠这个计数验收，工单见 handoff/）。

## 内容创作模板（ADR-026）

创作层模板是「文体 × 平台形态」正交组合：`reference/prompts/creation/genres/`（6 文体）× `platform-forms/`（10 平台形态），生成 = `draft-frame + genre + platform-form`。改动守 ADR-025 三层原则、ADR-026 价值优先于爆款；每个模板必须接真实语料（`docs/teardowns/`）。
