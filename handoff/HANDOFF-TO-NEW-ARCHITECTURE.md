# 交接文档：从 v0.2.1 到新架构（v2）

**给新窗口的开发者/AI 阅读**

**日期**: 2026-07-10
**背景**: 经过多轮产品讨论（含另一个 Claude 的独立架构评审），确定了一套新的产品架构，取代之前 v0.1-v0.2.1 探索出的方案。本文档说明：新架构规格在哪、当前代码库哪些能直接复用、哪些要推翻重做、从哪里开始动手。

---

## 1. 先读这份，再动手

**架构基线**：[`docs/SYNTHESIZED-ARCHITECTURE.md`](../docs/SYNTHESIZED-ARCHITECTURE.md)

这是唯一权威的产品架构规格，融合了原始 Proposal + 独立架构评审 + 产品负责人对真实工作流的多轮校正。**它取代了** `docs/CURRENT-PRODUCT-PROPOSAL.md`（后者只是探索过程的记录，不再是设计依据）。

开始写代码前，请确保理解该文档里这几条硬约束（不是建议，是执行时必须遵守的边界）：

- **Source 不是抓取系统，是内容摄入之上的轻量身份标记层**（§3.1）——不要重建 X/YouTube 的订阅推送基础设施
- **主动追踪的成本分层是硬约束**（§3.4）：AI HOT 已覆盖的人纯被动；X/YouTube 未覆盖的人需要接入官方 API 主动查询；**微信公众号不做抓取，只被动等 AI HOT + 跳转原文**——这条不能通融，公众号没有公开 API，逆向抓取的合规和稳定性风险不值得承担
- **多语言摄入流水线是 Phase 1 一等公民**（§8），不是后补的翻译层。具体是 YouTube→Transcript→中文翻译→章节分段→观点提取→Topic 归类这条完整链路
- **不要实现 Insight Mining**（"自动挖掘产品机会/趋势/冲突"这类主动推送洞察的功能）——这是在讨论中被明确否决的伪需求，产品机会应该是 Mode 3 创作对话的自然产出，不是系统主动挖出来推给用户的
- **界面按三种使用模式分离**（§2：即兴分析 Ephemeral / 主题研究 Persistent / 创作 Output），不要把资讯流和深度工作区强塞进同一屏幕——这是上一版最大的失败教训（见第 3 节）

Phase 1 范围见架构文档 §10：即兴分析（Mode 1）+ 多语言摄入流水线 + Source 轻量识别标记。这三项同期做，不要把 Source 标记推到独立的"Phase 2"。

---

## 2. 当前代码库：能直接复用的部分

以下是已经跑通、和"三个场景该怎么设计"这个问题无关、可以直接搬过去用的基础设施。**不需要重新发明**：

| 能力 | 文件位置 | 说明 |
|---|---|---|
| AI HOT 数据拉取 | `backend/src/services/aihot.js` | `fetchAllTodayItems()` 分页拉取 + `transformAIHotItem()` 字段映射，直接可用 |
| AI HOT 定时同步 | `backend/src/services/sync-aihot.js` | 同步入口，写入 `items` 表 |
| LLM 流式对话集成 | `backend/src/services/llm.js` | Deepseek（OpenAI SDK 兼容）+ SSE 流式输出 + token/成本估算，已验证跑通，Mode 1 的即兴对话可直接基于这个改 |
| 成本统计 | `backend/src/services/stats.js` | 今日/本月 token 及花费统计，¥1/M tokens 计价逻辑保留 |
| 技术栈选型 | 见下方"环境" | Node.js 26 + Express + SQLite(`node:sqlite`) + React 18 + Vite + Tailwind，这套选型是踩过坑验证过的（见第 4 节），继续用 |

**环境变量**（`backend/.env`，需自行创建，不提交到 git）：
```
PORT=3000
DEEPSEEK_API_KEY=<从 https://platform.deepseek.com 获取>
DB_PATH=./data/app.db
```

**启动方式**：
```bash
cd backend && node src/server.js     # :3000
cd frontend && npm run dev            # :5173
```

---

## 3. 当前代码库：要推翻重做的部分

这些不是"可以复用、改一改"，是新架构在产品判断上明确否定了的东西，**不要在此基础上修改，直接重新设计**：

- **三栏并排布局**（`frontend/src/pages/WorkspacePage.jsx` + `Sidebar.jsx`）——把资讯流和工作区塞进同一屏幕，被证实是"两种都做不好"（浏览要快扫、深度工作要专注，这两种心智不该共享一个界面）。新架构要求按 Mode 1/2/3 分离界面，不是修这个三栏布局，是不再用这个结构。
- **拖拽收集材料**（`MainContent.jsx` 的 `draggable` + `MaterialsPanel.jsx` 的 `onDrop`）——被证实是不必要的摩擦，用户真实习惯是"随手看到就想问一句"，不是"先筹备素材再分析"。Mode 1 改为"选中/粘贴 → 弹窗 → 即时问答"。
- **`workspaces`/`conversations`/`conversation_materials` 这套数据模型**（`backend/src/db/schema-v2.sql`）——是为"工作区"概念设计的，新架构的核心实体是 Content / Source / Topic（见架构文档 §3.5、§4、§5.2），不是 workspace。这套表结构大概率要换掉，不要在此基础上加字段。
- **v0.1 遗留但从未真正使用的表**（`schema.sql` 里的 `topics`/`topic_items`/`user_preferences`/`research_workspaces`/`research_items`）——这些是更早期"主题追踪"设想的产物，写了但代码里没有任何地方真正读写它们。新架构里 Topic 是核心实体要重新设计，不要试图复活这套旧表结构。
- **Onboarding/StyleSelector 页面**（`OnboardingPage.jsx`/`StyleSelectorPage.jsx`）——代码存在但 `App.jsx` 里默认跳过，是孤儿页面，从未生效。如果新架构需要引导流程，重新设计，不要复用这两个文件。

---

## 4. 技术选型背后的坑（避免重踩）

这几条是纯技术层面、和产品架构无关的经验，直接沿用即可，不需要重新验证：

- **数据库用 `node:sqlite`（Node.js 26 内置），不要用 `better-sqlite3`**——后者在 Node 26 上编译失败（node-gyp 报错）。
- **Deepseek 的多轮对话上下文，材料/背景信息不要用 `system` role 传**——实测 Deepseek 会在某些情况下无法正确识别 system 消息里的内容（具体原因待查，可能是历史消息干扰），已验证的可靠做法是把背景信息直接拼接进当前这条 `user` 消息的前缀里。新架构做 Mode 1 的即兴问答、或 Mode 2/3 的 Topic 上下文注入时，参考这个模式。
- **Tailwind 的 `content` 配置要覆盖所有子目录**，新建组件目录后检查 `tailwind.config.js`，否则样式会突然失效。
- 前端装了 `zustand` 和 `@tanstack/react-query` 但代码里零引用（纯 `useState`/`useEffect`）。新架构如果涉及 Topic 的持久状态管理、跨组件的 Source 标记状态同步，这两个库现成可用，不用重新决定要不要引入。
- **`youtube-transcript` 在国内网络环境下必须配代理，且 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量对 Node 内置 `fetch`（undici）完全不生效**——实测 `curl -x http://127.0.0.1:7897 https://youtube.com` 能拿到 200，但同一台机器上设了 `HTTPS_PROXY` 环境变量的 Node 脚本仍然 `fetch failed`。undici 不读这套约定，必须用 `undici` 的 `ProxyAgent` 显式传给该库支持的 `config.fetch` 注入点（库源码里 `fetchViaInnerTube`/`fetchViaWebPage` 都接受 `config?.fetch ?? fetch`，不要用 `setGlobalDispatcher` 全局劫持，会连带影响不需要代理的请求如 AI HOT/本地 SQLite）。已在 `backend/src/services/content-ingestion.js` 里实现，代理地址由 `.env` 的 `YOUTUBE_PROXY_URL` 配置（未设置时按无代理直连，适配海外服务器部署场景）。排查这类问题时先用 `curl -x <proxy> <url>` 验证代理本身是否可用，再检查目标 HTTP 客户端库是否真的支持这套代理协议，不要停在"代理软件在跑就应该生效"的假设上。
- **没有代理时的报错会误导人**：`youtube-transcript` 库本身把「没字幕」「网络不通」「YouTube 要求验证码」等多种失败原因都归一成通用 `Error`，如果不用 `instanceof` 细分处理，网络问题会被误判成"该视频没有字幕"，排查方向就错了。已在 `content-ingestion.js` 的 `classifyYoutubeError()` 里按库导出的具体 Error 子类分类处理。
- **`youtube-transcript` 不传 `lang` 参数时返回视频默认字幕轨道**，不一定是中文或英文（实测某英文视频返回了阿拉伯语字幕），Phase 1 的翻译流水线设计时需要考虑这一点，不能假设拿到的字幕就是英文原文。

---

## 5. 建议的起步顺序

对应架构文档 §10 的 Phase 1，具体到"从哪个文件开始"：

1. 先定 Content / Source 的数据模型（架构文档 §3.5、§4），替换掉 `schema-v2.sql`
2. 复用 `aihot.js` 的拉取逻辑，但改造 `transformAIHotItem()`，让它产出新的 Content 模型，而不是旧的 `items` 表字段
3. Mode 1 即兴分析：复用 `llm.js` 的流式对话能力，但去掉 workspace/conversation 概念，改成无状态的"选中内容 → 弹窗 → 问答 → 可选 Save"
4. 多语言流水线（架构文档 §8）是新增能力，当前代码库没有任何对应实现，需要从零设计（复用 youtube-transcript-api / Whisper / DeepL 等现成服务，架构文档 §11 已给出选型建议）
5. Source 标记层是新增能力，同样从零设计，但记住它是"轻标记"，不要做成抓取系统（§3.4 的成本分层是设计边界）

---

## 6. Phase 1 开发任务（2026-07-11 追加）

**技术选型已完成**，直接开始实现。详见：
- `docs/TECH-SURVEY-PHASE1.md` — 10 个技术方向的选型调研
- `docs/DECISION-NOTEBOOKLM-APPROACH.md` — 类 NotebookLM 实现方案

### 任务：实现 Mode 1 即兴分析（4.5 天 MVP）

**产品能力**：
- 用户丢进去 YouTube 链接/文章链接/纯文本
- 自动转写、翻译、对话分析
- 生成摘要、观点提取、可选保存到 Topic

**技术栈（已确定）**：
```
YouTube 字幕: youtube-transcript (npm)
YouTube 转录: Whisper API (无字幕时后备，Phase 1 可暂不实现)
网页抓取: @mozilla/readability + jsdom
翻译: Deepseek (已接入 llm.js) + DeepL (可选)
对话: Deepseek (复用 backend/src/services/llm.js)
分段/摘要: Deepseek (不同 Prompt 模板)
```

### 开发顺序（按顺序执行）

#### Task 1: 内容摄入服务（1 天）
**新建**: `backend/src/services/content-ingestion.js`

```javascript
class ContentIngestionService {
  async ingest(input) {
    const type = this._detectType(input);  // youtube / url / text
    
    switch (type) {
      case 'youtube':
        // 使用 youtube-transcript 提取字幕
        const { YoutubeTranscript } = require('youtube-transcript');
        const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh' });
        return { title: '...', body: transcript.map(t => t.text).join(' '), type: 'youtube' };
      
      case 'url':
        // 使用 @mozilla/readability 提取正文
        const { Readability } = require('@mozilla/readability');
        const { JSDOM } = require('jsdom');
        const dom = new JSDOM(html, { url });
        const article = new Readability(dom.window.document).parse();
        return { title: article.title, body: article.textContent, type: 'article' };
      
      case 'text':
        return { title: '用户输入', body: input, type: 'text' };
    }
  }
}
```

**新增路由**: `POST /api/content/ingest`
- 接收 `{ input: 'youtube.com/xxx' }`
- 返回 `{ content: { title, body, type } }`

#### Task 2: 翻译流水线（1 天）
**新建**: `backend/src/services/translation.js`

```javascript
class TranslationService {
  async translate(content) {
    // 1. 检测语言（中文字符占比 > 50% 则为中文）
    const lang = this._detectLanguage(content.body);
    if (lang === 'zh') return content;
    
    // 2. 翻译（调用 llm.js）
    const translatedBody = await this._translateWithLLM(content.body);
    
    // 3. 章节分段（调用 llm.js）
    const segments = await this._segmentText(translatedBody);
    
    return { ...content, body: translatedBody, segments };
  }
  
  async _translateWithLLM(text) {
    const prompt = `翻译成中文，保持专业术语不译（Agent, RAG, Embedding）：\n\n${text}`;
    return await llmService.chat([{ role: 'user', content: prompt }]);
  }
}
```

#### Task 3: 对话界面（1 天）
**前端**: `frontend/src/components/EphemeralChatDialog.jsx`
- 弹窗对话框（类 ChatGPT）
- 流式输出（复用现有 SSE 实现）

**后端**: `POST /api/chat/ephemeral`
```javascript
// 内容注入到第一条用户消息的前缀
const contextInjectedMessages = [
  { role: 'user', content: `背景内容：\n\n${content}\n\n---\n\n${messages[0].content}` },
  ...messages.slice(1)
];
await llmService.chatStream(contextInjectedMessages, res);
```

#### Task 4: 摘要 + 观点提取（0.5 天）
**新建**: `backend/src/services/content-analysis.js`

```javascript
async generateSummary(content) {
  const prompt = `生成 3-5 段摘要：\n\n${content.body}`;
  return await llmService.chat([{ role: 'user', content: prompt }]);
}

async extractPerspectives(content) {
  const prompt = `提取观点（谁在说？核心主张？论据？）：\n\n${content.body}`;
  return await llmService.chat([{ role: 'user', content: prompt }]);
}
```

### Phase 1 不做（避免过度设计）
- ❌ 数据库持久化（对话无状态，关闭即丢弃）
- ❌ Whisper 转录（先提示"该视频无字幕"）
- ❌ 多文档同时上传
- ❌ Timeline / Study Guide / FAQ（只做 Summary + Perspectives）

### 验证清单（开发前先跑通）
```bash
npm install youtube-transcript @mozilla/readability jsdom

# 测试 YouTube 字幕提取
node -e "require('youtube-transcript').YoutubeTranscript.fetchTranscript('dQw4w9WgXcQ').then(console.log)"

# 测试网页正文抓取（写测试脚本）
```

### 完成标准
✅ 用户粘贴 YouTube 链接 → 提取字幕 → 弹窗对话  
✅ 用户粘贴文章链接 → 提取正文 → 弹窗对话  
✅ 用户输入纯文本 → 直接对话  
✅ 对话中可生成摘要、提取观点  
✅ 英文内容自动翻译成中文

**预计**: 4.5 天 · **成本**: < $5/月

---

## 7. Feed 数据源扩展（2026-07-11 追加）

**背景**: AI HOT 单一数据源存在覆盖面和实时性问题。已完成多源调研。

**推荐接入的数据源（按优先级）**:

### P0（本周接入）

**1. NewsNow API** ⭐⭐⭐⭐⭐ 最重要
- **项目**: https://github.com/Busiyian/NewsNow
- **API**: https://newsnow.busiyi.world/api/v1/sources/{platformId}
- **覆盖**: 30+ 国内主流平台（知乎、B站、微博、抖音、百度、今日头条等）
- **协议**: MIT，免费
- **接入成本**: 1 天
- **参考**: `docs/ANALYSIS-TRENDRADAR.md`（深度分析 TrendRadar 如何使用 NewsNow）

```javascript
// 示例
const response = await fetch('https://newsnow.busiyi.world/api/v1/sources/zhihu');
const data = await response.json();
// { title, url, hotValue, platform }
```

**2. Hacker News API**
- **API**: https://hacker-news.firebaseapp.com/v0/topstories.json
- **覆盖**: 技术、产品、创业
- **协议**: 免费，无需认证
- **接入成本**: 半天

### P1（下周接入）

**3. RSSHub**（自建）
- **项目**: https://github.com/DIYgod/RSSHub
- **功能**: 万物皆可 RSS，覆盖 300+ 平台
- **部署**: Docker（$4/月服务器）
- **接入成本**: 1 天

**4. Dev.to + Reddit**
- 开发者博客 + 垂直社区
- 免费 API，无需认证
- 接入成本: 半天

### 内容筛选（配合数据源）

**关键词筛选语法**（借鉴 TrendRadar）:
```
+AI        # 必须包含
!广告      # 必须排除
/React|Vue/ # 正则匹配
@10        # 限制数量
```

**AI 智能筛选**:
- 用户自然语言描述兴趣（如"我关心前端框架新特性"）
- Deepseek 评分 0-100
- 过滤低相关度内容

**详细方案**: `docs/TECH-SURVEY-FEED-SOURCES.md`

---

## 8. 这份文档之外

如果新窗口的开发者需要回溯"为什么做出某个产品判断"（比如为什么否决 Insight Mining、为什么公众号不抓取），架构文档 `SYNTHESIZED-ARCHITECTURE.md` 的每一节都写了依据，不需要回看更早的对话记录。本交接文档只负责说清楚"代码库现状对应到哪"，产品判断的"为什么"以架构文档为准。
