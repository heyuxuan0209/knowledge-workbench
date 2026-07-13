# 项目约定

## handoff/ 目录维护规则

`handoff/` 目录**只保留一份当前生效的交接文档**。

每次架构或阶段发生实质性转折时：
1. 先把 `handoff/` 里现有的文档移到 `archive/deprecated-docs/`（用 `git mv`，不要删除，历史决策轨迹有价值）
2. 再把新的交接文档放进 `handoff/`

不要让新旧交接文档同时留在 `handoff/` 里——旧文档里的"下一步计划"一旦被完成或推翻，会和新文档互相矛盾，误导之后接手的人（或 AI）。

当前唯一有效的交接文档：[`handoff/HANDOFF-TO-NEW-ARCHITECTURE.md`](handoff/HANDOFF-TO-NEW-ARCHITECTURE.md)
当前唯一有效的产品架构基线：[`docs/SYNTHESIZED-ARCHITECTURE.md`](docs/SYNTHESIZED-ARCHITECTURE.md)
