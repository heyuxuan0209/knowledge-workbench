# knowledge-workbench — 工作纪律（每个对话窗口都适用）

> **规则真身在 `CLAUDE.md`，先完整读它**（含多会话并发安全红线、「文件放哪」边界）。本文件只保底核心纪律，两处不一致时以 CLAUDE.md 为准。
> **新接手的 agent**：按 `handoff/README.md` 的接手协议走（五步只读活文件，不信任何"项目现状"快照）。

## 决策与踩坑必须留痕

在结束一段工作前，只要发生了**决策**、**踩坑/改主意**、或完成一个**里程碑**，就必须留痕，不能让上下文随对话窗口关闭而丢失：

1. **决策 → `docs/DECISIONS.md`**：追加一条 ADR，沿用现有格式（`背景（踩坑，有实证）` / `决策` / `思考逻辑` / `后果` / `备选方案`），**编号查文件末尾最新号 +1（别写死、别信任何文档里提到的"当前最新号"——会过期）**，追加到文件末尾；写入只用局部插入（Edit/append），禁止整体重写。
2. **踩坑 / 过程 → `docs/process-log.md`**：追加一条（新条目置顶），带数字和真实情绪，并填「能长出的选题」栏——这是选题的活燃料。
3. **不确定算不算"决策"时**，宁可在 process-log 记一句，也别让它丢。

## 这两个文件纯本地留痕（不进 git）

- `docs/DECISIONS.md` 和 `docs/process-log.md` 是内部记录，**不 git、不 push**——直接编辑保存进本地文件即可，别丢就行，**不要对它俩执行 `git add` / commit**（`docs/` 本就被 .gitignore 排除）。
- 关键是"每次有决策/踩坑就及时写进去"，靠可靠地写、不靠 git。
- 其它代码改动照常提交，但 push / 发布由用户手动确认（遵全局纪律）。

## 内容创作模板（ADR-026）

创作层模板是「文体 × 平台形态」正交组合：`reference/prompts/creation/genres/`（6 文体）× `platform-forms/`（10 平台形态），生成 = `draft-frame + genre + platform-form`。改动守 ADR-025 三层原则、ADR-026 价值优先于爆款；每个模板必须接真实语料（`docs/teardowns/`）。

## Imported Claude Cowork project instructions
