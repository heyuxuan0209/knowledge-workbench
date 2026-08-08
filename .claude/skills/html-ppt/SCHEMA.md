# html-ppt 数据契约 v2（场次 session）

> 定稿依据 **ADR-086**（模板选型 + 三个静默失败）、**ADR-087**（分层与受众）、**ADR-088**（场次类型 + 真适配）。
> 这是**入会 agent ↔ 渲染器**之间的唯一约定。

---

## 零、v1 → v2 改了什么（两个真错误）

**① 不是所有录音都是会议。** v1 把一切都当 `meeting`，硬塞决策/待办。拿飞书 DemoDay 试渲染，出来的是：

> **决策 · 0** ｜ 本次会议无正式决策
> **待办 · 0** ｜ 本次会议无待办

荒谬。DemoDay 本来就不该有这两块。
v1 的契约里写过「空块要显式渲染成『无』，不能隐藏」——**那条在真会议里对**（"无决策"是一个信息），
**套到分享会上就错了**（那个块根本不该存在）。
v2 用 `type` 决定**块的组合**：不属于该类型的块直接不渲染。

**② `slides` → `blocks`，`1920×1080 + scale` → 两套布局。** v1 用定尺画布 + `transform: scale()`
适配手机，那是**压缩**，字会小到看不清。v2 是同一份数据、同一份 HTML、**两套 CSS 布局**：

| 视口 | 布局 | 说明 |
|---|---|---|
| 窄屏 / 竖屏（手机） | **纵向流式分享页** | 真字号（正文 16px，实测无 <13px 元素）、表格拆成卡片、零横向溢出 |
| ≥1000px 且横向 | **定尺 1920×1080 翻页** | 键盘翻页、溢出复测、自动分页降级 |

切换靠 `@media (min-width:1000px) and (min-aspect-ratio:5/4)`，JS 用 `matchMedia` 同步。

---

## 一、Session 结构

```jsonc
{
  "type": "interview",              // 见 §二，决定有哪些块
  "lang": "zh",
  "speakerInferred": true,          // 转写无说话人分离时置 true，页脚会打免责
  "meta": {
    "title": "用户访谈 · 做课程的 K 老师",
    "subtitle": null,
    "date": "2026-08-05",           // 可空
    "duration": "52 min",           // 可空
    "participants": ["K 老师"],      // 可空
    "myRole": "访谈者",              // 可空 —— 我在场干嘛，决定这份记录的视角
    "brand": "杰西卡聊 AI",
    "source": {                     // 强烈建议给：原始妙记 / 录屏
      "label": "妙记逐字稿",
      "url": "https://my.feishu.cn/minutes/obcnxxxx"
    }
  },
  "blocks": [ /* 见 §三 */ ]
}
```

**空值约定**：`meta` 任何字段可空，渲染器**不得编造**，留空即可。

---

## 二、场次类型（type）

| type | 中文 | 我在场干嘛 | 块 |
|---|---|---|---|
| `meeting` | 会议纪要 | 参与决策 | `oneliner` `narrative` `decisions` `todos` `topics` `quotes` |
| `talk` | 分享会 / DemoDay | 听别人讲 | `oneliner` `narrative` `outline` `appraisal` `resources` `takeaways` `quotes` `seeds` |
| `chat` | 对谈 | 交换看法 | `oneliner` `narrative` `topics` `appraisal` `takeaways` `resources` `quotes` `seeds` |
| `interview` | 用户访谈 | 问用户 | `oneliner` `narrative` `persona` `saidVsDid` `hypotheses` `appraisal` `quotes` `todos` `seeds` |
| `myTalk` | 我的分享 | 我在台上 | `oneliner` `narrative` `outline` `feedback` `retro` `quotes` `seeds` |
| `plan` | 计划 | 口述一个还没定死的计划 | `oneliner` `narrative` `itinerary` `booking` `tradeoffs` `budget` `pitfalls` `checklist` `quotes` `seeds` |

**块按 `blocks` 数组顺序渲染**（不是按上表顺序）。建议序：`oneliner` → `narrative` → 主体 → `quotes` → `seeds`。

**类型由 agent 判，但必须在产出里明说**（"我把它当成分享会处理了"），判错一句话就能改。
传了不属于该类型的块 → **丢弃 + warn**，不报错（宁可少一块，不要出现「决策 · 0」）。

---

## 三、块（blocks）

### 通用

**`oneliner`** — 一句话：这场到底怎么回事
```jsonc
{ "type": "oneliner", "text": "她要的不是「更快写完」，是「别再从零开始想」" }
```

**`quotes`** — 值得记住的原话（**上限 3 条，硬性**，超出截断并 log）
```jsonc
{ "type": "quotes", "items": [{ "text": "…", "who": "K 老师", "ts": "00:18:20" }] }
```
`ts` 是妙记时间码，当**文字锚点**用——会议纪要里不放视频位（ADR-086 收口）。

**`narrative`** — 过程叙述 ★ **「太干」的解药**
```jsonc
{ "type": "narrative", "title": "现场是怎么展开的", "items": [
  { "ts": "01:12:40", "heading": "「赋能所有行业」那一刻场子凉了",
    "text": "第 5 位讲通用 RAG，被主持人问「你自己平时用它检索什么」，他答不上来…" }]}
```
**不是 bullet，是段落。** 纪要只留结论就没法反刍——过程里的转折、谁被问住了、气氛什么时候变的，
这些才是后来能长出观点的东西。`ts` 是时间码，有 `meta.source.url` 时会挂成回原始材料的链接。

**`appraisal`** — 观点体检 ★ **别全盘接收**
```jsonc
{ "type": "appraisal", "items": [
  { "claim": "AI 产品应该先做通用能力，行业场景后面自然会来",
    "who": "第 5 位分享者", "ts": "01:12:40",
    "evidence":   "没有给出案例或数据，只举了「大模型能力在涨」这一个趋势",
    "reasoning":  "能力涨 → 通用产品有价值 → 所以先做通用。第二跳没有中间论据",
    "assumption": "默认「通用能力」和「用户愿意付钱」是同一件事",
    "boundary":   "在基础设施层可能成立；在应用层，用户买的是场景不是能力",
    "counter":    "同场第 3、第 7 位都是极窄场景起步，现场反证就在隔壁",
    "myVerdict":  null }]}
```
六栏对应「观点易得，真相难寻」那套追问：**事实依据 / 推理链条 / 隐含假设 / 适用边界 / 最强反方**。

> **`myVerdict` 是判断，AI 不许替他填**（ADR-044：产品只标准化"重复不判断"的事）。
> 留空时渲染成「**待你裁决 —— 这一栏 AI 不替你填**」。AI 只填能从材料里抽出来的五栏。

**`seeds`** — 可沉淀选题（这是内容流水线的燃料，不是会议要素）
```jsonc
{ "type": "seeds", "items": [{ "title": "《…》", "why": "为什么值得写" }] }
```

**`takeaways`** — 对我的启发
```jsonc
{ "type": "takeaways", "title": "对我的启发", "items": [{ "title": "…", "note": "…" }] }
```

**`resources`** — 提到的工具 / 资源。招牌是**可用性**列（沿用飞书机器人现有纪要里的【✅现在就能用】）
```jsonc
{ "type": "resources", "items": [
  { "name": "飞书妙记 API", "what": "会后自动拿逐字稿", "status": "ready", "url": "…" }]}
```
`status`：`ready` ✅现在就能用 ｜ `soon` 🔸要折腾一下 ｜ `watch` 👀先观望 ｜ `paid` 💰要付费

**`topics`** — 议题与讨论（观点归属到人 + 分歧）
```jsonc
{ "type": "topics", "title": "聊了哪些事", "items": [
  { "title": "…", "views": [{ "who": "老 W", "text": "…" }],
    "conflict": "…", "resolved": false }]}
```

**`outline`** — 讲了什么（脉络，有序）
```jsonc
{ "type": "outline", "title": "我讲了什么", "items": [{ "title": "…", "note": "…" }] }
```

### 会议 / 访谈

**`decisions`** — 决策 + 未达成结论（超 9 条自动分页，编号连续不重排，未达成结论只挂最后一页）
```jsonc
{ "type": "decisions",
  "items": [{ "id": "D-01", "text": "…", "by": "雨轩" }],
  "unresolved": [{ "text": "…" }] }
```

**`todos`** — 待办 + 遗留问题（同上分页规则）
```jsonc
{ "type": "todos",
  "items": [{ "text": "…", "owner": "雨轩", "due": "08.12", "done": false }],
  "open": [{ "id": "Q-01", "text": "…" }] }
```

### 用户访谈专属

**`persona`** — 受访者与场景
```jsonc
{ "type": "persona", "who": "…", "context": "…", "current": "…", "trigger": "…" }
```
`current`（现在怎么解决）比 `who` 更重要 —— **他现在的土办法就是你的真竞品**。

**`saidVsDid`** — 他说的 vs 他做的 ★ 招牌块
```jsonc
{ "type": "saidVsDid", "items": [
  { "said": "希望有个 AI 能一键写出我风格的文章",
    "did":  "她实际存了 12 个 prompt 在备忘录里，每次复制粘贴改几个字",
    "gap":  "她要的不是「生成」，是「不用每次重新交代背景」" }]}
```
用户研究最容易被「我想要 X」骗。**没有 `did` 的访谈基本不能用** —— 只有愿望没有行为证据。
页脚固定打一行：「说的是愿望，做的是事实。两者冲突时，以『做的』为准。」

**`hypotheses`** — 产品假设验证。**这是访谈的真正产出**：访谈前有假设，访谈后必须更新。
```jsonc
{ "type": "hypotheses", "items": [
  { "text": "用户的核心痛点是写得慢", "verdict": "refuted",
    "evidence": "「写其实很快，是每次要重新告诉它我是谁很烦」" }]}
```
`verdict`：`confirmed` ✅证实 ｜ `refuted` ❌证伪 ｜ `unclear` ❓待验证
空数组时渲染成「本次没有可验证的假设——**下次访谈前先把假设写下来**」。

### 计划专属（`plan`）

**为什么单独一类**：把旅行计划硬塞进 `myTalk`，会渲染出「现场反应 —」「复盘 — — —」「没有值得直引的原话」
——**独白没有现场反应、不需要复盘、不会引用自己**。这是「决策 · 0」那个错误的翻版。

**`itinerary`** — 逐日行程 ★ **投屏模式一天一页**（7 天塞一页必然溢出；按天切也对齐读者心智）
```jsonc
{ "type": "itinerary", "items": [
  { "day": "Day 2", "title": "大同 → 悬空寺 → 应县木塔", "meta": "140km · 车程 2.5h",
    "stops": [{ "time": "08:20", "name": "悬空寺 + 恒山", "dur": "2.5h", "price": "¥15 + ¥100",
                "note": "…", "alt": "恐高或没抢到登临票 → 山下远观即可" }],
    "stay": "砂河镇酒店（比台怀镇便宜）", "tip": "山路弯道多，限速 60" }]}
```
`alt` 是**备选/兜底**，绿底渲染——计划里"下雨改去哪"这类信息以前只能塞进备注。

**`booking`** — 前置预约 ★ **计划类最该被单独拎出来的一块**
```jsonc
{ "type": "booking", "items": [
  { "what": "悬空寺登临票", "how": "公众号「恒山风景名胜区」", "when": "提前 7 天 · 早 7:20 放票",
    "note": "每日仅 2470 张。没抢到只能远观", "critical": true }]}
```
`critical: true` 整行粉底 + 「必抢」标。页脚固定：**「这一栏没做完，后面整条行程都可能白跑。」**
**会失败、有截止的事，不该和普通待办混在一起。**

**`tradeoffs`** — 取舍 ★ **计划的核心**
```jsonc
{ "type": "tradeoffs", "items": [
  { "chose": "北→南顺向环线", "gave": "按「最想去哪」自由排序",
    "cost": "路线一旦排错就得原路折返", "why": "7 天能把四段古建全串上" }]}
```
空数组时渲染成「**没记下取舍——那这份计划其实还没做决定**」。

**`budget`** — 预算（分项 + 合计黑底条）　**`pitfalls`** — 避坑（粉卡片）
**`checklist`** — 要准备什么（分组勾选，收件人是自己，所以没有 owner/due）

### 我的分享专属

**`feedback`** — 现场反应 / 被问到什么
```jsonc
{ "type": "feedback", "items": [{ "title": "「你这套能给我用吗」", "note": "三个人先后问" }] }
```

**`retro`** — 复盘（三栏）
```jsonc
{ "type": "retro", "good": ["…"], "bad": ["…"], "next": ["…"] }
```

---

## 四、投屏模式的容量与溢出（流式模式不受此限）

实测（1920×1080、单行不换行）：**单栏 11 条临界，第 12 条越过页脚**。安全预算 **9 条**，
留 2 条余量是因为**文本一换行就占双倍高度**——条数只是廉价预筛，不是充分条件。

**渲染后必须量一次**（`backend/ppt/measure.py`，Python playwright）。降级阶梯：
字号降一档 → 行距收紧 → **拒绝出片**并报出「第 N 页超出 X px」。

> 溢出是**静默**的：没有滚动条、不报错、元素 `overflow` 检测返回 `false`，内容直接被压到页脚下切掉。
> 不量就等于没解决。

**`decisions` / `todos` 自动分页；`topics` / `quotes` / `resources` 等不会**——降到底就拒绝出片，需人工拆。

---

## 五、渲染器的三条硬约束

1. **所有文本经 `esc()`。** Node 里没有 `textContent`，等价物是每个插值点都转义。实测过：条目含 `<video>` 未转义会被渲染成空播放器框，整行文字被吃掉。
2. **所有计数从 `array.length` 派生。** 模板里不许出现 `决策 · 2` 这种字面量。
3. **该有的空块显式说「无」，不该有的块根本不渲染。** 这两件事不是一回事——见 §零①。

---

## 六、调用约定

```
POST /api/ppt/session   { session }  →  { success, data:{ name, url, warnings } }
GET  /ppt/:name                      →  产物（保留 30 天）
```

命令行：`node backend/ppt/build.mjs <session.json> -o <out.html>`

失败 **422** + 具体哪页超多少像素，**不返回半成品**。

**追问出口**：手机流式模式底部固定一条「这页是提炼，不是全部」——挂原始材料链接，
并写明**想深入问就回飞书私聊问机器人**（它有逐字稿和上下文，HTML 是死的）。
投屏模式隐藏这条（讲的人不需要），原始材料链接收进页脚。

**受众边界**：产物走 tailnet，只有本人能开——**这是刻意的**（ADR-087）。
给没参会的人看的那份是**飞书文档**（可搜索、可评论、能 @人），走 `POST /api/feishu/draft-doc`。

---

## 待办

- [ ] `topics` / `resources` 等块**不会自动分页**，只能降级；降到底拒绝出片
- [ ] 投屏模式的容量只实测了 `decisions` / `todos`
- [ ] 主题只有 `raw-grid`。加主题＝新写 CSS 分支，并照该主题 `design.md` 的「CJK」节执行，**不要自己发挥中文适配**
