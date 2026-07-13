# 决策：如何实现类 NotebookLM 的即兴分析能力

**日期**: 2026-07-11  
**决策者**: 产品负责人  
**状态**: ✅ 已采纳

---

## 背景

用户需求：实现类似 NotebookLM 的能力
- 丢进去任意 YouTube 链接 → 自动转写 → 解读 → 二次加工
- 丢进去文章链接 → 自动提取正文 → 对话分析
- 复制粘贴文字 → 直接对话分析

这正好对应架构文档的 **Mode 1 即兴分析**（`SYNTHESIZED-ARCHITECTURE.md` §2）。

---

## 调研结论

### NotebookLM 能否直接复用？

**❌ 不可行**

1. **无公开 API**：Google 未提供 NotebookLM 的编程接口
2. **浏览器自动化不可行**：违反服务条款，稳定性差，账号会被封
3. **开源替代品不满足需求**：
   - Anything LLM / Quivr / PrivateGPT 都不原生支持 YouTube 链接
   - 都是独立应用，无法嵌入到产品中
   - 架构过重（需要 PostgreSQL/Redis），Phase 1 用不上

---

## 决策：自建类 NotebookLM 能力

### 技术方案

**产品能力**：类似 NotebookLM（用户体验对齐）  
**技术实现**：自建，组合使用开源库 + API

```
用户输入（YouTube / 文章链接 / 纯文本）
  ↓
[内容摄入层]
  ├─ YouTube 有字幕：youtube-transcript（免费）
  ├─ YouTube 无字幕：Whisper API（$0.006/分钟，后备方案）
  ├─ 网页链接：@mozilla/readability + jsdom
  └─ 纯文本：直接使用
  ↓
[归一化]
  └─ 统一格式：{ title, body, url, type }
  ↓
[多语言处理]
  ├─ 语言检测
  ├─ 翻译（Deepseek / DeepL）
  └─ 章节分段（Deepseek）
  ↓
[对话分析]
  ├─ 弹窗对话界面（类 ChatGPT）
  ├─ 内容注入到 LLM context
  └─ 流式返回答案（复用现有 llm.js）
  ↓
[二次加工]
  ├─ 生成摘要
  ├─ 观点提取（Perspectives）
  └─ 可选保存到 Topic
```

### 技术栈（全部复用已调研方案）

| 能力 | 技术选型 | 来源 |
|------|---------|------|
| YouTube 字幕提取 | youtube-transcript (npm) | TECH-SURVEY §1 |
| YouTube 无字幕转录 | Whisper API (后备) | DECISION-FUNASR-VS-WHISPER |
| 网页正文抓取 | @mozilla/readability + jsdom | TECH-SURVEY §2 |
| 多语言翻译 | Deepseek + DeepL | TECH-SURVEY §3 |
| 对话分析 | Deepseek (已接入) | backend/src/services/llm.js |
| 流式输出 | SSE (已实现) | backend/src/services/llm.js |

---

## Phase 1 实现范围

### ✅ 必做（对齐 NotebookLM 核心能力）

1. **内容摄入**
   - YouTube 链接：自动提取字幕/转录
   - 文章链接：自动提取正文
   - 纯文本：直接使用

2. **对话分析**
   - 弹窗对话界面（选中内容或粘贴链接后触发）
   - 基于内容的多轮问答
   - 流式输出

3. **二次加工**
   - 生成摘要（Summary）
   - 观点提取（Perspectives）
   - 保存到 Topic（可选）

### ⚠️ 简化版（降低复杂度）

- **引用溯源**：Phase 1 用简单版（Prompt 要求 LLM 标注引用编号）
  - NotebookLM 是精准定位到原文片段
  - 自建方案先用 [1], [2] 标注，Phase 2 升级到 Embedding 相似度匹配

### ❌ 不做（Phase 1 范围外）

- Audio Overview（播客式音频生成）—— 成本高，优先级低
- Timeline（时间线）—— Phase 3 Topic 演进时再做
- Study Guide / FAQ —— 可选输出形式，Phase 2 补充
- 多文档同时上传 —— Phase 2 扩展

---

## 与 NotebookLM 的对比

| 能力 | NotebookLM | Phase 1 实现 | 差异 |
|------|-----------|-------------|------|
| YouTube 摄入 | ✅ | ✅ | 无差异 |
| 网页摄入 | ✅ | ✅ | 无差异 |
| 纯文本摄入 | ✅ | ✅ | 无差异 |
| 多轮对话 | ✅ | ✅ | 无差异 |
| 摘要生成 | ✅ | ✅ | 无差异 |
| 观点提取 | ✅ | ✅ | 无差异 |
| 引用溯源 | ✅ 精准 | ⚠️ 简化版 | Phase 2 升级 |
| 多种输出 | ✅ 5+ 种 | ✅ 2 种 | 够用 |
| 长上下文 | ✅ 1M tokens | ✅ 64k tokens | 够用 |
| Audio Overview | ✅ | ❌ | 不做 |
| 多文档 | ✅ | ❌ | Phase 2 |

**结论**：Phase 1 可覆盖 NotebookLM 70% 的核心能力，足够验证产品价值。

---

## 开发计划

### 实现顺序（4.5 天完成 MVP）

| 任务 | 工作量 | 优先级 |
|------|--------|--------|
| 1. 内容摄入服务（YouTube + 网页） | 1 天 | P0 |
| 2. 翻译流水线（检测 + 翻译 + 分段） | 1 天 | P0 |
| 3. 对话界面（弹窗 + 流式输出） | 1 天 | P0 |
| 4. 摘要 + 观点提取 | 0.5 天 | P0 |
| 5. 引用溯源（简化版） | 0.5 天 | P1 |
| 6. 保存到 Topic | 0.5 天 | P1 |

### 技术验证（先跑通再开发）

**本周内验证**：
```bash
# 1. YouTube 字幕提取
npm install youtube-transcript
node -e "require('youtube-transcript').YoutubeTranscript.fetchTranscript('dQw4w9WgXcQ').then(console.log)"

# 2. 网页正文抓取
npm install @mozilla/readability jsdom
# 测试提取任意文章正文

# 3. Whisper API（无字幕后备）
# 需要先下载 YouTube 音频（用 yt-dlp），再调用 Whisper
```

---

## 成本估算

### 月成本（假设每天 10 个 YouTube 视频 + 20 篇文章）

| 项目 | 用量 | 单价 | 月成本 |
|------|------|------|--------|
| YouTube 字幕提取 | 免费 | $0 | $0 |
| Whisper API（10% 无字幕） | 30 视频 × 10 分钟 | $0.006/分钟 | $1.8 |
| Deepseek 翻译 | 900 篇 × 1k tokens | $0.28/M | $0.25 |
| Deepseek 对话 | 900 次 × 10k tokens | $0.28/M | $2.52 |
| **总计** | | | **$4.57/月** |

**结论**：成本极低，低频使用几乎忽略不计。

---

## 风险与缓解

### 1. YouTube 下载受限（地区/版权）
- **风险**：部分视频无法下载音频（用于 Whisper 转录）
- **缓解**：优先使用 youtube-transcript 提取字幕，Whisper 仅作后备

### 2. 网页动态渲染无法抓取
- **风险**：纯 JS 渲染的网站（如 React SPA）readability 提取失败
- **缓解**：Phase 1 提示用户"该网站不支持"，Phase 2 引入 Puppeteer

### 3. 翻译质量不稳定
- **风险**：Deepseek 翻译的术语一致性问题
- **缓解**：Glossary 术语表注入 Prompt，分级使用 DeepL

### 4. 引用溯源不够精准
- **风险**：简化版引用可能匹配错误
- **缓解**：Phase 2 升级到 Embedding 相似度方案

---

## 与架构文档的对应关系

| 架构文档章节 | 对应实现 |
|-------------|---------|
| §2 Mode 1 即兴分析 | 本方案的产品定位 |
| §4 统一内容模型 | 内容摄入归一化 |
| §8 多语言摄入流水线 | 翻译 + 章节分段 |
| §10 Phase 1 范围 | Mode 1 + 多语言 + Source 标记 |

---

## 后续演进路径

### Phase 2（用户量增长后）
- 多文档同时上传（批量分析）
- 引用溯源升级（Embedding 相似度）
- Study Guide / FAQ 输出形式
- 动态网页支持（Puppeteer）

### Phase 3（Topic 演进）
- Timeline 输出形式
- 跨多个内容的对比分析
- Topic 自动聚类

---

## 决策依据

1. **复用优先**：所有底层技术都是现成的开源库/API（TECH-SURVEY-PHASE1.md）
2. **快速验证**：4.5 天完成 MVP，避免过度设计
3. **成本可控**：月成本 < $5，比自建 FunASR 更划算（DECISION-FUNASR-VS-WHISPER.md）
4. **架构对齐**：完全符合 Mode 1 即兴分析的产品定义（SYNTHESIZED-ARCHITECTURE.md §2）

---

## 参考文档

- 架构基线：`docs/SYNTHESIZED-ARCHITECTURE.md`
- 技术选型：`docs/TECH-SURVEY-PHASE1.md`
- YouTube 转录方案：`docs/DECISION-FUNASR-VS-WHISPER.md`
- 现有 LLM 集成：`backend/src/services/llm.js`
