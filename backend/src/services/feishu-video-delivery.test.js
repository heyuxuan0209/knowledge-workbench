import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoCard, buildVideoDocument, deliverVideoDigest } from './feishu-video-delivery.js';

const URL = 'https://www.youtube.com/watch?v=7xTGNNLPyMI';
const DOC_URL = 'https://example.feishu.cn/docx/test-token';

test('视频卡片是 interactive，且同时保留原视频和完整文档入口', () => {
  const card = buildVideoCard({
    title: '三小时视频解读',
    interpretation: '【摘要】\n这是摘要。\n\n【要点】\n- 要点一',
    sourceUrl: URL,
    docUrl: DOC_URL,
    outline: ['00:00–01:00:00', '01:00:00–02:00:00'],
  });
  const serialized = JSON.stringify(card);
  assert.equal(card.msg_type, 'interactive');
  assert.equal(card.card.header.template, 'blue');
  assert.match(serialized, /打开完整解读/);
  assert.match(serialized, /看原视频/);
  assert.match(serialized, /7xTGNNLPyMI/);
  assert.match(serialized, /test-token/);
});

test('完整文档同时包含卡片解读、全片精读和逐段全文中译', () => {
  const markdown = buildVideoDocument({
    title: '测试视频',
    metadata: { author: '作者', platform: 'YouTube', publishedAt: '2026-09-30' },
    sourceUrl: URL,
    interpretation: '【摘要】\n卡片层',
    deepRead: '## 00:00–01:30:00\n前半段\n\n## 01:30:00–03:00:00\n后半段',
    transcriptLabel: '逐段全文中译',
    transcriptText: '### 00:00–01:00:00\n译文一\n\n### 02:00:00–03:00:00\n译文尾段',
    coverageNote: '已按时间顺序覆盖全片，共 2 段',
  });
  assert.match(markdown, /## 卡片解读/);
  assert.match(markdown, /## 全片精读/);
  assert.match(markdown, /## 逐段全文中译/);
  assert.match(markdown, /译文尾段/);
  assert.match(markdown, /7xTGNNLPyMI/);
});

test('同一视频重复发送复用已有飞书文档，不重复建档', async () => {
  const oldWebhook = process.env.FEISHU_VIDEO_WEBHOOK;
  const oldSecret = process.env.FEISHU_VIDEO_WEBHOOK_SECRET;
  process.env.FEISHU_VIDEO_WEBHOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/test';
  process.env.FEISHU_VIDEO_WEBHOOK_SECRET = 'test-secret';

  let record = null;
  let createCalls = 0;
  let updateCalls = 0;
  let sendCalls = 0;
  const normalizePatch = (patch) => ({
    source_hash: patch.sourceHash,
    translated_body: patch.translatedBody,
    translation_status: patch.translationStatus,
    doc_token: patch.docToken,
    doc_url: patch.docUrl,
    document_hash: patch.documentHash,
  });
  const deps = {
    getIngestCache: () => ({
      type: 'youtube',
      title: 'Original title',
      zhTitle: '中文标题',
      originalLang: 'en',
      zhBody: '## 00:00–01:30:00\n前半段\n\n## 01:30:00–03:00:00\n后半段',
      metadata: { platform: 'YouTube', author: 'Channel', sourceUrl: URL, durationSeconds: 10800 },
      coverage: { mode: 'full-transcript-map-reduce', sectionCount: 2 },
    }),
    getIngestSource: () => ({
      body: 'first source sentence. final source sentence.',
      transcript: [
        { text: 'first source sentence.', offset: 0, duration: 5_400_000 },
        { text: 'final source sentence.', offset: 5_400_000, duration: 5_400_000 },
      ],
    }),
    setIngestSource: () => {},
    getVideoDelivery: () => record,
    saveVideoDelivery: (_url, patch) => {
      record = { ...(record || {}), ...Object.fromEntries(
        Object.entries(normalizePatch(patch)).filter(([, value]) => value !== undefined),
      ) };
      return record;
    },
    translateText: async (text) => `中译：${text}`,
    createDocFromMarkdown: async ({ markdown }) => {
      createCalls += 1;
      assert.match(markdown, /final source sentence/);
      return { url: DOC_URL, token: 'doc-token' };
    },
    updateDocFromMarkdown: async () => { updateCalls += 1; },
    fetch: async (_url, options) => {
      sendCalls += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.msg_type, 'interactive');
      assert.ok(body.sign);
      return { status: 200, json: async () => ({ code: 0 }) };
    },
    ingest: async () => { throw new Error('不应重新摄入'); },
  };

  try {
    const input = { url: URL, title: '中文标题', interpretation: '【摘要】\n完整解读' };
    const first = await deliverVideoDigest(input, deps);
    const second = await deliverVideoDigest(input, deps);
    assert.equal(first.cardSent, true);
    assert.equal(second.cardSent, true);
    assert.equal(createCalls, 1);
    assert.equal(updateCalls, 0);
    assert.equal(sendCalls, 2);
  } finally {
    if (oldWebhook === undefined) delete process.env.FEISHU_VIDEO_WEBHOOK;
    else process.env.FEISHU_VIDEO_WEBHOOK = oldWebhook;
    if (oldSecret === undefined) delete process.env.FEISHU_VIDEO_WEBHOOK_SECRET;
    else process.env.FEISHU_VIDEO_WEBHOOK_SECRET = oldSecret;
  }
});

test('全文中译失败时明示降级，仍保留原文转写且不改发笔记助手', async () => {
  const oldWebhook = process.env.FEISHU_VIDEO_WEBHOOK;
  process.env.FEISHU_VIDEO_WEBHOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/test';
  let document = '';
  let cardBody = '';
  const deps = {
    getIngestCache: () => ({
      type: 'video', originalLang: 'en', zhBody: '全片精读', metadata: { platform: 'X' },
    }),
    getIngestSource: () => ({ body: 'complete original transcript', transcript: [] }),
    setIngestSource: () => {},
    getVideoDelivery: () => null,
    saveVideoDelivery: (_url, patch) => ({
      source_hash: patch.sourceHash,
      translated_body: patch.translatedBody,
      translation_status: patch.translationStatus,
      doc_token: patch.docToken,
      doc_url: patch.docUrl,
      document_hash: patch.documentHash,
    }),
    translateText: async () => { throw new Error('模型暂时不可用'); },
    createDocFromMarkdown: async ({ markdown }) => {
      document = markdown;
      return { url: DOC_URL, token: 'doc-token' };
    },
    updateDocFromMarkdown: async () => {},
    fetch: async (_url, options) => {
      cardBody = options.body;
      return { status: 200, json: async () => ({ code: 0 }) };
    },
    ingest: async () => { throw new Error('不应重新摄入'); },
  };
  try {
    const result = await deliverVideoDigest({
      url: 'https://x.com/user/status/123', title: 'X 视频', interpretation: '【摘要】\n测试',
    }, deps);
    assert.equal(result.translationStatus, 'translation-failed');
    assert.match(document, /全文中译生成失败/);
    assert.match(document, /complete original transcript/);
    assert.match(cardBody, /全文中译生成失败/);
  } finally {
    if (oldWebhook === undefined) delete process.env.FEISHU_VIDEO_WEBHOOK;
    else process.env.FEISHU_VIDEO_WEBHOOK = oldWebhook;
  }
});

