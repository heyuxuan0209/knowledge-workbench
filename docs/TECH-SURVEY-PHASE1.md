# Phase 1 技术选型调研报告

**日期**: 2026-07-11  
**调研范围**: 10 个核心能力的开源/现成复用方案  
**原则**: Reuse First · Open Source First · Best Practice First

---

## 1. YouTube 内容摄入（字幕/Transcript 提取）

### 推荐方案
- **youtube-transcript** (npm)
  - MIT 许可证，维护活跃（2024+ 持续更新）
  - 每周 40k+ 下载量
  - 支持多语言字幕，自动回退到可用语言
  
### 集成方式
```javascript
const { YoutubeTranscript } = require('youtube-transcript');
const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh' });
```

### 无字幕的后备方案
- **Whisper API** (OpenAI)
  - 收费：$0.006/分钟（10 分钟视频 = $0.06）
  - 支持 99 种语言，准确率高
- **faster-whisper** (开源自建)
  - 基于 CTranslate2 优化，速度提升 4 倍
  - 需要 GPU 服务器（成本 > API），仅大量使用时考虑

### 已知局限
- 部分视频禁用字幕下载（平台限制），无字幕时必须走 Whisper
- YouTube API 配额限制（每日 10,000 单位），字幕提取不消耗配额

### 优先级
**P0** — Phase 1 多语言摄入流水线的第一步，立即验证

---

## 2. 网页正文抓取

### 推荐方案
- **@mozilla/readability** (npm)
  - Apache-2.0 许可证
  - Firefox Reader View 同款算法
  - 每周 250k+ 下载量
  
### 集成方式
```javascript
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const dom = new JSDOM(html, { url });
const article = new Readability(dom.window.document).parse();
// article.textContent, article.title, article.excerpt
```

### 中文支持
- Readability 对中文支持良好（基于 HTML 语义，非语言相关）
- 需配合 JSDOM 模拟浏览器环境

### Jina Reader 替代方案
- Jina Reader (r.jina.ai) 是云服务，无自建版本
- 自建等价方案：`@mozilla/readability` + `jsdom` + 反反爬（见第 6 项）

### 已知局限
- 依赖 HTML 结构，设计不标准的网站（如纯 JS 渲染无语义标签）提取质量差
- 需要预先获取完整 HTML（动态渲染网站需 Puppeteer/Playwright）

### 优先级
**P0** — Mode 1 即兴分析"粘贴任意链接"的核心能力

---

## 3. 多语言翻译

### 推荐方案（分级策略）
**重要内容（标题/摘要/用户选中精读）**:
- **Deepseek** (已接入)
  - $0.14/M input tokens，$0.28/M output tokens
  - 中文能力优秀，术语可控（Glossary 注入 Prompt）
  
**批量内容（全文翻译，降成本）**:
- **DeepL API Free** 
  - 50 万字符/月免费，超出 €25/100 万字符
  - 技术内容翻译质量业界最佳
  - 术语表支持（Glossary 功能，Pro 版）
  
### 术语一致性方案
```javascript
const glossary = {
  'Agent': 'Agent',  // 不译
  'RAG': 'RAG',
  'Embedding': '嵌入'
};
// Deepseek: 在 system prompt 注入术语表
// DeepL: 使用 Glossary API (需 Pro)
```

### DeepL 替代方案
- **Google Translate API** (Cloud Translation)
  - $20/M 字符，比 DeepL 贵
  - 术语一致性差于 DeepL
  - 不推荐，除非 DeepL 配额耗尽
  
### 已知局限
- DeepL Free 有月配额限制（50 万字符 ≈ 500 篇文章摘要）
- Deepseek 翻译长文成本可控但需拆分（context window 限制）

### 优先级
**P0** — 架构文档明确"多语言摄入是 Phase 1 一等公民"

---

## 4. 飞书文档同步

### 推荐方案
- **@larksuiteoapi/node-sdk** (官方 SDK)
  - MIT 许可证
  - 支持文档读取、OAuth 2.0、Webhook
  
### 集成方式
```javascript
const lark = require('@larksuiteoapi/node-sdk');
const client = new lark.Client({
  appId: process.env.LARK_APP_ID,
  appSecret: process.env.LARK_APP_SECRET
});
const doc = await client.docx.document.get({ document_id });
```

### OAuth 流程复杂度
- 需要飞书开放平台创建企业自建应用
- OAuth 2.0 标准流程（3 步：授权 → 换 token → 刷新 token）
- SDK 已封装，复杂度可控

### 已知局限
- 飞书文档格式复杂（块级结构），需要递归解析
- API 配额：企业版 10,000 次/分钟，个人版 100 次/分钟
- 需要用户授权每个文档（权限模型较重）

### 优先级
**P2** — 非核心摄入渠道，数据源优先级低于 AI HOT / YouTube

---

## 5. Obsidian 内容同步

### 推荐方案
**Frontmatter 解析**:
- **gray-matter** (npm)
  - MIT 许可证，每周 7M+ 下载量
  - 支持 YAML/TOML/JSON frontmatter
  
**双链解析**:
- **remark / unified** 生态
  - `remark-wiki-link` 插件支持 `[[]]` 语法
  - 可自定义解析规则
  
### 集成方式
```javascript
const matter = require('gray-matter');
const { unified } = require('unified');
const markdown = require('remark-parse');
const wikiLink = require('remark-wiki-link');

const file = matter(fs.readFileSync('note.md'));
const tree = unified()
  .use(markdown)
  .use(wikiLink)
  .parse(file.content);
```

### 已知局限
- Obsidian 双链格式有多种变体（`[[link]]`, `[[link|alias]]`, `[[folder/link]]`）
- 需要手动实现链接解析和图谱构建
- Obsidian 插件生态用的是 JavaScript，但不是标准 npm 包

### 优先级
**P2** — 数据源优先级低，Obsidian vault 同步是高级用户场景

---

## 6. 反爬平台的内容获取（小红书/微信公众号/抖音）

### 架构约束
**产品决策**（硬约束，见 SYNTHESIZED-ARCHITECTURE.md §3.4）：
- 微信公众号：**不做主动抓取**，只被动等 AI HOT 推送 + 跳转原文
- 小红书/抖音：同样不做自动抓取

### 用户手动粘贴内容的结构化提取
- **图文提取**：用户截图/复制粘贴 → OCR 提取文本
  - Tesseract.js (开源 OCR，浏览器/Node.js)
  - 或 LLM Vision API 直接理解图片内容
  
- **文本结构化**：
  - 用 Deepseek Function Calling 提取标题/正文/作者/发布时间
  
### 已知局限
- OCR 准确率依赖图片质量（手机截图通常足够）
- 无法自动更新（用户需手动粘贴）

### 优先级
**P3** — 非自动化摄入，优先级最低

---

## 7. 实体/身份归一（去重）

### 推荐方案
**轻量级方案**（Phase 1 够用）:
- **string-similarity** (npm)
  - MIT 许可证，基于 Dice Coefficient
  - 每周 600k+ 下载量
  
```javascript
const stringSimilarity = require('string-similarity');
const score = stringSimilarity.compareTwoStrings('Andrej Karpathy', 'andrej karpathy');
// score > 0.8 视为同一人
```

**重量级方案**（Phase 3 再考虑）:
- **dedupe** (Python)
  - 机器学习去重，准确率高但需训练
  - 跨语言调用成本高，不适合 Node.js 项目
  
### 集成方式
- Source 创建时，遍历已有 Source，计算 displayName 相似度
- 相似度 > 阈值 → 提示用户"是否为同一人"
- 不做全自动（避免误合并）

### 已知局限
- 简单字符串相似度无法处理昵称（如"Karpathy"="A.K."）
- 跨平台账号需要额外规则（如检测个人主页链接一致性）

### 优先级
**P1** — Source 标记是 Phase 1 一部分，但去重可以后补

---

## 8. Topic 聚类与演进

### 推荐方案
**Embedding 生成**:
- **OpenAI text-embedding-3-small**
  - $0.02/M tokens，768 维
  - 或 Deepseek Embedding（更便宜，但需验证质量）
  
**聚类算法**:
- **ml-kmeans** (npm)
  - MIT 许可证，纯 JS 实现
  - 适合小规模聚类（< 10k 文档）
  
**向量相似度**:
- **vector-similarity** (npm) 或手写 cosine similarity（10 行代码）

### 演进呈现（时间线）
- 无现成库，需自行设计
- 参考 Google Trends 的分阶段热度图
- 数据结构：`{ phase, dateRange, keyContents[], summary }`

### 已知局限
- K-means 需要预设 k 值（主题数量），可用 elbow method 动态决定
- Embedding + 聚类的成本随内容增长线性增长
- 向量数据库（Pinecone/Chroma）Phase 1 不需要（SQLite + JSON 列存 embedding 足够）

### 优先级
**P3** — Phase 3 才做 Topic 演进，Phase 1 只需简单的内容标签

---

## 9. 富文本/Markdown 草稿编辑器

### 推荐方案
**Lexical** (Meta 开源):
- MIT 许可证
- React 官方推荐的下一代编辑器
- 插件化架构，支持扩展（AI 扩写、脚注引用）
- 每周 500k+ npm 下载量
  
**TipTap** (Basecamp 开源):
- MIT 许可证
- 基于 ProseMirror，React 支持良好
- 扩展丰富（mention, slash commands）
- 每周 300k+ npm 下载量

### 对比选择
| 维度 | Lexical | TipTap |
|------|---------|--------|
| 性能 | 更快（虚拟 DOM） | 快 |
| 扩展性 | 插件化，灵活 | 预制扩展多 |
| 学习曲线 | 陡峭 | 平缓 |
| AI 集成 | 需自己写插件 | 需自己写插件 |

**推荐 TipTap**：预制扩展多，快速上手，React 集成成熟。

### AI 扩写集成
```javascript
// TipTap 自定义扩展
editor.commands.insertContent(aiGeneratedText);
editor.commands.setMark('citation', { sourceId: 'xxx' });
```

### 已知局限
- 脚注引用标注需要自定义扩展（无现成插件）
- AI 扩写的"回溯引用来源"需要自己设计数据结构

### 优先级
**P4** — Phase 4 创作桥接才需要，Phase 1 不涉及

---

## 10. PDF 解析（论文类内容摄入）

### 推荐方案
**pdf-parse** (npm):
- MIT 许可证
- 每周 400k+ 下载量
- API 简单，适合提取纯文本
  
```javascript
const pdfParse = require('pdf-parse');
const data = await pdfParse(buffer);
// data.text, data.numpages, data.info
```

**pdfjs-dist** (Mozilla):
- Apache-2.0 许可证
- 每周 1.5M+ 下载量
- 功能强大，可提取文本位置/图表/元数据
- API 复杂，适合需要精细控制的场景

### 引用/图表保留
- pdf-parse：只提取纯文本，引用格式丢失
- pdfjs-dist：可提取文本坐标，需手动解析引用格式
- **LLM 后处理**：提取后用 Deepseek 重新分段 + 识别引用（参考架构文档 §8 的章节分段模式）

### 已知局限
- PDF 格式复杂（扫描版、双栏、图表嵌入），无法保证 100% 准确
- 学术论文的引用格式多样（APA/MLA/Chicago），需 LLM 归一化

### 优先级
**P2** — 论文摄入是核心场景，但优先级低于 YouTube/网页

---

## 总体优先级建议

### 立即验证（本周内）
1. **YouTube Transcript 提取**（youtube-transcript + Whisper API 后备）
2. **网页正文抓取**（@mozilla/readability）
3. **翻译流水线**（Deepseek + DeepL 分级）

### 下周实现
4. **Obsidian/Markdown 解析**（gray-matter + remark-wiki-link）
5. **身份去重**（string-similarity 轻量方案）

### 后续 Phase
6. **PDF 解析**（pdf-parse，Phase 2）
7. **飞书同步**（@larksuiteoapi/node-sdk，Phase 2）
8. **Topic 聚类**（Embedding + ml-kmeans，Phase 3）
9. **编辑器**（TipTap，Phase 4）
10. **反爬内容**（手动粘贴 + LLM 提取，Phase 3）

---

## 技术验证脚本（建议先跑通这三个）

### 验证 1: YouTube Transcript
```bash
npm install youtube-transcript
node -e "require('youtube-transcript').YoutubeTranscript.fetchTranscript('dQw4w9WgXcQ').then(console.log)"
```

### 验证 2: Readability
```bash
npm install @mozilla/readability jsdom
# 测试提取 Hacker News 文章正文
```

### 验证 3: DeepL API
```bash
curl -X POST 'https://api-free.deepl.com/v2/translate' \
  -d 'auth_key=YOUR_KEY' \
  -d 'text=Hello World' \
  -d 'target_lang=ZH'
```

---

## 成本估算（Phase 1 月运行成本）

假设用户每天处理 50 篇内容：

| 服务 | 用量 | 单价 | 月成本 |
|------|------|------|--------|
| YouTube 字幕 | 免费 API | $0 | $0 |
| Whisper API（10 个无字幕视频） | 100 分钟/月 | $0.006/分钟 | $0.6 |
| Deepseek 翻译（标题/摘要） | 50 篇 × 30 天 × 500 tokens | $0.28/M | $2.1 |
| DeepL Free | 50 万字符/月 | 免费 | $0 |
| Embedding（聚类预留） | 1M tokens | $0.02/M | $0.02 |
| **总计** | | | **$2.72/月** |

Phase 1 成本极低，瓶颈在开发时间，不在 API 费用。

---

## 需要避免的坑

### 1. youtube-transcript 的地区限制
- 部分视频在中国大陆无法访问字幕 API（GFW）
- 解决：代理或直接用 Whisper（成本增加）

### 2. Readability 对动态渲染网站无效
- 需要 Puppeteer 预渲染（增加复杂度和成本）
- 建议 Phase 1 只支持静态 HTML 网站

### 3. DeepL Free 配额耗尽后回退策略
- 监控月配额使用量
- 超限后自动切换到 Deepseek 翻译（质量略降但成本可控）

### 4. node:sqlite 不支持并发写入
- 摄入流水线需要队列化（job queue）
- 推荐 **bull** (Redis-based) 或 **better-queue** (内存队列)

---

## 最终建议

**Phase 1 核心技术栈**（复用优先）：
- YouTube: `youtube-transcript` + Whisper API 后备
- 网页: `@mozilla/readability` + `jsdom`
- 翻译: Deepseek（重要内容）+ DeepL Free（批量）
- Markdown: `gray-matter` + `remark-wiki-link`
- 去重: `string-similarity`

**不要自己造轮子**：
- ❌ 不要写 PDF 解析器（用 pdf-parse）
- ❌ 不要写字符串相似度算法（用 string-similarity）
- ❌ 不要写 Markdown parser（用 remark 生态）

**优先验证闭环**：
- 先跑通"YouTube 视频 → 字幕 → 翻译 → 存入 Content 表"完整流程
- 再扩展其他数据源
