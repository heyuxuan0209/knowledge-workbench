# Knowledge Workbench — 融合产品架构 v2（执行规格）

> **这份文档的定位**
>
> 它融合了三个输入：① 上一版 `CURRENT-PRODUCT-PROPOSAL.md`；② 独立行业调研（Readwise / NotebookLM / Perplexity / Research Rabbit / RSSHub / Roam 等）；③ 产品负责人对真实工作流的关键校正。
>
> 它取代 `CURRENT-PRODUCT-PROPOSAL.md` 作为当前的架构基线。执行时以本文件为准。
>
> **五条基本原则**（贯穿全文，冲突时以此裁决）：
> Reuse First · Open Source First · Best Practice First · Product Thinking First · Code Last。

---

## 0. 一句话定位

一个**从信息消费到知识产出的个人研究工作台**：把每天刷到的碎片信息，沉淀为可追踪的信息网络、可演进的研究主题、可创作的素材资产。

不是资讯聚合器（那层复用现成的），是资讯**之上**的一层。

---

## 1. 与上一版方案的核心差异（先说结论）

| 维度 | 上一版 Proposal | 本版 v2 |
|------|----------------|---------|
| 核心实体 | Content（单篇文章） | Content 为主，Source 为轻量身份层 |
| Source | 未建模 | 架在摄入之上的身份识别 + 标记，**非独立抓取系统** |
| 素材进入方式 | 显式"拖拽收集" | 去掉拖拽；即兴多选 / 关注加权 / 一次性丢链接 |
| 多语言 | 未提及 | **摄入流水线一等公民** |
| 洞察挖掘 | 列为核心缺失 | **整条移除**（伪需求，未验证） |
| 界面 | 资讯流 + 工作区并排（有张力） | 按使用模式分离，不强塞一屏 |
| Topic | 聚类即止 | 聚类 + **演进（evolution）** |

---

## 2. 三个使用模式（不是三个并列功能，是三种心智）

上一版把"材料分析 / 主题追踪 / 创作桥接"并列，导致界面互相拉扯。本版明确：它们是**三种不同心智模式**，共享同一份数据（Content / Source / Topic），但入口和界面分离。

- **Mode 1 · 即兴分析（Ephemeral）**：轻、快、用完即走。
- **Mode 2 · 主题研究（Persistent）**：慢、深、长期演进。
- **Mode 3 · 创作桥接（Output）**：基于 Mode 2 的沉淀产出内容。

### Mode 1 · 即兴分析

**触发**（同一个动作，两种入口，不拆成两个功能）：
- 选中 feed 里已有的一篇或几篇内容
- 或粘贴任意外部链接

**交互**：弹出对话框（类 NotebookLM / ChatGPT），基于选中内容即时问答。

**去掉**：工作区、拖拽收集、三栏布局。选中即分析，无筹备步骤。

**产出归宿**：对话有价值 → 一键 Save（存入某个 Topic 或转为 Research Note）；没价值 → 关闭即走，不留痕。

**设计约束**：从"看到内容"到"开始对话" < 10 秒，键盘可完成（多选 + 唤起对话 + 发送）。

### Mode 2 · 主题研究

以 Topic 为中心的持久空间。Topic 不是一次性素材包，是活的、持续积累、会演进的研究线。详见 §5、§6。

界面独立于 feed（feed 用于扫描，Topic 用于专注），不强塞同一屏。

### Mode 3 · 创作桥接

基于某个成熟 Topic 的沉淀，生成大纲 → 草稿 → 导出。详见 §7。

**注意**：所谓"产品机会 / 趋势判断"等洞察，是本模式下人与 agent 对话讨论的**自然产出**，不是系统主动挖掘推送的功能。不建独立的 Insight Mining 模块。

---

## 3. Source —— 轻量身份层（本版关键澄清）

### 3.1 定位

Source **不是**一套独立于内容摄入的抓取基础设施。它是**架在现有内容摄入之上的一层身份识别 + 标记**。

心智模型对标 **X 的推荐机制**：先从内容里发现感兴趣的人 → 关注 → 未来这个人的信息在 feed 中被重新加权。不是在 Content 之外重建一套 Source 抓取体系。

### 3.2 进入系统的三条路径（且只有这三条）

| # | 路径 | 说明 | 是否建立持续关系 |
|---|------|------|-----------------|
| 1 | **涌现关注** | AI HOT 刷到内容 → 感兴趣 → 关注这个人 | 是 |
| 2 | **批量导入** | 已关注的一批 YouTube / X / 公众号账号一次性交给产品建档 | 是 |
| 3 | **一次性丢链接** | 任意单篇内容，只翻译解读，用完即走 | **否**（这就是 Mode 1，不是 Source 路径的第三种，是同一动作） |

> 不为这三条路径设计交叉矩阵。"发现"和"导入"只是身份进入系统的两种方式，不是两套结构。路径 3 本质属于 Mode 1。

### 3.3 Source 标记影响什么（决定了它值得做，但轻量做即可）

- **Feed 过滤视角**：可切换到"只看我关心的人"
- **Topic 演进呈现**：能标出"这是谁说的"，支撑 §6 的 perspectives 结构
- **创作引用可信度**：产出时标注来源

### 3.4 主动追踪的成本分层（**必须写进设计的技术约束**）

"关注一个人"这个动作，对不同平台成本完全不同，不能一视同仁：

| 关注对象所在平台 | 追踪方式 | 成本 |
|-----------------|---------|------|
| **在 AI HOT 覆盖范围内** | 纯被动，等 AI HOT 推送 | 零额外成本 |
| **不在 AI HOT，但在 X / YouTube** | 产品主动查询，接入平台 API / RSS | 有实现与维护成本 |
| **微信公众号** | **不做主动抓取**，只被动等 AI HOT 推送 + 跳转原文 | 不承担逆向抓取风险 |

> 这个分层是硬约束。设计"关注"功能时，UI 上要能反映"这个 Source 是被动等待还是主动追踪"，且公众号明确不承诺主动更新。

### 3.5 数据模型（一个 Source 多个 Platform）

```
Source {
  id
  type: Person | YouTubeChannel | GitHubUser | Newsletter | Blog
  displayName
  platforms: [                    // 一个身份，多个平台账号
    { platform: 'X',       handle,   trackMode: 'passive' | 'active' | 'link-only' },
    { platform: 'YouTube', channelId, trackMode },
    { platform: 'WeChat',  name,     trackMode: 'passive' }  // 公众号恒为 passive
  ]
  followedSince
  status: active | paused | archived
  tags: []
}
```

`trackMode` 直接由 §3.4 的成本分层决定，不是用户随意配置。

---

## 4. 统一内容模型（Normalization）

不同源结构完全不同（AI HOT 条目 / YouTube 视频 / X 推文 / GitHub Release / Paper），必须归一到一个模型。

```
Content {
  id
  source: Source            // 关联身份层（可为空 = 一次性链接）
  contentType: article | video | tweet | paper | repo
  url
  publishedAt

  raw: {                    // 按类型存在其一
    fullText?               // article / paper
    transcript?             // video（见 §8 流水线）
    readme?                 // repo
  }

  // 多语言（一等公民，见 §8）
  lang: { original, hasTranslation }
  zh: { title, summary, chapters?, body? }
  en: { title, summary, body? }        // 原文保留，供精读对照

  ai: {
    topics: []              // 归类到的 Topic
    perspectives?: [        // Builder 观点提取（video/长文）
      { sourceRef, stance, points: [] }
    ]
  }

  user: {
    readStatus: unread | read | archived
    annotations: []
    savedToTopics: []
  }
}
```

设计参考：RSS/Atom 的基础字段 + Schema.org Article，落地成上面这个超集。

---

## 5. Topic —— 动态形成 + 演进

### 5.1 生成方式：AI 建议 + 用户确认

- 不做全自动（会产噪音："你在研究…？"—"不是"）
- 不做纯手动（摩擦大，坚持不了）
- AI 基于近期阅读聚类 → 提示"这些内容都和 X 相关，建一个 Topic 吗？" → 用户确认/改名/忽略

### 5.2 Topic 是活的，不是素材包

```
Topic {
  name
  status: emerging | active | mature | archived
  sources: []               // 关联的身份
  contents: []              // 相关内容（AI 关联 + 用户确认）
  evolution: [              // §6，核心区别于"聚类即止"
    { date, phase, keyContents, summary }
  ]
  perspectives: [           // 观点多样性，靠 Source 标记支撑
    { source, stance, points: [] }
  ]
  researchNotes             // 用户综合笔记
}
```

---

## 6. Topic Evolution —— 区别于单纯聚类

Topic 的价值不在"把相关内容堆一起"，在于**呈现它如何随时间演进**。

```
Topic Timeline（示意）
──────────────────────────────────────────>
 阶段1: Hype        阶段2: 批判反思     阶段3: 最佳实践
 (概念/Demo)        (局限被讨论)        (方案收敛)
```

每个阶段：AI 归纳该阶段代表内容 + 变化摘要 + 谁在说（perspectives）。

参考：Google Trends 的热度时间线、Research Rabbit 的引用演进、Feedly Leo 的 Momentum。

---

## 7. 创作桥接（Mode 3）

```
成熟 Topic
  → AI 生成大纲（基于该 Topic 全部内容 + 用户批注）
  → 草稿编辑器（用户改 + AI 扩写，每段可回溯引用来源）
  → 导出（飞书文档 / Notion / Markdown）
```

产出形式不限于对话。按场景选择：即兴 → chat；Topic 分析 → 结构化（对比表 / timeline）；创作 → outline → draft。参考 NotebookLM 的多产出形态（Study Guide / Timeline / FAQ）。

**引用可信度**：每段扩写标注来源 Source，靠 §3 的身份层支撑。

---

## 8. 多语言摄入流水线（一等公民，Phase 1 必做）

不是"翻译标题摘要"的轻量层，是一条完整链路，在设计内容模型时就作为一等公民：

```
YouTube 视频
  → Transcript（有字幕取字幕；无字幕 Whisper 转录）
  → 中文翻译（术语表保证一致；分级：重要内容 LLM，一般内容 NMT）
  → 章节分段（transcript 无段落结构，用 LLM 重新分章）
  → Builder 观点提取（这个人在这段里的核心主张）
  → Topic 归类
```

文章/论文走简化版同链路（无 transcript 步骤）。

关键决策：
- 标题/摘要**必须**翻译（供 feed 快速扫描）
- 全文可选翻译（成本/质量权衡，分级处理）
- **原文始终保留**（精读对照）
- 术语表（Glossary）跨内容保证 AI / Agent / RAG 等术语一致

复用：youtube-transcript-api（字幕）· Whisper API（转录）· DeepL（NMT 主力）· LLM（重要内容 + 术语修正 + 分段 + 观点提取）。

---

## 9. 数据源策略（复用优先）

| 源 | 策略 |
|----|------|
| **AI HOT** | 主渠道，复用（发现 + 被动推送的主力） |
| **微信公众号** | 不抓取，只被动等 AI HOT + 跳转原文 |
| **X / YouTube（AI HOT 未覆盖的关注对象）** | 接入官方 API / RSS 做主动查询 |
| RSS/博客 | RSSHub 转 RSS + 标准解析 |

采集层不是壁垒，全部复用。差异化在其上的身份层 + Topic 演进 + 创作桥接。

---

## 10. Phase 演进路径（修正后）

| Phase | 内容 | 说明 |
|-------|------|------|
| **Phase 1** | Mode 1 即兴分析 + **多语言摄入流水线** + **Source 轻量识别标记** | Source 标记提前到 P1，与即兴分析同期；不等独立的"Source Management 阶段" |
| **Phase 2** | Feed 的 Source 加权视角 + 主动追踪（X/YouTube API 接入） | 成本分层落地 |
| **Phase 3** | Topic 涌现 + 演进（evolution / perspectives） | Mode 2 |
| **Phase 4** | 创作桥接 | Mode 3 |

Phase 1 相比上一版的改动：
- 删除工作区 / 拖拽收集 / 三栏并排
- 即兴分析改为"选中/粘贴 → 弹窗对话 → 可选 Save"
- 多语言流水线 + Source 识别标记纳入 P1，不后置

---

## 11. 自建 vs 复用 vs 开源（速查）

| 能力 | 决策 | 依据 |
|------|------|------|
| 内容采集（RSS/API/字幕） | 复用 | feedparser / youtube-transcript-api / RSSHub / 平台 API |
| 翻译 | 复用 | DeepL + LLM 分级 |
| 转录 | 复用 | Whisper API |
| 摘要/结构化提取 | 复用 API + 自建 Prompt | LLM Function Calling |
| Source 身份层 | 自建（轻量） | 业务独有，但不重 |
| Topic 演进引擎 | 自建 | 核心差异化 |
| 创作桥接 | 自建 + 复用编辑器 | 差异化在 context 组装 |
| 洞察挖掘 | **不做** | 伪需求，未验证 |

---

## 12. 交给执行方的注意事项

1. **Code Last**：先确认数据模型（§3.5 / §4 / §5.2）和 Phase 1 范围，再写代码。
2. **成本分层是硬约束**（§3.4），"关注"功能必须体现 passive / active / link-only 差异，公众号恒为 passive。
3. **多语言流水线是 Phase 1 一等公民**（§8），不是后补层。
4. **不要重建 Source 抓取系统**（§3.1）—— 它是内容摄入之上的标记层。
5. **不要实现 Insight Mining**（§2 Mode 3 注）。
6. 界面按使用模式分离（§2），不把资讯流和深度工作区强塞一屏。

