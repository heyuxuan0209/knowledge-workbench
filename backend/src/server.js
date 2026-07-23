import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

dotenv.config();

// 出网代理根治（2026-07-17）：Node fetch（undici）默认忽略 HTTP(S)_PROXY，且 launchd
// 常驻进程没有 shell 环境——代理只能来自 .env。不配则行为不变（直连）。
// 覆盖进程内所有 fetch：信源识别/feed 探测/RSS 轮询/正文抓取。NO_PROXY 保证本机调用不绕行
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.log(`🌐 出网代理已启用：${process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy}`);
}

const app = express();
const PORT = process.env.PORT || 3000;

// 文件上传（即时分析支持音频/PDF，UI 改造）：存临时目录，处理完由 upload-ingest 删除。上限 300MB（会议音频）
import multer from 'multer';
import { tmpdir } from 'os';
import { join as pathJoin } from 'path';
const upload = multer({ dest: pathJoin(tmpdir(), 'kw-uploads'), limits: { fileSize: 300 * 1024 * 1024 } });

app.use(cors());
// 5mb：adHoc 对话材料含长视频译文（默认 100kb 会对长内容直接 PayloadTooLarge）
app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== v3 Contents API（新架构，Feed 主页读取的是这里，不是下面的旧 /api/items） ==========

app.get('/api/contents', async (req, res) => {
  try {
    const { getContents } = await import('./db/contents.js');
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    // q：多关键词搜索；starred=1：只看星标（2026-07-16 反馈 #2：内容被新条目推下去后找不回）
    const contents = getContents(limit, offset, {
      q: req.query.q || null,
      starred: req.query.starred === '1',
      followed: req.query.followed === '1',
      category: req.query.category || null,
    });

    res.json({
      success: true,
      data: contents,
      count: contents.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 内容分类计数（资讯页 chips，UI 改造 2b）。repo=1 统计 AI 项目，否则文章
app.get('/api/contents/categories', async (req, res) => {
  try {
    const { categoryCounts } = await import('./services/content-classify.js');
    res.json({ success: true, data: categoryCounts({ repo: req.query.repo === '1' }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 触发补分类（存量回填 / 手动；force=1 全量重分类）
app.post('/api/contents/classify', async (req, res) => {
  try {
    const { classifyUnclassified } = await import('./services/content-classify.js');
    const data = await classifyUnclassified({ force: req.query.force === '1' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 星标切换（轻量收藏：一键钉住，无需归属；升级为素材卡才需要主题）
app.post('/api/contents/:id/star', async (req, res) => {
  try {
    const { toggleStar } = await import('./db/contents.js');
    const starred = toggleStar(req.params.id);
    if (starred === null) return res.status(404).json({ success: false, error: 'Content not found' });
    res.json({ success: true, data: { id: req.params.id, starred } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 即时分析模板（HANDOFF-2026-07-15）：prompt 以文件形式维护在 reference/prompts/，
// 改文件即改产品行为，前端 startAnalysis 拉取后作为分析指令。
// <运行时注入：X> 占位符在此解析（当前背景为静态文本，未来可接用户配置）。
app.get('/api/prompts/instant-analysis', async (req, res) => {
  try {
    const { loadInstantAnalysisPrompt } = await import('./services/interpretation.js');
    res.json({ success: true, data: { prompt: loadInstantAnalysisPrompt() } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 结构化精读稿（2026-07-16：读全文 = 精读稿，与即时分析同模板同形式）。
// 首次：全文获取（含翻译/字幕/ASR）+ 一次 Deepseek 生成，之后缓存秒开；
// ?force=1 重新生成；?full=1「转写全程」——绕过缓存、ASR 转全程后重生成（视频没读全时用）
app.get('/api/contents/:id/interpretation', async (req, res) => {
  try {
    const full = req.query.full === '1';
    const { getOrGenerateInterpretation } = await import('./services/interpretation.js');
    const result = await getOrGenerateInterpretation(req.params.id, { force: req.query.force === '1' || full, full });
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error.message === 'Content not found' ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// Mode 1 即兴分析：接收用户粘贴的链接/文本，归一化提取内容，并在摄入成功时自动翻译成中文
// （一步到位，前端不需要再单独调翻译接口）。摄入失败（如无字幕/抓取失败）时跳过翻译，
// 直接把摄入失败的原因透传给前端。对话（#8）是下一步，这里只负责「摄入 + 翻译」。
app.post('/api/content/ingest', async (req, res) => {
  try {
    const { input } = req.body;

    if (!input) {
      return res.status(400).json({
        success: false,
        error: 'input is required'
      });
    }

    const { ingest } = await import('./services/content-ingestion.js');
    const ingested = await ingest(input);

    if (ingested.fetchStatus !== 'success') {
      return res.json({
        success: false,
        data: ingested
      });
    }

    // 长视频/长文保护：全文翻译按 20k 字符截断（2 小时视频字幕 10 万+字符，
    // 全翻要数分钟且费用高；前段已足够支撑解读，后续 M5 做分段/按需翻译）
    let truncated = false;
    if (ingested.body && ingested.body.length > 20000) {
      ingested.body = ingested.body.slice(0, 20000) + '\n…（内容过长，已截取前段解读）';
      if (Array.isArray(ingested.transcript)) {
        let acc = 0;
        ingested.transcript = ingested.transcript.filter(seg => (acc += (seg.text || '').length) <= 20000);
      }
      truncated = true;
    }

    const { translateContent } = await import('./services/translation.js');
    const translation = await translateContent(ingested);

    res.json({
      success: true,
      data: { ...ingested, ...translation, truncated }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 上传文件即时分析（UI 改造）：音频→本地转写全程 / PDF→抽文字。异步：返回 jobId，前端轮询。
app.post('/api/content/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '没收到文件' });
    const { startUploadJob } = await import('./services/upload-ingest.js');
    const { id, kind } = startUploadJob({ path: req.file.path, originalname: req.file.originalname, mimetype: req.file.mimetype });
    res.json({ success: true, data: { jobId: id, kind, filename: req.file.originalname } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 轮询上传处理进度/结果（result 与 /api/content/ingest 的 data 同 shape）
app.get('/api/content/upload/:jobId', async (req, res) => {
  try {
    const { getJob } = await import('./services/upload-ingest.js');
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: '任务不存在或已过期' });
    res.json({ success: true, data: job });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mode 1 即兴分析对话（SSE 流式）。无状态设计：不落库，前端每次请求带上完整 messages
// 历史；材料来自 contentIds（已入库的 Feed 内容）和/或 adHocContents（用户临时粘贴、
// 已经过 /api/content/ingest 摄入+翻译的结果，未入库）。两者可同时存在。
app.post('/api/chat/ephemeral', async (req, res) => {
  try {
    const { contentIds = [], adHocContents = [], topicId = null, messages, librarySearch = false, noteIds = [], knowledgeBase = false } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'messages is required and must be a non-empty array'
      });
    }
    // topicId：主题页探讨；librarySearch：问素材库首轮（语义检索出材料）；knowledgeBase：问知识体系（喂全部主题综述）；
    // noteIds：显式素材（多轮追问复用首轮检索到的材料，不重新检索——否则"第2条展开"会拿追问去搜错东西）
    if (contentIds.length === 0 && adHocContents.length === 0 && !topicId && !librarySearch && noteIds.length === 0 && !knowledgeBase) {
      return res.status(400).json({
        success: false,
        error: 'at least one of contentIds, adHocContents, topicId, librarySearch, noteIds or knowledgeBase is required'
      });
    }

    // librarySearch 模式：用最新一条用户消息做语义检索，取 top-k 素材作为材料注入；
    // 否则用显式传入的 noteIds（多轮复用）
    let retrievedNotes = [];
    let finalNoteIds = noteIds;
    if (librarySearch) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser?.content?.trim()) {
        const { searchNotes } = await import('./services/semantic-search.js');
        retrievedNotes = await searchNotes(lastUser.content, { limit: 8 });
        finalNoteIds = retrievedNotes.map(n => n.id);
      }
    }

    const { buildMessagesWithContext } = await import('./services/ephemeral-chat.js');
    const { messages: contextInjectedMessages, degraded, topicNames } = await buildMessagesWithContext(contentIds, adHocContents, messages, topicId, finalNoteIds, knowledgeBase);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 开流前先发降级清单；librarySearch 发命中素材；knowledgeBase 发纳入的主题名（前端显示"基于这 N 个主题"）
    const retrieved = librarySearch
      ? retrievedNotes.map(n => ({ id: n.id, title: n.title, source_title: n.source_title, score: n.score }))
      : (knowledgeBase ? (topicNames || []).map(name => ({ title: name })) : []);
    res.write(`data: ${JSON.stringify({ type: 'meta', degraded, retrieved, kind: knowledgeBase ? 'knowledge' : (librarySearch || noteIds.length ? 'library' : null) })}\n\n`);

    const { streamChat } = await import('./services/llm.js');

    for await (const chunk of streamChat(contextInjectedMessages, 'deepseek')) {
      if (chunk.type === 'content') {
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
      } else if (chunk.type === 'done') {
        res.write(`data: ${JSON.stringify({ type: 'done', tokens: chunk.tokens, cost: chunk.cost })}\n\n`);
      } else if (chunk.type === 'error') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
      }
    }

    res.end();
  } catch (error) {
    console.error('[Ephemeral Chat] Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// 站内全文阅读（2026-07-16 用户反馈：非 AI HOT 的 Feed 内容要能读全文，英文出译文）。
// 复用 resolveContentBody 全套策略：抓原文（readability→Jina 兜底）/视频字幕→ASR、
// 英文自动翻译、结果缓存 zh_body（首次约半分钟，视频分钟级；之后秒开）。
app.get('/api/contents/:id/fulltext', async (req, res) => {
  try {
    const { getContentById } = await import('./db/contents.js');
    const content = getContentById(req.params.id);
    if (!content) return res.status(404).json({ success: false, error: 'Content not found' });

    const { resolveContentBody } = await import('./services/content-body-resolver.js');
    const result = await resolveContentBody(content);
    res.json({
      success: true,
      data: {
        title: content.zh_title || content.en_title,
        enTitle: content.en_title,
        body: result.body,
        isFullText: result.isFullText,
        note: result.note,
        url: content.url,
        contentType: content.content_type,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 单篇内容的摘要生成（基于原文，见 content-body-resolver.js 的抓取/降级策略）。
// 非流式：摘要生成一次性返回即可，不需要 SSE。
app.post('/api/content/:id/summary', async (req, res) => {
  try {
    const { getContentById } = await import('./db/contents.js');
    const content = getContentById(req.params.id);

    if (!content) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const { generateSummary } = await import('./services/content-analysis.js');
    const result = await generateSummary(content);

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 单篇内容的观点提取（stance + points，架构文档 §4 ai.perspectives 的数据来源）。
app.post('/api/content/:id/perspectives', async (req, res) => {
  try {
    const { getContentById } = await import('./db/contents.js');
    const content = getContentById(req.params.id);

    if (!content) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const { extractPerspectives } = await import('./services/content-analysis.js');
    const result = await extractPerspectives(content);

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/contents/:id', async (req, res) => {
  try {
    const { getContentById } = await import('./db/contents.js');
    const content = getContentById(req.params.id);

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Content not found'
      });
    }

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GitHub 热门 AI 项目区块（与资讯流分离：一个是产品，一个是内容）
app.get('/api/github-trending', async (req, res) => {
  try {
    const { getDatabase } = await import('./db/init.js');
    const db = getDatabase();
    const repos = db.prepare(`
      SELECT id, zh_title, zh_summary, en_title, url, external_score, tags, published_at, category, starred
      FROM contents WHERE source_app = 'github_trending'
      ORDER BY external_score DESC LIMIT 10
    `).all();
    const metaRow = db.prepare("SELECT value FROM app_meta WHERE key = 'github_trend'").get();
    db.close();
    res.json({ success: true, data: { repos, trend: metaRow ? JSON.parse(metaRow.value) : null } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== M2 洞察层：Story 聚类（近期焦点，ADR-008） ==========

app.get('/api/stories', async (req, res) => {
  try {
    const { getStories } = await import('./services/story-clustering.js');
    res.json({ success: true, data: getStories(parseInt(req.query.limit) || 10) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 重建聚类（纯本地计算，不调 LLM，可随手动/定时同步后触发）
app.post('/api/stories/rebuild', async (req, res) => {
  try {
    const { rebuildStories } = await import('./services/story-clustering.js');
    const result = await rebuildStories(parseInt(req.body?.days) || 7);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== M2 轻量创作出口：单篇 → X thread（ADR-011） ==========

// 基于原文生成 thread（钩子+分条+结尾），直接返回不落库（Draft 是 M4）。调用 Deepseek。
app.post('/api/contents/:id/thread', async (req, res) => {
  try {
    const { generateThread } = await import('./services/thread-generation.js');
    const result = await generateThread(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error.message === 'Content not found' ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// ========== M4 创作层：Draft 稿件 + 活页起稿 + 去AI味 ==========

// 从活页一键起稿（活页综述做骨架 + 已并入素材可溯源引用），生成即落库
app.post('/api/topics/:id/draft', async (req, res) => {
  try {
    const { generateFromTopic } = await import('./services/draft-generation.js');
    const draft = await generateFromTopic(req.params.id, req.body?.platform || 'long', req.body?.viewpoint || null);
    res.json({ success: true, data: draft });
  } catch (error) {
    const status = error.message === 'Topic not found' ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// 可插入素材相关性排序（2026-07-16 用户实测：右侧素材按时间倒序，与当前草稿无关）。
// 用主题匹配同款 TF 余弦（本地零成本）按草稿正文排序；draft 为空则退化为本主题优先+时间序。
app.post('/api/studio/rank-materials', async (req, res) => {
  try {
    const { draft = '', topicId = null } = req.body;
    const { rankMaterials } = await import('./services/material-ranking.js');
    res.json({ success: true, data: rankMaterials(draft, topicId) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 平台模板列表（P1 文件化：platforms/ 目录扫描，加文件=加平台，前端动态渲染）
app.get('/api/studio/platforms', async (req, res) => {
  try {
    const { listPlatforms } = await import('./services/creation-prompts.js');
    res.json({ success: true, data: listPlatforms().map(({ key, label, icon, note, when }) => ({ key, label, icon, note, when })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── ADR-026 并行新路径（试新版：文体 × 平台形态）。三条 v2 接口，与老接口完全并存 ──
app.get('/api/studio/genres', async (req, res) => {
  try {
    const { listGenres } = await import('./services/creation-prompts.js');
    res.json({ success: true, data: listGenres().map(({ key, label, icon, note, when }) => ({ key, label, icon, note, when })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/studio/platform-forms', async (req, res) => {
  try {
    const { listPlatformForms } = await import('./services/creation-prompts.js');
    res.json({ success: true, data: listPlatformForms().map(({ key, label, icon, note, when }) => ({ key, label, icon, note, when })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 某主题的已并入素材列表（供创作台勾选用）
app.get('/api/topics/:id/materials', async (req, res) => {
  try {
    const { listTopicMaterials } = await import('./services/draft-generation.js');
    res.json({ success: true, data: listTopicMaterials(req.params.id) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// v2 起稿：文体(genre) × 平台形态(platform-form) 拼装（老 /api/topics/:id/draft 不变）
// selectedNoteIds 非空 → 只用勾选的素材（ADR-028 阶段1）
app.post('/api/topics/:id/draft-v2', async (req, res) => {
  try {
    const { genre, platformForm, viewpoint, selectedNoteIds } = req.body || {};
    if (!genre || !platformForm) return res.status(400).json({ success: false, error: 'genre 和 platformForm 必填' });
    const ids = Array.isArray(selectedNoteIds) && selectedNoteIds.length ? selectedNoteIds : null;
    const { generateFromTopicV2 } = await import('./services/draft-generation.js');
    const draft = await generateFromTopicV2(req.params.id, genre, platformForm, viewpoint || null, ids);
    res.json({ success: true, data: draft });
  } catch (error) {
    const status = error.message === 'Topic not found' ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// 全库素材列表（ADR-028 阶段1·B：创作台可不进主题，从整库挑；?q= 搜索）
app.get('/api/materials', async (req, res) => {
  try {
    const { getNotes } = await import('./db/notes.js');
    const rows = getNotes({ limit: 200, q: req.query.q || null });
    res.json({ success: true, data: rows.map(n => ({ id: n.id, excerpt: (n.excerpt || '').slice(0, 90), sourceTitle: n.title || n.content_zh_title || n.source_title || '未命名素材', sourceUrl: n.source_url || n.content_url || null })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 启发式推荐：看选中素材荐一个文体（平台默认公众号长文，用户可改）
app.post('/api/materials/recommend', async (req, res) => {
  try {
    const { selectedNoteIds } = req.body || {};
    const { recommendForMaterials } = await import('./services/draft-generation.js');
    res.json({ success: true, data: recommendForMaterials(Array.isArray(selectedNoteIds) ? selectedNoteIds : []) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 按选中素材生成（无需主题）
app.post('/api/materials/draft-v2', async (req, res) => {
  try {
    const { genre, platformForm, viewpoint, selectedNoteIds } = req.body || {};
    if (!genre || !platformForm) return res.status(400).json({ success: false, error: 'genre 和 platformForm 必填' });
    if (!Array.isArray(selectedNoteIds) || !selectedNoteIds.length) return res.status(400).json({ success: false, error: '至少选 1 条素材' });
    const { generateFromMaterials } = await import('./services/draft-generation.js');
    const draft = await generateFromMaterials(selectedNoteIds, genre, platformForm, viewpoint || null);
    res.json({ success: true, data: draft });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ADR-035 带稿重塑：把用户自己写的草稿按 文体×平台形态 重塑（无需素材）。
// 用于"从灵感带稿去创作"——带过来的是你的原文，选好文体/平台点「用这个生成/重新生成」即走这里。
app.post('/api/studio/reshape', async (req, res) => {
  try {
    const { draft, genre, platformForm, viewpoint } = req.body || {};
    if (!genre || !platformForm) return res.status(400).json({ success: false, error: 'genre 和 platformForm 必填' });
    if (!draft?.trim()) return res.status(400).json({ success: false, error: '草稿为空——先在编辑器里写/带一段内容' });
    const { generateFromDraft } = await import('./services/draft-generation.js');
    const result = await generateFromDraft(draft, genre, platformForm, viewpoint || null);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 长文标题候选（标题决定打开率，按平台分组生成、每个带【平台·策略】标注供挑选；prompt 见 creation/titles.md）
app.post('/api/studio/titles', async (req, res) => {
  try {
    const { draft } = req.body;
    if (!draft?.trim()) return res.status(400).json({ success: false, error: 'draft is required' });
    const { chat } = await import('./services/llm.js');
    const { loadPrompt, render } = await import('./services/creation-prompts.js');
    const result = await chat([{
      role: 'user',
      content: render(loadPrompt('titles.md'), { draft: draft.slice(0, 3000) }),
    }]);
    if (!result.success) throw new Error(result.error);
    const titles = result.content.trim().split('\n').map(s => s.trim().replace(/^\d+[.、)]\s*/, '')).filter(Boolean).slice(0, 10);
    res.json({ success: true, data: titles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 去 AI 味审校（三遍法一道工序）：返回改写稿，由前端决定是否替换，不自动落库
app.post('/api/studio/humanize', async (req, res) => {
  try {
    const { draft, platform } = req.body;
    if (!draft?.trim()) return res.status(400).json({ success: false, error: 'draft is required' });
    const { humanize } = await import('./services/draft-generation.js');
    const result = await humanize(draft, platform || 'long');
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/drafts', async (req, res) => {
  try {
    const { listDrafts } = await import('./db/drafts.js');
    res.json({ success: true, data: listDrafts({ platform: req.query.platform || null }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/drafts', async (req, res) => {
  try {
    const { platform, title, body, paragraphRefs, sourceKind, sourceId, sourceLabel } = req.body;
    if (!platform || !body?.trim()) {
      return res.status(400).json({ success: false, error: 'platform and body are required' });
    }
    const { createDraft } = await import('./db/drafts.js');
    res.json({ success: true, data: createDraft({ platform, title, body, paragraphRefs, sourceKind, sourceId, sourceLabel }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch('/api/drafts/:id', async (req, res) => {
  try {
    const { updateDraft } = await import('./db/drafts.js');
    const draft = updateDraft(req.params.id, req.body || {});
    if (!draft) return res.status(404).json({ success: false, error: 'Draft not found' });
    res.json({ success: true, data: draft });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/drafts/:id', async (req, res) => {
  try {
    const { deleteDraft } = await import('./db/drafts.js');
    const done = deleteDraft(req.params.id);
    res.json({ success: done, message: done ? 'Draft deleted' : 'Draft not found' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 创作助手指令改写：把左侧草稿 + 用户指令交给 Deepseek，返回改写后的整稿。
// 前端直接替换草稿区内容（保存与否由用户在创作台决定）。
app.post('/api/studio/rewrite', async (req, res) => {
  try {
    const { draft, instruction, platform = 'thread' } = req.body;
    if (!draft?.trim() || !instruction?.trim()) {
      return res.status(400).json({ success: false, error: 'draft and instruction are required' });
    }
    const { chat } = await import('./services/llm.js');
    const { loadPrompt, render, getPlatform } = await import('./services/creation-prompts.js');
    let platformNote = '';
    try { platformNote = getPlatform(platform).note; } catch { /* 平台未知不阻塞改写 */ }
    const result = await chat([{
      role: 'user',
      content: render(loadPrompt('rewrite.md'), { platformNote, instruction, draft: draft.slice(0, 8000) }),
    }]);
    if (!result.success) throw new Error(result.error);
    res.json({ success: true, data: { draft: result.content.trim(), note: `已按「${instruction}」改写草稿（¥${result.cost?.toFixed(4)}）`, cost: result.cost } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 平台裂变（2026-07-16 用户实测反馈：粘贴的文章点平台按钮"没反应"）：把当前稿
// 改写为目标平台规格版——V3 §三.5 浅线「定稿后裂变为各平台版」的第一块。
// 与 rewrite 的区别：rewrite 按用户指令改，adapt 按目标平台规格文件（platforms/*.md）改
app.post('/api/studio/adapt', async (req, res) => {
  try {
    const { draft, platform } = req.body;
    if (!draft?.trim() || !platform) {
      return res.status(400).json({ success: false, error: 'draft and platform are required' });
    }
    const { chat } = await import('./services/llm.js');
    const { loadPrompt, render, getPlatform } = await import('./services/creation-prompts.js');
    const target = getPlatform(platform); // 未知平台在此抛错
    const result = await chat([{
      role: 'user',
      content: render(loadPrompt('adapt.md'), { targetSpec: target.spec, draft: draft.slice(0, 8000) }),
    }]);
    if (!result.success) throw new Error(result.error);
    res.json({
      success: true,
      data: { draft: result.content.trim(), note: `已改写为「${target.label}」版（¥${result.cost?.toFixed(4)}）`, cost: result.cost },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// LLM 返回的 JSON 偶带 markdown 代码块围栏，统一剥掉再解析（同 thread-generation 处理）
function parseLlmJson(content) {
  const cleaned = content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

// 批评人格审稿（P2，方法论：批评人格法/Sudowrite Beta Read 模式）：三个固定视角
// 通读草稿输出 3-6 条具体批注（不改稿）。设计红线：AI 产出只是建议，
// 用户点「按此修改」才触发改写；"没问题就说没问题"写进了 prompt（Canvas 反模式教训）
app.post('/api/studio/critique', async (req, res) => {
  try {
    const { draft, platform } = req.body;
    if (!draft?.trim()) return res.status(400).json({ success: false, error: 'draft is required' });
    const { chat } = await import('./services/llm.js');
    const { loadPrompt, render, getPlatform } = await import('./services/creation-prompts.js');
    let platformNote = '文稿';
    try { platformNote = getPlatform(platform).note; } catch { /* 平台未知不阻塞审稿 */ }
    const result = await chat([{
      role: 'user',
      content: render(loadPrompt('critique.md'), { platformNote, draft: draft.slice(0, 8000) }),
    }]);
    if (!result.success) throw new Error(result.error);
    const parsed = parseLlmJson(result.content);
    res.json({
      success: true,
      data: {
        verdict: parsed.verdict || '',
        points: Array.isArray(parsed.points) ? parsed.points : [],
        cost: result.cost,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 选段 N 个改法（P2，方法论：多候选卡片/Sudowrite 多卡模式）：对选中片段
// 给 3 个策略不同的候选（锋利/具体/简洁），用户挑一个原位替换，不满意全部放弃
app.post('/api/studio/variants', async (req, res) => {
  try {
    const { draft, selection, platform } = req.body;
    if (!draft?.trim() || !selection?.trim()) {
      return res.status(400).json({ success: false, error: 'draft and selection are required' });
    }
    const { chat } = await import('./services/llm.js');
    const { loadPrompt, render, getPlatform } = await import('./services/creation-prompts.js');
    let platformNote = '文稿';
    try { platformNote = getPlatform(platform).note; } catch { /* 平台未知不阻塞 */ }
    const result = await chat([{
      role: 'user',
      content: render(loadPrompt('variants.md'), {
        platformNote,
        draft: draft.slice(0, 8000),
        selection: selection.slice(0, 2000),
      }),
    }]);
    if (!result.success) throw new Error(result.error);
    const parsed = parseLlmJson(result.content);
    if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
      throw new Error('LLM 未返回 variants 数组');
    }
    res.json({ success: true, data: { variants: parsed.variants.slice(0, 3), cost: result.cost } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== M2 洞察层：日报与选题（ADR-008） ==========

// 生成今日日报（调用 Deepseek，一次约 ¥0.005；同日重跑覆盖旧报告）
app.post('/api/reports/generate', async (req, res) => {
  try {
    const { generateDailyReport } = await import('./services/report-generation.js');
    const result = await generateDailyReport();
    res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reports/latest', async (req, res) => {
  try {
    const { getLatestReport } = await import('./services/report-generation.js');
    const report = getLatestReport(req.query.period || 'daily');
    res.json({ success: true, data: report }); // 无报告时 data 为 null，前端据此显示"生成日报"入口
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 为你推荐（VISION-V4 UI 改造 2b）：读缓存（cron/启动刷新），秒回
app.get('/api/recommendations', async (req, res) => {
  try {
    const { getCachedRecommendations } = await import('./services/recommend.js');
    res.json({ success: true, data: getCachedRecommendations() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 今日必看（P1 层4）：双通道配额制（行业大事 + 个人相关），实时算（无 LLM/嵌入，读向量即可，毫秒级）
app.get('/api/must-read', async (req, res) => {
  try {
    const { getMustRead } = await import('./services/must-read.js');
    res.json({ success: true, data: getMustRead() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// 显式 mute（源/内容级"没兴趣"）——只过滤、不自动学权重（卡兹克红线）
app.post('/api/must-read/mute', async (req, res) => {
  try {
    const { sourceId, contentId } = req.body || {};
    if (!sourceId && !contentId) return res.status(400).json({ success: false, error: 'sourceId 或 contentId 必填' });
    const { addMute } = await import('./services/must-read.js');
    res.json({ success: true, data: addMute({ sourceId, contentId }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 行业面（VISION-V4 阶段2）：复用 AI HOT 热门内容做行业提要 + 跳转，不重新生成（零 LLM）
app.get('/api/industry-brief', async (req, res) => {
  try {
    const { getIndustryBrief } = await import('./services/industry-brief.js');
    res.json({ success: true, data: getIndustryBrief(req.query.period || 'daily') });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 灵感库列表（ADR-029）：跨全部报告 + 用户手记 + 外部连接器一处收口。?status= / ?sourceKind= 过滤。
// 每条附「火候」readiness（批次2 写作看板）：料厚/贴合主题/时效 → 阶段，驱动看板列。
app.get('/api/ideas', async (req, res) => {
  try {
    const { listIdeas } = await import('./db/ideas.js');
    const { annotateReadiness } = await import('./services/idea-readiness.js');
    const data = annotateReadiness(listIdeas({
      status: req.query.status || null,
      sourceKind: req.query.sourceKind || null,
      includeDismissed: req.query.includeDismissed === '1',
    }));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 手记一条灵感（随手记：备忘录/群聊/脑内瞬间想法）。source_kind 默认 user。
// 手记（user）且没自带料时，自动补料——拿标题语义检索素材库挂上相关素材（解决"手记灵感是孤岛"）。
app.post('/api/ideas', async (req, res) => {
  try {
    const { title } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ success: false, error: 'title is required' });
    const { createIdea, getIdea } = await import('./db/ideas.js');
    const sourceKind = req.body.sourceKind || 'user';
    const idea = createIdea({
      title,
      body: req.body.body || null,
      angle: req.body.angle || null,
      whyNow: req.body.whyNow || null,
      sourceKind,
      sourceRef: req.body.sourceRef || null,
      supportingContentIds: req.body.supportingContentIds || [],
      supportingNoteIds: req.body.supportingNoteIds || [],
    });
    if (sourceKind === 'user' && !(req.body.supportingNoteIds?.length)) {
      try {
        const { autoLinkIdea } = await import('./services/idea-readiness.js');
        await autoLinkIdea(idea.id);
      } catch (e) { console.warn('[ideas] 自动补料失败（不影响保存）:', e.message); }
    }
    res.json({ success: true, data: getIdea(idea.id) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 按需补料（看板"攒着"栏的 ✨补料 按钮）：重跑语义检索，把相关素材作为**建议**挂上（related）。
app.post('/api/ideas/:id/autolink', async (req, res) => {
  try {
    const { autoLinkIdea } = await import('./services/idea-readiness.js');
    const { getIdea } = await import('./db/ideas.js');
    const added = await autoLinkIdea(req.params.id);
    res.json({ success: true, added, data: getIdea(req.params.id) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 采纳一条相关建议为真·料（related → supporting）。采纳后火候才把它算进去。
app.post('/api/ideas/:id/adopt-note', async (req, res) => {
  try {
    const { noteId } = req.body || {};
    if (!noteId) return res.status(400).json({ success: false, error: 'noteId is required' });
    const { adoptRelatedNote, getIdea } = await import('./db/ideas.js');
    const done = adoptRelatedNote(req.params.id, noteId);
    res.json({ success: done, data: done ? getIdea(req.params.id) : null });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 编辑灵感（Q3）：改标题/角度/为什么现在。
app.patch('/api/ideas/:id/edit', async (req, res) => {
  try {
    const { updateIdea, getIdea } = await import('./db/ideas.js');
    const done = updateIdea(req.params.id, {
      title: req.body?.title,
      body: req.body?.body,
      angle: req.body?.angle,
      whyNow: req.body?.whyNow,
    });
    res.json({ success: done, data: done ? getIdea(req.params.id) : null });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 外部连接器入口（飞书妙记/会议纪要/群聊/云文档、备忘录、微信、agent 一句话…）：
// 任何连接器把一条灵感 POST 到这里即可流进灵感库。source_kind 标明来路（如 'feishu'），
// source_ref 存回链（文档/消息 URL 或 {docUrl,messageId} JSON）。这是灵感库的通用接缝——
// 具体的飞书拉取/事件订阅由独立连接器完成后调用本接口，核心库不依赖任何外部凭证。
app.post('/api/ideas/ingest', async (req, res) => {
  try {
    const { title } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ success: false, error: 'title is required' });
    const { createIdea } = await import('./db/ideas.js');
    const idea = createIdea({
      title,
      angle: req.body.angle || null,
      whyNow: req.body.whyNow || null,
      sourceKind: req.body.sourceKind || 'external',
      sourceRef: req.body.sourceRef || null,
      supportingContentIds: req.body.supportingContentIds || [],
      supportingNoteIds: req.body.supportingNoteIds || [],
    });
    res.json({ success: true, data: idea });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 硬删一条灵感（区别于 PATCH status='dismissed' 的"忽略但留痕"）
app.delete('/api/ideas/:id', async (req, res) => {
  try {
    const { deleteIdea } = await import('./db/ideas.js');
    const done = deleteIdea(req.params.id);
    res.json({ success: done, message: done ? 'Idea deleted' : 'Idea not found' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 选题状态流转：suggested → adopted（采纳）/ dismissed（忽略）/ created（已创作）
app.patch('/api/ideas/:id', async (req, res) => {
  try {
    const rg = await import('./services/report-generation.js');
    // removeContentId：从选题移除一条支撑素材（用户裁决 AI 聚合结果）
    const done = req.body?.removeContentId
      ? rg.removeIdeaSupport(req.params.id, req.body.removeContentId)
      : rg.updateIdeaStatus(req.params.id, req.body?.status);
    res.json({ success: done, message: done ? 'Idea updated' : 'Idea not found' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ========== 飞书接入（ADR-037）：来源不是打字框 ==========
// 触点① 即时分析「从飞书选」：GET /pick 列可挑对象 → POST /analyze 抓正文送即时分析管道。
// 触点② 被动收件箱：POST /sync 定时/手动拉取 → GET /inbox 列待整理 → POST /inbox/:id/triage 分诊。
// 凭证只在 backend/.env（FEISHU_APP_ID/SECRET），核心库不依赖；未配置时各接口给清晰提示、不空转。

app.get('/api/feishu/status', async (req, res) => {
  try {
    const { feishuConfigured, feishuBase } = await import('./services/feishu-auth.js');
    const { pendingCount } = await import('./db/feishu-inbox.js');
    const { feishuBotStarted } = await import('./services/feishu-bot.js');
    const { feishuUserConnected } = await import('./services/feishu-user-auth.js');
    res.json({
      success: true,
      data: {
        configured: feishuConfigured(),
        base: feishuBase(),
        botStarted: feishuBotStarted(),        // 私信机器人长连接是否已起
        userConnected: feishuUserConnected(),  // 是否已完成用户授权（取料能读你个人文档）
        pending: feishuConfigured() ? pendingCount() : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/feishu/sync', async (req, res) => {
  try {
    const { syncFeishu } = await import('./services/feishu-sync.js');
    const result = await syncFeishu({ perSource: parseInt(req.body?.perSource) || 20 });
    res.json({ success: result.ok, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/feishu/inbox', async (req, res) => {
  try {
    const { listInbox } = await import('./db/feishu-inbox.js');
    res.json({ success: true, data: listInbox({ status: req.query.status || 'pending' }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/feishu/inbox/:id/triage', async (req, res) => {
  try {
    const { triageInboxItem } = await import('./services/feishu-triage.js');
    const result = await triageInboxItem(req.params.id, req.body?.action);
    res.json({ success: result.ok, data: result, error: result.ok ? undefined : result.error });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/feishu/pick', async (req, res) => {
  try {
    const { listPickable } = await import('./services/feishu-sync.js');
    const result = await listPickable({ perSource: parseInt(req.query.perSource) || 15 });
    res.json({ success: result.ok, data: result.items || [], error: result.ok ? undefined : result.error });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 飞书用户授权 OAuth（ADR-039 · 取料读个人文档）----
// 个人版飞书不让把应用加协作者 → 走用户授权，以你身份读你能看到的一切。redirect_uri 用 localhost。
app.get('/api/feishu/oauth/start', async (req, res) => {
  try {
    const { authorizeUrl } = await import('./services/feishu-user-auth.js');
    res.redirect(authorizeUrl('kw'));
  } catch (error) {
    res.status(500).send('飞书授权发起失败：' + error.message);
  }
});
app.get('/api/feishu/oauth/callback', async (req, res) => {
  const { code, error, error_description } = req.query || {};
  const page = (title, body, ok) => `<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,PingFang SC,sans-serif;max-width:520px;margin:60px auto;text-align:center;color:#332f27">
    <div style="font-size:44px">${ok ? '✅' : '⚠️'}</div>
    <h2 style="color:${ok ? '#3f7350' : '#a24b3f'}">${title}</h2><p style="color:#706b60;line-height:1.7">${body}</p>
    <p style="color:#8a8478;font-size:13px">这个页面可以关掉，回工作台的「灵感」页刷新即可。</p></body>`;
  if (error) return res.status(400).send(page('授权未完成', `飞书返回：${error} ${error_description || ''}`, false));
  if (!code) return res.status(400).send(page('授权未完成', '没拿到授权码，请重试。', false));
  try {
    const { exchangeCode } = await import('./services/feishu-user-auth.js');
    await exchangeCode(code);
    res.send(page('已连接飞书', '现在工作台能以你的身份读你飞书里的文档了——粘链接 / 搜索 / 拉来读 都能读你的个人文档。', true));
  } catch (e) {
    res.status(500).send(page('连接失败', e.message + '<br>多半是重定向 URL 没配对，或云文档读权限没开/没发版。', false));
  }
});
app.get('/api/feishu/oauth/status', async (req, res) => {
  try {
    const { feishuUserConnected } = await import('./services/feishu-user-auth.js');
    res.json({ success: true, data: { connected: feishuUserConnected() } });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.post('/api/feishu/oauth/disconnect', async (req, res) => {
  try {
    const { disconnect } = await import('./services/feishu-user-auth.js');
    disconnect();
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 从飞书门·搜索 tab：飞书原生全文搜索（覆盖整个飞书、实时）。返回与 pick 同 shape，可直接「拉来读」。
app.get('/api/feishu/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, data: [] });
    const { searchDocs } = await import('./services/feishu-client.js');
    res.json({ success: true, data: await searchDocs(q, { count: 12 }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 「从飞书选」挑中一条 → 抓正文，返回与 /api/content/ingest 同 shape 的 data，前端直接送右栏解读。
app.post('/api/feishu/analyze', async (req, res) => {
  try {
    const { objType, feishuId, extra, title, url } = req.body || {};
    if (!objType || !feishuId) return res.status(400).json({ success: false, error: 'objType/feishuId 必填' });
    const { getObjectText, getDocxTitle } = await import('./services/feishu-client.js');
    const body = await getObjectText(objType, feishuId, extra || {});
    if (!body?.trim()) {
      return res.json({ success: false, error: '飞书这篇正文为空或没抓到（文档需把应用加为协作者，妙记需开转写权限）' });
    }
    let zhTitle = title;
    if (!zhTitle && objType === 'docx') zhTitle = await getDocxTitle(feishuId).catch(() => null);
    res.json({
      success: true,
      data: {
        zhTitle: zhTitle || '飞书内容',
        zhBody: body,
        url: url || null,
        metadata: { 来源: '飞书', 类型: objType },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== M3 知识层：Topic 活页 + 同化（ADR-009） ==========

app.get('/api/topics', async (req, res) => {
  try {
    const { listTopics } = await import('./services/topic-pages.js');
    res.json({ success: true, data: listTopics() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 手动建页（主题库搜索框输入新主题）。零 LLM，建页时回扫已有素材挂为待并入。
app.post('/api/topics', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    const { createTopic } = await import('./services/topic-pages.js');
    const topic = createTopic({ name, description });
    // 回扫到历史素材 → 后台自动同化，新页直接长出综述（保存即同化的同一设计）
    if (topic.pending_notes?.length) {
      import('./services/assimilation.js').then(({ assimilate }) =>
        assimilate(topic.id, null, 0.15).then(r => console.log(`[Topics] 建页自动并入「${topic.name}」:`, r.success ? r.data.changelog : r.error))
          .catch(err => console.error('[Topics] 建页自动并入异常:', err.message)));
    }
    res.json({ success: true, data: topic });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 建议主题（三信号合流：热点聚类 + 近期素材 + 涌现建议；每日缓存，点"建页"才生效）
app.get('/api/topics/suggestions', async (req, res) => {
  try {
    const { getTopicSuggestions } = await import('./services/topic-suggestions.js');
    res.json({ success: true, data: await getTopicSuggestions({ force: req.query.force === '1' }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/topics/suggestions/dismiss', async (req, res) => {
  try {
    if (!req.body?.name) return res.status(400).json({ success: false, error: 'name is required' });
    const { dismissSuggestion } = await import('./services/topic-suggestions.js');
    dismissSuggestion(req.body.name);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 选题升级建页（洞察 → 知识库闭环，幂等：同一选题重复升级返回已有活页）
app.post('/api/topics/from-idea', async (req, res) => {
  try {
    const { ideaId } = req.body;
    if (!ideaId) {
      return res.status(400).json({ success: false, error: 'ideaId is required' });
    }
    const { createTopicFromIdea } = await import('./services/topic-pages.js');
    const topic = createTopicFromIdea(ideaId);
    if (topic.pending_notes?.length) {
      import('./services/assimilation.js').then(({ assimilate }) =>
        assimilate(topic.id, null, 0.15).then(r => console.log(`[Topics] 升级建页自动并入「${topic.name}」:`, r.success ? r.data.changelog : r.error))
          .catch(err => console.error('[Topics] 升级建页自动并入异常:', err.message)));
    }
    res.json({ success: true, data: topic });
  } catch (error) {
    const status = error.message === 'Idea not found' ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// 活页详情：正文 + 修订时间线 + 待并入素材
app.get('/api/topics/:id', async (req, res) => {
  try {
    const { getTopicDetail } = await import('./services/topic-pages.js');
    const topic = getTopicDetail(req.params.id);
    if (!topic) return res.status(404).json({ success: false, error: 'Topic not found' });
    res.json({ success: true, data: topic });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 同化：把待并入素材合进活页正文（一批一次 Deepseek 调用，noteIds 缺省 = 全部）
app.post('/api/topics/:id/assimilate', async (req, res) => {
  try {
    const { assimilate } = await import('./services/assimilation.js');
    const result = await assimilate(req.params.id, req.body?.noteIds);
    res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    const status = error.message === 'Topic not found' ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// AI 改名建议（3 个短名候选，一次 Deepseek 调用）
app.post('/api/topics/:id/suggest-names', async (req, res) => {
  try {
    const { suggestTopicNames } = await import('./services/topic-pages.js');
    res.json({ success: true, data: await suggestTopicNames(req.params.id) });
  } catch (error) {
    const status = error.message === 'Topic not found' ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// 移出素材（误并撤销）：pending 纯解绑；已并入则同时 LLM 修订综述剔除其贡献
app.delete('/api/topics/:id/notes/:noteId', async (req, res) => {
  try {
    const { removeNoteFromTopic } = await import('./services/assimilation.js');
    const result = await removeNoteFromTopic(req.params.id, req.params.noteId);
    res.status(result.success ? 200 : 404).json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 改名/改描述（自动建页的名字常偏长，必须可改）
app.patch('/api/topics/:id', async (req, res) => {
  try {
    const { updateTopicMeta } = await import('./services/topic-pages.js');
    res.json({ success: true, data: updateTopicMeta(req.params.id, req.body || {}) });
  } catch (error) {
    const status = error.message === 'Topic not found' ? 404 : 400;
    res.status(status).json({ success: false, error: error.message });
  }
});

// 删除活页（changelog 与素材关联级联清除，素材卡片本身保留）
app.delete('/api/topics/:id', async (req, res) => {
  try {
    const { deleteTopic } = await import('./services/topic-pages.js');
    const done = deleteTopic(req.params.id);
    res.json({ success: done, message: done ? 'Topic deleted' : 'Topic not found' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 手动把素材归入主题（仍走 pending → 并入流程，同化入口唯一）
app.post('/api/notes/:id/topics', async (req, res) => {
  try {
    const { topicId } = req.body;
    if (!topicId) {
      return res.status(400).json({ success: false, error: 'topicId is required' });
    }
    const { linkNoteToTopic } = await import('./services/topic-pages.js');
    linkNoteToTopic(req.params.id, topicId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 周报/月报生成（涌现：新活页建议 + 跨页关联 + 矛盾预警 + 深度选题）
app.post('/api/reports/generate-period', async (req, res) => {
  try {
    const { generatePeriodReport } = await import('./services/period-report.js');
    const result = await generatePeriodReport(req.body?.period || 'weekly');
    res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== M1 沉淀层：素材卡片 Notes（ADR-010） ==========

app.get('/api/notes', async (req, res) => {
  try {
    const { getNotes } = await import('./db/notes.js');
    res.json({
      success: true,
      data: getNotes({
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
        q: req.query.q || null,
        topicId: req.query.topicId || null,
        source: req.query.source || null,
        ctype: req.query.ctype || null,
      }),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 未归类素材聚合建议（2026-07-16 反馈 #4：AI 提议"哪些放一起、为什么"，本地零 LLM）
app.get('/api/notes/cluster-suggestions', async (req, res) => {
  try {
    const { getClusterSuggestions } = await import('./services/note-clusters.js');
    res.json({ success: true, data: getClusterSuggestions() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 素材来源下拉选项（按素材数排序）
app.get('/api/notes/sources', async (req, res) => {
  try {
    const { getNoteSources } = await import('./db/notes.js');
    res.json({ success: true, data: getNoteSources() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 素材语义检索（VISION-V4 阶段1a）：模糊需求 → 语义找素材（不是关键词 LIKE）
app.get('/api/notes/search-semantic', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) return res.json({ success: true, data: [] });
    const { searchNotes } = await import('./services/semantic-search.js');
    const data = await searchNotes(q, { limit: parseInt(req.query.limit) || 20 });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 某条素材的相关素材（VISION-V4 阶段1b，知识关联图/死知识变活网）
app.get('/api/notes/:id/related', async (req, res) => {
  try {
    const { relatedNotes } = await import('./services/semantic-search.js');
    res.json({ success: true, data: relatedNotes(req.params.id, { limit: parseInt(req.query.limit) || 6 }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 语义补归类建议：每条素材语义贴合、但还没标的主题（漏归/多主题提示）
app.get('/api/notes/topic-suggestions', async (req, res) => {
  try {
    const { suggestTopicsForAllNotes } = await import('./services/topic-suggest.js');
    res.json({ success: true, data: await suggestTopicsForAllNotes() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 新主题启发：把不属于任何现有主题、彼此语义相关的素材聚成堆，建议建新主题（语义版，替代关键词聚类）
app.get('/api/notes/new-topic-suggestions', async (req, res) => {
  try {
    const { suggestNewTopics } = await import('./services/topic-suggest.js');
    res.json({ success: true, data: await suggestNewTopics() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 疑似重复素材分组（VISION-V4 阶段1b，查重）
app.get('/api/notes/duplicates', async (req, res) => {
  try {
    const { findDuplicates } = await import('./services/semantic-search.js');
    const threshold = req.query.threshold ? parseFloat(req.query.threshold) : 0.85;
    res.json({ success: true, data: findDuplicates({ threshold }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 语义索引状态（前端提示"还有 N 条未建索引"）
app.get('/api/notes/index-status', async (req, res) => {
  try {
    const { indexStatus } = await import('./services/semantic-search.js');
    res.json({ success: true, data: indexStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 重建语义索引（首次上线 / 换模型后；force=1 全量重算）
app.post('/api/notes/reindex', async (req, res) => {
  try {
    const { reindexNotes } = await import('./services/semantic-search.js');
    const data = await reindexNotes({ force: req.query.force === '1' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/notes', async (req, res) => {
  try {
    const { excerpt, noteType, contentId, sourceTitle, sourceUrl, stance } = req.body;
    if (!excerpt?.trim()) {
      return res.status(400).json({ success: false, error: 'excerpt is required' });
    }
    const { createNote } = await import('./db/notes.js');
    const note = createNote({ excerpt, noteType, contentId, sourceTitle, sourceUrl, stance });

    // 后台起人话标题（≤12 字），不阻塞保存；下次 loadNotes 即可见
    import('./services/note-title.js')
      .then(({ generateNoteTitle }) => generateNoteTitle(note.id, note.excerpt))
      .catch(err => console.error('[Notes] title generation failed:', err.message));

    // 后台提取关键词标签（M7：补搜索召回），复用 keyword-extractor，不阻塞保存
    Promise.all([import('./services/keyword-extractor.js'), import('./db/notes.js')])
      .then(async ([{ extractKeywords }, { setNoteKeywords }]) => {
        const kw = await extractKeywords(sourceTitle || '素材摘录', excerpt.slice(0, 600));
        if (kw) setNoteKeywords(note.id, kw.split(/[,，、]\s*/).filter(Boolean).slice(0, 6));
      })
      .catch(err => console.error('[Notes] keyword extraction failed:', err.message));

    // 后台生成语义向量（VISION-V4 阶段1a）：保存即可被语义搜索/RAG 检索到，不阻塞保存
    import('./services/semantic-search.js')
      .then(({ embedNoteById }) => embedNoteById(note.id))
      .catch(err => console.error('[Notes] embedding failed:', err.message));

    // M3 同化（设计文档 §引擎B：保存素材即触发，用户不需要理解"待并入"）：
    // 1. 自动匹配活跃 Topic（本地 TF 余弦，零成本）
    // 2. 命中的主题后台异步同化（一次 ¥0.002 级），不阻塞保存响应；
    //    失败不丢数据——素材停留在 pending，主题页"待并入"区可手动补并（兜底）
    let matchedTopics = [];
    try {
      const { matchNoteToTopics } = await import('./services/topic-pages.js');
      matchedTopics = matchNoteToTopics(note.id);
      if (matchedTopics.length) {
        import('./services/assimilation.js').then(({ assimilate }) => {
          // 只有高置信匹配（≥0.15）自动并入；弱匹配留在主题页"待并入"等用户确认
          for (const m of matchedTopics.filter(x => x.relevance >= 0.15)) {
            assimilate(m.topicId, [note.id], 0.15).then(r => {
              if (r.success) console.log(`[Notes] 已自动并入「${m.name}」: ${r.data.changelog}`);
              else console.error(`[Notes] 自动并入「${m.name}」失败: ${r.error}`);
            }).catch(err => console.error(`[Notes] 自动并入「${m.name}」异常:`, err.message));
          }
        });
      }
    } catch (err) {
      console.error('[Notes] topic match failed:', err.message);
    }

    res.json({ success: true, data: note, matchedTopics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 摘除素材的某个主题关联（AI 自动匹配错了 / 用户归错了）
app.delete('/api/notes/:id/topics/:topicId', async (req, res) => {
  try {
    const { unlinkNoteFromTopic } = await import('./services/topic-pages.js');
    const done = unlinkNoteFromTopic(req.params.id, req.params.topicId);
    res.json({ success: done, message: done ? 'Unlinked' : 'Link not found' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 修改素材标题（AI 起的人话标题写错/不贴切时手动改）
app.patch('/api/notes/:id', async (req, res) => {
  try {
    const title = req.body?.title?.trim();
    if (!title) return res.status(400).json({ success: false, error: 'title is required' });
    const { setNoteTitle } = await import('./db/notes.js');
    const done = setNoteTitle(req.params.id, title);
    res.json({ success: done, message: done ? 'Title updated' : 'Note not found' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/notes/:id', async (req, res) => {
  try {
    const { deleteNote } = await import('./db/notes.js');
    const deleted = deleteNote(req.params.id);
    res.json({ success: deleted, message: deleted ? 'Note deleted' : 'Note not found' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== M1 沉淀层：优质源登记处 Sources（ADR-007） ==========

// 识别预览（不落库）：丢链接/公众号名称 → 返回识别出的身份 + track_mode，前端确认后再 register
app.post('/api/sources/identify', async (req, res) => {
  try {
    const { input } = req.body;
    if (!input?.trim()) {
      return res.status(400).json({ success: false, error: 'input is required' });
    }
    const { identifyInput } = await import('./services/source-registry.js');
    const identified = await identifyInput(input);
    res.json({ success: true, data: identified });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 登记：接收 identify 返回的结构（前端可修改 displayName 后提交）
app.post('/api/sources/register', async (req, res) => {
  try {
    const { identified } = req.body;
    if (!identified?.platform || !identified?.handle) {
      return res.status(400).json({ success: false, error: 'identified (with platform + handle) is required' });
    }
    const { registerSource } = await import('./services/source-registry.js');
    const source = registerSource(identified);
    res.json({ success: true, data: source });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 一键登记官方源包（Anthropic/OpenAI/Google 系，feed 均已实测；幂等可重复点）
app.post('/api/sources/register-pack', async (req, res) => {
  try {
    const { registerOfficialPack } = await import('./services/source-registry.js');
    res.json({ success: true, data: registerOfficialPack() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/sources', async (req, res) => {
  try {
    const { listSources } = await import('./services/source-registry.js');
    const sources = listSources({ registeredOnly: req.query.registered === '1' });
    res.json({ success: true, data: sources });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 取消登记（只摘标记，不删 source 记录，内容引用不受影响）
app.delete('/api/sources/:id/register', async (req, res) => {
  try {
    const { unregisterSource } = await import('./services/source-registry.js');
    const done = unregisterSource(req.params.id);
    res.json({ success: done, message: done ? 'Source unregistered' : 'Source not found' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// "把作者加为信息源"（飞轮闭环：内容 → Source）
app.post('/api/contents/:id/follow-source', async (req, res) => {
  try {
    const { followSourceOfContent } = await import('./services/source-registry.js');
    const source = await followSourceOfContent(req.params.id);
    res.json({ success: true, data: source });
  } catch (error) {
    const status = error.message === 'Content not found' ? 404 : 400;
    res.status(status).json({ success: false, error: error.message });
  }
});

// 文章相关 API（v0.1 旧架构，读写 items 表，即将被上面的 /api/contents 取代，尚未移除以免破坏现有前端页面）
app.get('/api/items', async (req, res) => {
  try {
    const { getItems } = await import('./db/db.js');
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const items = getItems(limit, offset);

    res.json({
      success: true,
      data: items,
      count: items.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/items/:id', async (req, res) => {
  try {
    const { getItemById } = await import('./db/db.js');
    const item = getItemById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }

    res.json({
      success: true,
      data: item
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const { itemId, action } = req.body;

    if (!itemId || !action) {
      return res.status(400).json({
        success: false,
        error: 'itemId and action are required'
      });
    }

    const { updateUserAction } = await import('./db/db.js');
    const updated = updateUserAction(itemId, action);

    res.json({
      success: updated,
      message: updated ? 'Feedback recorded' : 'Item not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    const { syncAIHotData } = await import('./services/sync-aihot.js');
    const result = await syncAIHotData();

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 全量同步（2026-07-16 反馈 #7：此前前端"刷新"只走 AI HOT，登记的 RSS/主动查询源
// 永远不会因刷新出新内容）。三条链顺序跑、单链失败不阻塞其余，逐渠道返回结果与跳过原因。
// 抽成函数供定时任务复用（2026-07-16 反馈 #5：无定时同步 → 不手动刷新的日子内容永久错过）
async function syncAllChannels() {
  const channels = {};
  const run = async (name, fn) => {
    try { channels[name] = await fn(); }
    catch (error) { channels[name] = { success: false, error: error.message }; }
  };

  await run('aihot', async () => (await import('./services/sync-aihot.js')).syncAIHotData());
  await run('rss', async () => (await import('./services/sync-rss.js')).syncRSSData());
  await run('activeQuery', async () => (await import('./services/sync-active-query.js')).syncActiveQuery());

  // 记录同步时间（漏跑补偿的判断依据，见下方 catchUpSyncIfStale）
  try {
    const { writeFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    writeFileSync(fileURLToPath(new URL('../data/last-sync.json', import.meta.url)),
      JSON.stringify({ at: new Date().toISOString() }));
  } catch (err) { console.error('[sync] 写入 last-sync 失败:', err.message); }

  // 摘要兜底（P1 层1）：异步补齐"有正文没摘要"的条目（Anthropic/OpenAI 官网 RSS 常无 description
  // → 列表只剩光杆标题）。fire-and-forget，不阻塞同步返回；cron 与手动同步都会触发。
  import('./services/summary-backfill.js')
    .then(m => m.backfillMissingSummaries({ limit: 30 }))
    .then(r => r.summarized && console.log(`[sync] 摘要兜底：补 ${r.summarized}/${r.total} 条`))
    .catch(err => console.error('[sync] 摘要兜底失败:', err.message));

  const total = (channels.aihot?.count || 0) + (channels.rss?.count || 0) + (channels.activeQuery?.inserted || 0);
  return { total, channels };
}

// 漏跑补偿（2026-07-16：launchd 常驻后，合盖睡眠时 cron 到点不触发——
// 距上次同步超 12 小时就补跑一轮。启动 20s 后查一次 + 每小时兜底一次）
async function catchUpSyncIfStale() {
  try {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { at } = JSON.parse(readFileSync(fileURLToPath(new URL('../data/last-sync.json', import.meta.url)), 'utf-8'));
    if (Date.now() - new Date(at).getTime() < 12 * 3600 * 1000) return;
  } catch { /* 无记录 → 视为过期 */ }
  console.log('[cron] 距上次同步超过 12 小时（睡眠/关机漏跑），开始补偿同步…');
  try {
    const { total } = await syncAllChannels();
    console.log(`[cron] 补偿同步完成：+${total} 条`);
  } catch (err) { console.error('[cron] 补偿同步失败:', err.message); }
}
setTimeout(catchUpSyncIfStale, 20 * 1000);
setInterval(catchUpSyncIfStale, 3600 * 1000);

app.post('/api/sync-all', async (req, res) => {
  res.json({ success: true, data: await syncAllChannels() });
});

// 同步状态（P0-7 可感知性）：暴露上次同步时间，让资讯页显示"上次同步 x 小时前 · 自动"。
// 自动同步能力早已在（cron 8:10/20:10 + 离线超 12h 补跑 + 每小时兜底），此前 UI 上一个字都没提。
app.get('/api/sync-status', async (req, res) => {
  try {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { at } = JSON.parse(readFileSync(fileURLToPath(new URL('../data/last-sync.json', import.meta.url)), 'utf-8'));
    res.json({ success: true, data: { lastSyncAt: at || null } });
  } catch {
    res.json({ success: true, data: { lastSyncAt: null } }); // 无记录 → 前端显示"尚未同步"
  }
});

// ========== v0.2.0 工作区对话 API ==========

// 工作区管理
app.post('/api/workspaces', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'name is required'
      });
    }

    const { createWorkspace } = await import('./db/workspaces.js');
    const workspace = createWorkspace(name, description);

    res.json({
      success: true,
      data: workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/workspaces', async (req, res) => {
  try {
    const { getWorkspaces } = await import('./db/workspaces.js');
    const workspaces = getWorkspaces();

    res.json({
      success: true,
      data: workspaces
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/workspaces/:id', async (req, res) => {
  try {
    const { getWorkspaceById } = await import('./db/workspaces.js');
    const workspace = getWorkspaceById(req.params.id);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        error: 'Workspace not found'
      });
    }

    res.json({
      success: true,
      data: workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.put('/api/workspaces/:id', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'name is required'
      });
    }

    const { updateWorkspace } = await import('./db/workspaces.js');
    const updated = updateWorkspace(req.params.id, name, description);

    res.json({
      success: updated,
      message: updated ? 'Workspace updated' : 'Workspace not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.delete('/api/workspaces/:id', async (req, res) => {
  try {
    const { deleteWorkspace } = await import('./db/workspaces.js');
    const deleted = deleteWorkspace(req.params.id);

    res.json({
      success: deleted,
      message: deleted ? 'Workspace deleted' : 'Workspace not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 对话管理
app.post('/api/conversations', async (req, res) => {
  try {
    const { workspaceId, title, llmProvider } = req.body;

    if (!workspaceId || !title) {
      return res.status(400).json({
        success: false,
        error: 'workspaceId and title are required'
      });
    }

    const { createConversation } = await import('./db/workspaces.js');
    const conversation = createConversation(workspaceId, title, llmProvider);

    res.json({
      success: true,
      data: conversation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const { getConversationById } = await import('./db/workspaces.js');
    const conversation = getConversationById(req.params.id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      data: conversation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const { deleteConversation } = await import('./db/workspaces.js');
    const deleted = deleteConversation(req.params.id);

    res.json({
      success: deleted,
      message: deleted ? 'Conversation deleted' : 'Conversation not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 消息管理
app.post('/api/conversations/:id/messages', async (req, res) => {
  try {
    const { role, content } = req.body;
    const conversationId = req.params.id;

    if (!role || !content) {
      return res.status(400).json({
        success: false,
        error: 'role and content are required'
      });
    }

    const { addMessage } = await import('./db/workspaces.js');
    const message = addMessage(conversationId, role, content, 0, 0);

    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const { getMessagesByConversation } = await import('./db/workspaces.js');
    const messages = getMessagesByConversation(req.params.id);

    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 添加材料到对话
app.post('/api/conversations/:id/materials', async (req, res) => {
  try {
    const { itemId } = req.body;
    const conversationId = req.params.id;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: 'itemId is required'
      });
    }

    const { addMaterialToConversation } = await import('./db/workspaces.js');
    const added = addMaterialToConversation(conversationId, itemId);

    res.json({
      success: added,
      message: added ? 'Material added' : 'Material already exists'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// LLM 流式聊天（SSE）
app.post('/api/llm/chat', async (req, res) => {
  try {
    const { conversationId, message, provider = 'deepseek' } = req.body;

    if (!conversationId || !message) {
      return res.status(400).json({
        success: false,
        error: 'conversationId and message are required'
      });
    }

    // 获取对话历史和材料
    const { getMessagesByConversation, getMaterialsByConversation, addMessage } = await import('./db/workspaces.js');
    const history = getMessagesByConversation(conversationId);
    const materials = getMaterialsByConversation(conversationId);

    // 保存用户消息
    const userMessage = addMessage(conversationId, 'user', message);

    // 构建材料上下文（作为用户消息的前缀）
    let enhancedMessage = message;
    if (materials.length > 0) {
      let materialsContext = '# 参考材料\n\n';
      materials.forEach((m, i) => {
        materialsContext += `## 材料${i + 1}: ${m.title}\n`;
        materialsContext += `来源: ${m.source || m.url}\n`;
        if (m.summary) {
          materialsContext += `摘要: ${m.summary}\n`;
        }
        materialsContext += '\n';
      });
      materialsContext += '---\n\n请基于以上材料回答我的问题。如果材料中有相关信息，请引用并说明。\n\n';
      materialsContext += `问题: ${message}`;

      enhancedMessage = materialsContext;
    }

    // 构建消息上下文
    const messages = [];

    // 添加历史消息（不包括当前这条）
    messages.push(...history.slice(0, -1).map(msg => ({
      role: msg.role,
      content: msg.content
    })));

    // 添加增强后的当前用户消息
    messages.push({ role: 'user', content: enhancedMessage });

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { streamChat } = await import('./services/llm.js');

    let fullResponse = '';
    let totalTokens = 0;
    let totalCost = 0;

    for await (const chunk of streamChat(messages, provider)) {
      if (chunk.type === 'content') {
        fullResponse += chunk.content;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
      } else if (chunk.type === 'done') {
        totalTokens = chunk.tokens;
        totalCost = chunk.cost;

        // 保存助手消息
        addMessage(conversationId, 'assistant', fullResponse, totalTokens, totalCost);

        res.write(`data: ${JSON.stringify({
          type: 'done',
          tokens: totalTokens,
          cost: totalCost
        })}\n\n`);
      } else if (chunk.type === 'error') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
      }
    }

    res.end();
  } catch (error) {
    console.error('[Chat] Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// 成本统计
app.get('/api/stats/cost', async (req, res) => {
  try {
    const { getCostStats } = await import('./services/stats.js');
    const stats = getCostStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 AI Insight Hub backend running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`✨ v0.2.0 - Workspace Chat APIs enabled`);

  // 启动自检补跑（2026-07-18 修 Bug1）：凌晨 launchd 睡眠错过时，一开机 backend 就把
  // 当天缺的日报补上。延迟 20s 让首次可能的同步先落地；已有当天报告则跳过（不烧 LLM）。
  setTimeout(async () => {
    try {
      const { ensureDailyReport } = await import('./services/report-generation.js');
      const r = await ensureDailyReport();
      console.log(r.skipped ? '[startup] 今日日报已存在，跳过补跑' : `[startup] 已补跑今日日报（${r.data?.period_key}）`);
    } catch (err) {
      console.error('[startup] 日报补跑失败:', err.message);
    }
    // 为你推荐缓存为空则算一次（首次上线/重启后）
    try {
      const { getCachedRecommendations, refreshRecommendations } = await import('./services/recommend.js');
      if (getCachedRecommendations().length === 0) await refreshRecommendations();
    } catch (err) {
      console.error('[startup] 为你推荐刷新失败:', err.message);
    }
  }, 20000);

  // 飞书私信机器人（ADR-039）：长连接监听私信 → 捕获进灵感待整理、问句才回。
  // 配了飞书凭证就随 backend 常驻启动；未配置/失败只记日志不中断。
  import('./services/feishu-bot.js').then(({ startFeishuBot }) => startFeishuBot())
    .catch(err => console.error('[startup] 飞书私信机器人启动异常:', err.message));
});

// 定时全渠道同步 + 日报生成：每天 08:10 / 20:10（2026-07-16 反馈 #2/#5 的共同根因：
// 此前同步只在手动刷新时发生，AI HOT 翻页窗口有限，不刷新的日子内容永久错过——
// DB 实证 7 天里只有 4 天有数据）。node-cron 随 backend 常驻（TCC 已授权、比睡眠的
// launchd 可靠），同步完顺手生成当天日报，失败只记日志不中断服务。
import('node-cron').then(({ default: cron }) => {
  cron.schedule('10 8,20 * * *', async () => {
    console.log('[cron] scheduled sync-all start');
    try {
      const { total, channels } = await syncAllChannels();
      console.log(`[cron] sync-all done: +${total} 条`, Object.fromEntries(
        Object.entries(channels).map(([k, v]) => [k, v.error || (v.count ?? v.inserted ?? 0)])
      ));
    } catch (err) {
      console.error('[cron] sync-all failed:', err.message);
    }
    // 同步后给新内容补分类（UI 改造 2b：资讯页 chips），只分未分类的、缓存不重算
    try {
      const { classifyUnclassified } = await import('./services/content-classify.js');
      const c = await classifyUnclassified();
      console.log(`[cron] 内容分类：+${c.classified} 条`);
    } catch (err) {
      console.error('[cron] 内容分类失败:', err.message);
    }
    // 刷新"为你推荐"缓存（向量匹配主题，约 10s，故缓存）
    try {
      const { refreshRecommendations } = await import('./services/recommend.js');
      await refreshRecommendations();
    } catch (err) {
      console.error('[cron] 为你推荐刷新失败:', err.message);
    }
    // 同步后生成/刷新当天日报（force：拿到最新同步的数据重出一份）
    try {
      const { ensureDailyReport } = await import('./services/report-generation.js');
      const r = await ensureDailyReport({ force: true });
      console.log(`[cron] 日报已刷新（${r.data?.period_key}）`);
    } catch (err) {
      console.error('[cron] 日报生成失败:', err.message);
    }
  });
  console.log('⏰ 定时同步+日报已注册：每天 08:10 / 20:10');
}).catch(err => console.error('node-cron 加载失败（定时同步不可用）:', err.message));
