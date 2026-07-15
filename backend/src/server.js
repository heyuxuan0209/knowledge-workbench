import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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

    const contents = getContents(limit, offset);

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

// Mode 1 即兴分析对话（SSE 流式）。无状态设计：不落库，前端每次请求带上完整 messages
// 历史；材料来自 contentIds（已入库的 Feed 内容）和/或 adHocContents（用户临时粘贴、
// 已经过 /api/content/ingest 摄入+翻译的结果，未入库）。两者可同时存在。
app.post('/api/chat/ephemeral', async (req, res) => {
  try {
    const { contentIds = [], adHocContents = [], messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'messages is required and must be a non-empty array'
      });
    }
    if (contentIds.length === 0 && adHocContents.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'at least one of contentIds or adHocContents is required'
      });
    }

    const { buildMessagesWithContext } = await import('./services/ephemeral-chat.js');
    const { messages: contextInjectedMessages, degraded } = await buildMessagesWithContext(contentIds, adHocContents, messages);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 开流前先发降级清单（哪些材料只拿到摘要）——前端据此显示黄色降级条（诚实承诺，决策5）
    res.write(`data: ${JSON.stringify({ type: 'meta', degraded })}\n\n`);

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
      SELECT id, zh_title, zh_summary, en_title, url, external_score, tags, published_at
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
    const result = rebuildStories(parseInt(req.body?.days) || 7);
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

// 创作助手指令改写：把左侧草稿 + 用户指令交给 Deepseek，返回改写后的整稿。
// 不落库（Draft 实体是 M4），前端直接替换草稿区内容。
app.post('/api/studio/rewrite', async (req, res) => {
  try {
    const { draft, instruction, platform = 'thread' } = req.body;
    if (!draft?.trim() || !instruction?.trim()) {
      return res.status(400).json({ success: false, error: 'draft and instruction are required' });
    }
    const platformNote = { thread: 'X thread（分条、短句）', long: '公众号长文（Markdown）', script: '口播视频脚本（口语化、有钩子）' }[platform] || '';
    const { chat } = await import('./services/llm.js');
    const result = await chat([{
      role: 'user',
      content: `你是内容创作助手。以下是一份${platformNote}草稿，请严格按用户指令改写。\n只输出改写后的完整草稿，不要解释，保留原有的 [素材N] / 引用溯源标记。\n\n# 用户指令\n${instruction}\n\n# 草稿\n${draft.slice(0, 8000)}`,
    }]);
    if (!result.success) throw new Error(result.error);
    res.json({ success: true, data: { draft: result.content.trim(), note: `已按「${instruction}」改写草稿（¥${result.cost?.toFixed(4)}）`, cost: result.cost } });
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

// 选题状态流转：suggested → adopted（采纳）/ dismissed（忽略）/ created（已创作）
app.patch('/api/ideas/:id', async (req, res) => {
  try {
    const { updateIdeaStatus } = await import('./services/report-generation.js');
    const done = updateIdeaStatus(req.params.id, req.body?.status);
    res.json({ success: done, message: done ? 'Idea updated' : 'Idea not found' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
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
    res.json({ success: true, data: createTopic({ name, description }) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
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
    res.json({ success: true, data: createTopicFromIdea(ideaId) });
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
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    res.json({ success: true, data: getNotes(limit, offset) });
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

    // M3 同化前置：保存即自动匹配活跃 Topic（本地 TF 余弦，零 LLM 成本），
    // 命中的挂 pending 待并入；匹配失败不影响保存
    let matchedTopics = [];
    try {
      const { matchNoteToTopics } = await import('./services/topic-pages.js');
      matchedTopics = matchNoteToTopics(note.id);
    } catch (err) {
      console.error('[Notes] topic match failed:', err.message);
    }

    res.json({ success: true, data: note, matchedTopics });
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
});
