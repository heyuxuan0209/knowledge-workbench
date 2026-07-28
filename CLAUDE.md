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
- **交接文档**：只进 `handoff/`（docs/ 里不再放 HANDOFF-*）；被新交接取代或超过 7 天未更新的旧交接，移入 `archive/handoffs/`。
- **创作类文件**（草稿/成品/发布模板/灵感）：**本仓不收**，一律去独立工作区 `~/Documents/项目/writing/`（纯本地私有仓）。本仓的 process-log/DECISIONS 是它的选题燃料源，只读引用。
- **实验输出**（cluster dump 之类一次性数据）：进 `archive/experiments/`。
- 每轮开发收尾跑 `/tidy-closeout`（残留巡检 + 留痕检查 + git 边界检查）。

## 内容创作模板（ADR-026）

创作层模板是「文体 × 平台形态」正交组合：`reference/prompts/creation/genres/`（6 文体）× `platform-forms/`（10 平台形态），生成 = `draft-frame + genre + platform-form`。改动守 ADR-025 三层原则、ADR-026 价值优先于爆款；每个模板必须接真实语料（`docs/teardowns/`）。
