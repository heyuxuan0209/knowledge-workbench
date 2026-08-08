---
name: html-ppt
description: 把一场录音/会议的结构化产出渲染成品牌 HTML 页（Raw Grid 主题，中文）。六种场次类型各有各的块：会议纪要 meeting / 分享会 talk / 对谈 chat / 用户访谈 interview / 我的分享 myTalk——分享会不该有「决策」和「待办」。同一份产物在手机上是纵向滚动分享页、在宽屏上是投屏翻页 deck。触发：入会 agent 处理完录音要「出片 / 做成 PPT / 做成分享页」，或用户说「把这场做成一页」。不用于：做对外演讲片（那 6 套是手工复制模板改字，见 prototype/html-ppt-mocks/）、做公众号排版（用 gzh-design）、做信息图（用 baoyu-infographic）。
---

# html-ppt · 场次出片

定稿依据 **ADR-086 / 087 / 088**。数据契约见 [`SCHEMA.md`](./SCHEMA.md) —— 改字段前先读它。

## 什么时候用

上游是录音 / 飞书妙记逐字稿的结构化产出。本 skill 把它变成一个单文件 HTML：
**手机上是纵向滚动的分享页，宽屏上是投屏翻页 deck**——同一份数据、同一份文件、两套布局。

## ⚠️ 先判场次类型，别一律当会议

**不是所有录音都是会议。** 超过 30 分钟的谈话都可能被录：线上会议、分享会、DemoDay、
和人聊天、用户访谈、自己上台。硬套「决策 / 待办」会渲染出「决策 · 0 ｜ 本次会议无正式决策」——
在真会议里"无决策"是个信息，在 DemoDay 上那个块**根本不该存在**。

| type | 中文 | 我在场干嘛 | 招牌块 |
|---|---|---|---|
| `meeting` | 会议纪要 | 参与决策 | 决策 / 待办 / 遗留 |
| `talk` | 分享会 · DemoDay | 听别人讲 | **过程叙述** / **观点体检** / 提到的工具（带可用性） / 启发 |
| `chat` | 对谈 | 交换看法 | **过程叙述** / **观点体检** / 议题与分歧 / 可沉淀选题 |
| `interview` | 用户访谈 | 问用户 | **他说的 vs 他做的** / **假设验证** / 受访者画像 |
| `myTalk` | 我的分享 | 我在台上 | 我讲了什么 / 现场反应 / 复盘 |

**类型由你判，但要在回复里明说**「我把它当成分享会处理了」——判错用户一句话就能改，
比每次先问他省事。传了不属于该类型的块会被丢弃并 warn。

## ⚠️ 别提炼过头：过程和体检两块是硬要求

**只留结论的纪要没法反刍。** 每份都要有 `narrative`（过程叙述，段落不是 bullet：
转折在哪、谁被问住了、气氛什么时候变的）。

**听别人讲的场次（talk / chat / interview）必须有 `appraisal` 观点体检**：
事实依据 / 推理链条 / 隐含假设 / 适用边界 / 最强反方。
**`myVerdict`（我接不接受）留空，AI 不替他填**——那是判断，渲染成「待你裁决」。

**`meta.source` 尽量给**（妙记 / 录屏链接）。给了之后所有时间码会挂成回原始材料的链接，
页面底部也会出现「看原始逐字稿」。**别把这页当终点**——它是提炼，追问要回到对话里。

**对外演讲片不走本 skill**：另外 6 套模板（A/B/I/O/Q/R）在 `prototype/html-ppt-mocks/`，
用法是复制一份 HTML 改文字。理由见 ADR-086：「要不要工程化」由「谁在批量产出」决定。

## 怎么用

**产品里（推荐，入会 agent 走这条）** —— 出片后拿到一个能点开的 URL：

```bash
curl -X POST http://kw-vps:3000/api/ppt/session \
  -H 'Content-Type: application/json' -d '{"session": { ... }}'
# → { success:true, data:{ name, url:"/ppt/20260808-0143-xxx.html", warnings:[] } }
```

失败返回 **422** + 具体原因（如「第 8 页超出 359px」），**不返回半成品**。

**命令行（本地调试）**：

```bash
node backend/ppt/build.mjs <session.json> -o <out.html>
```

`session.json` 的结构见 SCHEMA.md §一/§三。`examples/` 下五种类型各有一份可直接跑的样例。

成功时 stdout 打印输出路径；**失败时不产出半成品**，退出码非 0 并说明哪一页超了多少像素。

跳过溢出检测（只在本地快速预览时用，**别在自动管线里用**）：
```bash
node backend/ppt/build.mjs session.json --no-verify
```

## 它替你挡住的三件事

这三个都是在 `prototype/html-ppt-mocks/H-RawGrid中文.html` 上**实测出来**的静默失败——
不报错、不留痕迹，agent 会以为自己成功出片了：

| 失败 | 现象 | 挡法 |
|---|---|---|
| **溢出无声** | 待办到 12 条，「遗留问题」被压到页脚下、`Q-01` 切掉一半；无滚动条、`overflow` 检测返回 `false` | 条数预算（单栏 9 条，实测 11 条临界）+ **渲染后 playwright 量画布**（只对投屏模式） |
| **计数硬编码** | 表头写「待办 · 3」，底下已经 12 行 | 计数一律 `array.length` 派生，模板里无字面量 |
| **尖括号被当标签** | 条目含 `<video>` 时渲染成空播放器框，整行文字被吃掉 | 每个插值点 `esc()` |

溢出的降级阶梯：字号降一档 → 行距收紧 → 仍超则**拒绝出片**并报出具体页码和像素数。
`decisions` / `todos` 超限自动分页（「（续）」页，编号连续不重排，未达成结论 / 遗留问题只挂最后一页）；
**绝不因为放不下就丢条目**——meeting.md 的规矩是「决策和待办必须逐条穷尽，宁多勿漏」。

## 依赖

- **Node**：无第三方依赖，纯字符串拼装。
- **溢出探针**：`backend/ppt/measure.py` 走 **Python playwright**。VPS 上装的就是它
  （仓内 `.venv`，供头图渲染，见 `backend/scripts/provision-render-env.sh` + ADR-080）。
  Node 版 playwright 只在 Mac 的 `backend/node_modules`（给 platform-export 用登录态），
  **服务器上没有** —— 第一版写成 `import('playwright')` 直接 `ERR_MODULE_NOT_FOUND`，别改回去。
  换解释器用 `HTMLPPT_PYTHON=/path/to/.venv/bin/python`。

## 文件（分层见 ADR-087）

```
.claude/skills/html-ppt/
├── SKILL.md                     本文件
├── SCHEMA.md                    数据契约（唯一约定，改字段先读它）
└── examples/*.json              五种场次类型各一份可直接跑的样例

backend/ppt/                     渲染引擎（资产层，和 backend/series/ 平级）
├── render.mjs                   deck JSON → HTML 字符串（分页 / 转义 / 计数派生）
├── build.mjs                    出片入口（render → 量 → 降级 → 再量 → 写盘或报错）
└── measure.py                   溢出探针（Python playwright）

backend/src/services/ppt.js      产品层：spawn build.mjs、落盘、清理过期产物
backend/data/ppt/                产物（保留 30 天，不进 git）
```

**引擎不在 skill 目录里。** 产品代码不该依赖 `.claude/`（那是 agent 配置区），
所以引擎放 `backend/ppt/`，skill 只留契约和样例 —— 和 `cover.js` → `series/cover_render.py`
的分层一致：**产品代码只 spawn 渲染器，不碰模板**。

## 已知缺口（没假装解决）

- `topics` / `quotes` **不会自动分页**，只能降级；降到底就拒绝出片。议题多的会需要人工拆。
- `topics` 页的容量还没实测（`decisions` / `todos` 已实测：单栏 11 条临界）。
- **不放视频位**。给没参会的人看是要 3 分钟接住信息的，嵌播放器反而拖慢；
  真要指向片段，用 `quotes.ts` 的妙记时间码当文字锚点（ADR-086 遗留 Q-01 按此收口）。
- 手机布局**不做缩放**：定尺画布 + `transform:scale` 会把字压小到看不清，那不叫适配（ADR-088）。
- 主题只有 `raw-grid` 一套。加主题＝新写一个 `render` 的 CSS/结构分支，
  并把该主题 `design.md` 的「CJK & International Content」节照抄执行，**不要自己发挥中文适配**。
