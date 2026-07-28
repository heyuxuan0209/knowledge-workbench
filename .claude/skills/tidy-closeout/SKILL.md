---
name: tidy-closeout
description: >-
  knowledge-workbench 每轮开发的收尾巡检：扫会话残留（mock/游离文件/过期
  handoff）、查留痕完整性（DECISIONS/process-log）、巡 git 公开仓边界，
  出确认清单后才清理。触发：用户说「收尾」「/tidy」「tidy-closeout」
  「整理一下项目」「清理残留」，或一轮功能开发/选型结束时主动建议。
  不用于：整机磁盘清理、代码重构、纯文档写作。
---

# tidy-closeout — 本项目收尾巡检

思路借自 khazix neat-freak 轻量路径（盘点→对齐→残留清点→确认后删），规则按本项目定制。**全程先只读巡检、后统一出清单，移动可直接做（可逆），删除必须用户确认。**

## 红线（先读）

1. `docs/DECISIONS.md`、`docs/process-log.md` **只 Edit 局部插入，禁止 Write / 移动 / 重排**（并发硬纪律，见 CLAUDE.md）。
2. 用户可能有其它 agent 会话在跑：巡检开始前问一句或看进程；移动别的会话正在用的目录=撞车。拿不准就只出报告不动手。
3. 只 commit 不 push（全局纪律）。

## 巡检四步

### 1. 扫残留

```bash
git status --porcelain          # 游离新文件
ls frontend/public/ | grep -i mock   # 不该在这的 mock（规则：mock 只进 prototype/）
ls handoff/                     # 除 README 外的每个工单：对着 git log 验证活干完没
find . -maxdepth 1 -type d -empty    # 空目录
find . -name __pycache__ -o -name .DS_Store | grep -v node_modules | head
```

**handoff 工单逐个验收**：对 `handoff/` 里每个工单，用 `git log`/代码实证"活干完没"（别只看日期新旧——上次就是只按日期归档，漏了一张已完工的工单）。干完 → 移入 `archive/handoffs/`；没干完 → 留着并在汇报里点名。**本轮会话自己干完的工单，当场归档，这是收尾的义务动作。**

对照 CLAUDE.md「文件放哪」逐项判断归属：mock→`prototype/mock-pages/`（并更新 `prototype/README.md` 索引状态）、交接→`handoff/`、实验输出→`archive/experiments/`、创作类→`~/Documents/项目/writing/`（提醒用户或直接搬）。

### 2. 查留痕

回顾本轮会话：有没有发生**决策**、**踩坑/改主意**、**里程碑**？

- 决策没进 `docs/DECISIONS.md` → 按现有格式补 ADR（查末尾最新号 +1，append 到文件末尾）
- 踩坑没进 `docs/process-log.md` → 锚定标题行 Edit 插入其下（最新置顶），带会话标记如 `[feed]`，填「能长出的选题」栏

### 3. 巡边界

对 `git status` 里每个新文件问：该 commit（代码/prompt/skill）还是该 ignore（个人内容/数据/密钥）？公开仓只推代码+prompt+skills；新出现的目录若属本地留痕类，补 .gitignore 规则。顺手看 README 说的启动方式/功能和当前代码有没有明显对不上的（对不上以代码为准改 README）。

### 4. 出清单汇报

统一输出：已移动项（含原路径→新路径）、已补留痕、**删除候选清单（等确认，未确认不删）**、发现但没动的问题。
