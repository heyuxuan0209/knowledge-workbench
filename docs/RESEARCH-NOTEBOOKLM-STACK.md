# 调研：链接 → 转写/解读 → 自然语言对话（类 NotebookLM）方案

**调研日期**: 2026-07-13
**需求**: 把任意链接（网页 / 博客 / 小宇宙播客 / YouTube）丢给"即时分析"，自动转写成中文、解读内容、支持类 NotebookLM 的自然语言对话
**原则**: 能复用就不造轮子

---

## 一、结论先行（TL;DR）

这个需求可以拆成**两层**，两层都有成熟开源方案，不需要造轮子：

| 层 | 做什么 | 推荐复用 | 理由 |
|----|--------|---------|------|
| **① 内容提取层** | 任意链接 → 干净文本/Markdown | **Jina Reader**（`r.jina.ai`）主力 + **podcast-transcript skill**（播客兜底） | 一个前缀搞定 90% 网页；播客/视频有专门的转写决策树 |
| **② 对话层** | 基于提取内容做 RAG 对话 | **当前自研的 ephemeral-chat 已够用**，无需引入重型框架 | 单文档/少量文档场景，直接注入上下文比向量库更简单可靠 |

**关键判断**：
- **不要**引入 kotaemon / notebookllama 这类重型 NotebookLM 全家桶——它们绑定 Supabase/N8N/向量库/音频生成，和我们"轻量即兴分析"定位冲突。
- **应该**复用内容提取层的现成方案，这是我们目前最大的短板（YouTube 挂了、小宇宙没做、网页靠 readability 不稳）。

---

## 二、内容提取层调研（重点）

这是当前最该复用的部分。不同链接类型对应不同最佳实践：

### 2.1 通用网页 / 博客 → Jina Reader ⭐ 首选

- **项目**: [jina-ai/reader](https://github.com/jina-ai/reader) ⭐11.5k
- **用法**: URL 前面加 `https://r.jina.ai/` 前缀即可返回 LLM-friendly Markdown
  ```
  https://r.jina.ai/https://example.com/article
  ```
- **优势**:
  - 一行搞定，无需自己维护 readability + jsdom
  - 处理动态渲染页面（SPA）比 readability 强
  - 有免费额度，也可自建（开源）
- **注意**:
  - 国内直连可能超时（实测 HTTP 000），需配 API key 走认证端点或部署代理
  - 商用有速率限制，量大需自建或买 key
- **替代品**:
  - [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) ⭐150k — 更强，支持爬取整站/搜索，但偏重，有 SaaS 收费
  - 自建 [search-result-scraper-markdown](https://github.com/essamamdani/search-result-scraper-markdown) ⭐239 — FastAPI + SearXNG + Browserless

**对我们的意义**: 直接替换 `content-ingestion.js` 里的 `ingestUrl()`（readability 方案），用 Jina Reader 做主力、readability 做兜底。

### 2.2 播客（小宇宙）/ 视频 → podcast-transcript skill ⭐ 首选

- **项目**: [KingJing1/podcast-transcript-txt-skill](https://github.com/KingJing1/podcast-transcript-txt-skill) ⭐37
- **能力**: YouTube / 小宇宙 / Apple Podcasts / X 链接 / 音频 URL / 纯标题 → 干净 TXT
- **设计亮点**（值得直接借鉴的决策树）:
  ```
  优先级 A: 官方 transcript/API（含 YouTube 描述里的外链）
  优先级 B: 平台字幕（yt-dlp，youtube:player_client=android）
  优先级 C: 网页结构化正文
  优先级 D: 本地 ASR 兜底（faster-whisper，small/medium 可选）
  ```
- **为什么好**:
  - 明确的分层降级（官方字幕 → 平台字幕 → 页面文本 → ASR），和我们已有的"抓取失败降级"思路一致
  - 用 `yt-dlp` 而非 `youtube-transcript`（更稳，支持代理，见上次 YouTube 调研结论）
  - ASR 用 `faster-whisper`（本地，不依赖 OpenAI Whisper API，省钱）
  - 附带说话人区分（speaker diarization）—— 播客场景很有用

- **同类可选**:
  - [fleurytian/podcast-transcription-skill](https://github.com/fleurytian/podcast-transcription-skill) — 小宇宙+YouTube+声纹区分
  - [r266-tech/xiaoyuzhou](https://github.com/r266-tech/xiaoyuzhou) — 小宇宙专用只读 CLI（列订阅/浏览单集/**拉官方逐字稿**/搜索），agent-friendly，可直接命令行调用
  - [xinzheli625-wq/Video-Podcast-to-transcript](https://github.com/xinzheli625-wq/Video-Podcast-to-transcript) — YouTube/Bilibili/小宇宙 → Markdown/TXT

**对我们的意义**:
- 小宇宙有专门工具（`r266-tech/xiaoyuzhou` 能直接拉官方逐字稿，不用 ASR）
- YouTube 改用 `yt-dlp`（上次调研已确认这是唯一能配代理的方案）
- 无字幕内容用 `faster-whisper` 本地转写兜底

### 2.3 微信公众号 / 飞书 → qiaomu-markdown-proxy（已调研）

- **项目**: [joeseesun/qiaomu-markdown-proxy](https://github.com/joeseesun/qiaomu-markdown-proxy) ⭐489
- **能力**: 公众号（Playwright 抓取）/ 飞书文档（API）/ PDF
- **注意**: 它的 YouTube 是转交给 `yt-search-download` skill，自己不实现——印证了"YouTube 要专门工具链"

---

## 三、对话层调研

### 3.1 重型 NotebookLM 全家桶（不推荐直接套用）

| 项目 | Stars | 技术栈 | 为什么不适合我们 |
|------|-------|--------|-----------------|
| [Cinnamon/kotaemon](https://github.com/Cinnamon/kotaemon) | ⭐25.5k | Python + 向量库 | RAG 全家桶，重，为"大量文档库"设计 |
| [run-llama/notebookllama](https://github.com/run-llama/notebookllama) | ⭐1.9k | LlamaCloud | 绑定 LlamaCloud，偏 LlamaIndex 生态 |
| [insights-lm-public](https://github.com/theaiautomators/insights-lm-public) | ⭐648 | Supabase + N8N + React | 绑定 Supabase/N8N，部署重 |
| [souzatharsis/podcastfy](https://github.com/souzatharsis/podcastfy) | ⭐6.4k | Python | 只做"内容→播客音频"，是 NotebookLM 的音频功能，不是我们要的 |

**判断**: 这些都是"完整产品"，绑定了向量库/工作流引擎/音频生成。我们要的是"选中内容 → 对话"，当前 `ephemeral-chat.js` 的**上下文直接注入**方案对单文档/少量文档更简单可靠，不需要向量检索。

### 3.2 最接近我们需求的参考 ⭐

- **项目**: [atoncooper/MindBase](https://github.com/atoncooper/MindBase) ⭐31
- **描述**: 把 B站收藏 + 云文档变成可对话的个人知识库
- **技术栈**: Agentic RAG + ASR 转写 + Milvus 向量搜索 + 多 LLM（OpenAI/Anthropic/**DeepSeek**）+ 完整来源引用
- **为什么值得看**:
  - 和我们定位最像（个人知识库 + 内容转写 + 对话 + 来源引用）
  - 用了 DeepSeek（和我们一样）
  - 有"完整 source citation"（对应我们架构文档 §7 的引用可信度）
- **借鉴点**: 它的 ASR → 向量 → 引用 链路，是我们 Phase 2/3 做 Topic 研究时的参考

---

## 四、对我们的具体建议

### 现状短板
1. YouTube 字幕：`youtube-transcript` 国内挂了（上次调研已确认）
2. 小宇宙播客：完全没做
3. 网页正文：靠 `readability`，动态页面经常抓不到

### 推荐改造（按性价比排序）

#### ✅ 改造 1：网页提取换 Jina Reader（低成本高收益）
- 替换 `content-ingestion.js` 的 `ingestUrl()`
- Jina Reader 主力 + readability 兜底
- 解决动态页面抓不到的问题
- **成本**: 半天

#### ✅ 改造 2：接入小宇宙官方逐字稿（低成本）
- 参考 [r266-tech/xiaoyuzhou](https://github.com/r266-tech/xiaoyuzhou) 拉官方 transcript
- 小宇宙很多播客有官方逐字稿，不需要 ASR
- **成本**: 1 天

#### ✅ 改造 3：YouTube 换 yt-dlp（中成本，解决国内访问）
- 用 `yt-dlp` 替换 `youtube-transcript`
- 支持代理配置（`--proxy`）
- 借鉴 podcast-transcript skill 的分层降级决策树
- **成本**: 1-2 天

#### 🔄 改造 4：无字幕内容加 faster-whisper 兜底（中成本）
- 本地 ASR，不依赖 OpenAI Whisper API（省钱）
- 处理无官方字幕的播客/视频
- **成本**: 2 天（含模型部署）

#### ❌ 不做：引入向量库/RAG 框架
- 当前"上下文直接注入"对即时分析足够
- 向量检索留到 Phase 3 做 Topic 研究（大量文档）时再考虑
- 那时可参考 MindBase 的 Milvus 方案

### 统一架构建议

把内容提取做成**分层降级的 resolver**（借鉴 podcast-transcript skill 的决策树）：

```
输入链接
  → 判断类型
     ├─ 微信公众号  → Playwright（参考 qiaomu-markdown-proxy）
     ├─ 小宇宙       → 官方逐字稿 API（参考 r266-tech/xiaoyuzhou）
     ├─ YouTube/播客 → yt-dlp 字幕 → faster-whisper ASR 兜底
     ├─ 飞书文档     → 飞书 API
     └─ 普通网页     → Jina Reader → readability 兜底
  → 统一产出干净文本
  → 翻译成中文（已有 translation.js）
  → 注入对话上下文（已有 ephemeral-chat.js）
```

这个 resolver 层是我们该自研的**唯一新代码**——但每个分支都复用现成方案/skill，不从零造轮子。

---

## 五、参考资源汇总

### 内容提取
- [jina-ai/reader](https://github.com/jina-ai/reader) ⭐11.5k — URL→Markdown 前缀服务
- [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) ⭐150k — 全能爬取（重）
- [KingJing1/podcast-transcript-txt-skill](https://github.com/KingJing1/podcast-transcript-txt-skill) ⭐37 — 播客转写决策树
- [r266-tech/xiaoyuzhou](https://github.com/r266-tech/xiaoyuzhou) — 小宇宙官方逐字稿 CLI
- [fleurytian/podcast-transcription-skill](https://github.com/fleurytian/podcast-transcription-skill) — 小宇宙+YouTube 声纹区分
- [joeseesun/qiaomu-markdown-proxy](https://github.com/joeseesun/qiaomu-markdown-proxy) ⭐489 — 公众号/飞书/PDF

### 对话 / NotebookLM 参考
- [atoncooper/MindBase](https://github.com/atoncooper/MindBase) ⭐31 — 最接近的个人知识库（B站+ASR+DeepSeek+引用）
- [Cinnamon/kotaemon](https://github.com/Cinnamon/kotaemon) ⭐25.5k — RAG 全家桶（Phase 3 参考）
- [run-llama/notebookllama](https://github.com/run-llama/notebookllama) ⭐1.9k — LlamaCloud NotebookLM
- [souzatharsis/podcastfy](https://github.com/souzatharsis/podcastfy) ⭐6.4k — 内容→播客音频

### ASR
- faster-whisper — 本地 Whisper（省 API 费用）
- [matatonic/openedai-whisper](https://github.com/matatonic/openedai-whisper) ⭐91 — OpenAI 兼容的 Whisper 服务

---

**调研结论**:
- **内容提取层**是短板，应复用 Jina Reader（网页）+ 播客 skill（音视频），做一个分层降级 resolver
- **对话层**当前自研方案已够用，不引入重型 RAG 框架
- **唯一该写的新代码**：统一 resolver（每个分支都调现成方案，不造轮子）
- Phase 3 做 Topic 研究时，再参考 MindBase/kotaemon 的向量检索方案
