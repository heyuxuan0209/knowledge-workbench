import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  beginLlmReceipt,
  classifyLlmError,
  completeLlmReceipt,
  failLlmReceipt,
  fingerprintMessages,
  getLlmCallReceipt,
  getLlmCallReport,
  listLlmCallReceipts,
  markLlmReceiptDispatched,
  normalizeLlmContexts,
  reviewLlmCallReceipt,
} from './llm-receipts.js';

function setup() {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'kw-llm-receipts-')), 'receipts.db');
  return {
    dbPath,
    controls: { openDatabase: () => new DatabaseSync(dbPath) },
  };
}

test('receipt stores accounting metadata without prompt or response text', () => {
  const { dbPath, controls } = setup();
  const messages = [{ role: 'user', content: '这是私密 prompt' }];
  const receipt = beginLlmReceipt({
    messages,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    purpose: 'translation',
    background: true,
    contexts: [{ kind: 'content', id: 'story-1', label: '私密文章标题', url: 'https://example.com/story', target: 'zh_summary' }],
    startedAt: '2026-09-30T08:00:00.000Z',
  }, controls);

  assert.ok(receipt.id);
  assert.equal(completeLlmReceipt(receipt, {
    providerRequestId: 'req-1',
    outputChars: 12,
    inputTokens: 20,
    outputTokens: 8,
    totalTokens: 28,
    tokenSource: 'provider',
    costYuanEstimate: 0.000084,
    finishedAt: '2026-09-30T08:00:01.250Z',
  }, controls), true);

  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT * FROM llm_call_receipts WHERE id=?').get(receipt.id);
  const columns = db.prepare('PRAGMA table_info(llm_call_receipts)').all().map(column => column.name);
  db.exec('CREATE TABLE contents (id TEXT PRIMARY KEY, en_title TEXT, zh_title TEXT, en_summary TEXT, zh_summary TEXT, zh_body TEXT, url TEXT)');
  db.prepare('INSERT INTO contents (id, en_summary, zh_summary, url) VALUES (?, ?, ?, ?)').run('story-1', 'English summary', '已经落库的中文摘要', 'https://example.com/story');
  db.close();

  assert.equal(row.status, 'succeeded');
  assert.equal(row.duration_ms, 1250);
  assert.equal(row.request_fingerprint, fingerprintMessages(messages));
  assert.equal(row.total_tokens, 28);
  assert.equal(columns.includes('prompt'), false);
  assert.equal(columns.includes('response'), false);
  assert.equal(JSON.stringify(row).includes('这是私密 prompt'), false);
  const detail = getLlmCallReceipt(receipt.id, controls);
  assert.deepEqual(detail.contexts, [{
    kind: 'content', id: 'story-1', label: '私密文章标题', url: 'https://example.com/story', target: 'zh_summary',
    result_present: true, result_preview: '已经落库的中文摘要',
  }]);
});

test('business contexts are bounded and contain references rather than content bodies', () => {
  const contexts = normalizeLlmContexts([
    { kind: 'content', id: 42, title: 'A'.repeat(300), url: 'https://example.com/a' },
    ...Array.from({ length: 60 }, (_, index) => ({ id: index, label: `item-${index}` })),
  ]);
  assert.equal(contexts.length, 50);
  assert.equal(contexts[0].id, '42');
  assert.equal(contexts[0].label.length, 240);
  assert.equal(Object.hasOwn(contexts[0], 'body'), false);
});

test('an English fallback copied into zh_title is not mistaken for a completed translation', () => {
  const { dbPath, controls } = setup();
  const receipt = beginLlmReceipt({
    messages: [], provider: 'deepseek', model: 'deepseek', purpose: 'translation',
    contexts: [{ kind: 'content', id: 'story-2', label: 'English title', target: 'zh_title' }],
  }, controls);
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE contents (id TEXT PRIMARY KEY, en_title TEXT, zh_title TEXT, en_summary TEXT, zh_summary TEXT, zh_body TEXT, url TEXT)');
  db.prepare('INSERT INTO contents (id, en_title, zh_title) VALUES (?, ?, ?)').run('story-2', 'English title', 'English title');
  db.close();

  const detail = getLlmCallReceipt(receipt.id, controls);
  assert.equal(detail.contexts[0].result_present, false);
  assert.equal(detail.contexts[0].result_preview, null);
});

test('failures distinguish provider rejection, budget block, and uncertain transport outcome', () => {
  assert.deepEqual(classifyLlmError(new Error('HTTP 402 insufficient balance'), { dispatched: true }), {
    status: 'failed', kind: 'provider_rejected',
  });
  assert.deepEqual(classifyLlmError(new Error('当日调用已达上限 200'), { dispatched: false }), {
    status: 'blocked', kind: 'budget',
  });
  assert.deepEqual(classifyLlmError(new Error('socket disconnected'), { dispatched: true }), {
    status: 'unknown', kind: 'transport',
  });
});

test('receipt failure cannot break the business call when its database is unavailable', () => {
  const unavailable = { openDatabase: () => { throw new Error('disk unavailable'); } };
  assert.equal(beginLlmReceipt({
    messages: [{ role: 'user', content: 'hello' }], provider: 'qwen', model: 'qwen', purpose: 'test',
  }, unavailable), null);
});

test('report aggregates today by purpose and keeps recent problem evidence', () => {
  const { dbPath, controls } = setup();
  const success = beginLlmReceipt({
    messages: [{ role: 'user', content: 'a' }], provider: 'qwen', model: 'qwen3.5-flash',
    purpose: 'feed-summary', startedAt: '2026-09-30T18:00:00.000Z',
  }, controls);
  completeLlmReceipt(success, {
    totalTokens: 100, tokenSource: 'provider', costYuanEstimate: 0.01,
    finishedAt: '2026-09-30T18:00:01.000Z',
  }, controls);

  const uncertain = beginLlmReceipt({
    messages: [{ role: 'user', content: 'b' }], provider: 'deepseek', model: 'deepseek-v4-flash',
    purpose: 'translation', startedAt: '2026-09-30T19:00:00.000Z',
  }, controls);
  markLlmReceiptDispatched(uncertain, { dispatchedAt: '2026-09-30T19:00:00.100Z' }, controls);
  failLlmReceipt(uncertain, new Error('network timeout'), {
    dispatched: true, finishedAt: '2026-09-30T19:00:03.000Z',
  }, controls);

  const report = getLlmCallReport({
    days: 30, limit: 10, now: new Date('2026-09-30T20:00:00.000Z'),
  }, controls);
  const db = new DatabaseSync(dbPath);
  const uncertainRow = db.prepare('SELECT status, error_kind FROM llm_call_receipts WHERE id=?').get(uncertain.id);
  db.close();

  assert.equal(report.today.calls, 2);
  assert.equal(report.today.succeeded, 1);
  assert.equal(report.today.unknown, 1);
  assert.equal(report.today.total_tokens, 100);
  assert.equal(report.byPurpose.length, 2);
  assert.equal(report.recent.length, 1);
  assert.equal(report.recent[0].context_count, 0);
  assert.deepEqual({ ...uncertainRow }, { status: 'unknown', error_kind: 'transport' });
});

test('an abnormal receipt can be reviewed and reopened without changing accounting facts', () => {
  const { controls } = setup();
  const receipt = beginLlmReceipt({
    messages: [], provider: 'deepseek', model: 'deepseek', purpose: 'translation',
    startedAt: '2026-09-30T18:00:00.000Z',
  }, controls);
  failLlmReceipt(receipt, new Error('HTTP 402 insufficient balance'), {
    dispatched: true, finishedAt: '2026-09-30T18:00:01.000Z',
  }, controls);

  const reviewed = reviewLlmCallReceipt(receipt.id, {
    reviewed: true, note: '已确认余额问题', reviewedAt: '2026-09-30T18:05:00.000Z',
  }, controls);
  assert.equal(reviewed.reviewed_at, '2026-09-30T18:05:00.000Z');
  assert.equal(reviewed.review_note, '已确认余额问题');
  assert.equal(reviewed.status, 'failed');

  const reopened = reviewLlmCallReceipt(receipt.id, { reviewed: false }, controls);
  assert.equal(reopened.reviewed_at, null);
  assert.equal(reopened.review_note, null);
  assert.equal(reopened.status, 'failed');
});

test('anomaly list supports complete status, purpose, scope, and pagination filters', () => {
  const { controls } = setup();
  const createFailure = ({ purpose, startedAt, message, dispatched = true }) => {
    const receipt = beginLlmReceipt({
      messages: [], provider: 'deepseek', model: 'deepseek', purpose, startedAt,
      contexts: [{ kind: 'content', id: `${purpose}-${startedAt}`, label: purpose }],
    }, controls);
    failLlmReceipt(receipt, new Error(message), {
      dispatched, finishedAt: new Date(new Date(startedAt).getTime() + 1000).toISOString(),
    }, controls);
    return receipt;
  };
  createFailure({ purpose: 'translation', startedAt: '2026-09-30T18:00:00.000Z', message: 'HTTP 402 insufficient balance' });
  createFailure({ purpose: 'feed-summary', startedAt: '2026-09-30T19:00:00.000Z', message: 'network timeout' });
  createFailure({ purpose: 'feed-summary', startedAt: '2026-09-30T19:30:00.000Z', message: '当日调用已达上限', dispatched: false });
  createFailure({ purpose: 'translation', startedAt: '2026-08-01T18:00:00.000Z', message: 'HTTP 402 insufficient balance' });

  const now = new Date('2026-09-30T20:00:00.000Z');
  const all = listLlmCallReceipts({ now, scope: 'today', pageSize: 2 }, controls);
  assert.equal(all.total, 3);
  assert.equal(all.items.length, 2);
  assert.equal(all.pages, 2);
  assert.deepEqual(all.statusCounts, { blocked: 1, failed: 1, unknown: 1 });
  assert.deepEqual(all.purposes.map(row => [row.purpose, row.count]), [['feed-summary', 2], ['translation', 1]]);

  const failed = listLlmCallReceipts({ now, scope: 'today', status: 'failed' }, controls);
  assert.equal(failed.total, 1);
  assert.equal(failed.items[0].purpose, 'translation');

  const summaries = listLlmCallReceipts({ now, scope: 'today', purpose: 'feed-summary' }, controls);
  assert.equal(summaries.total, 2);
  assert.deepEqual(new Set(summaries.items.map(item => item.status)), new Set(['unknown', 'blocked']));

  const period = listLlmCallReceipts({ now, scope: '30d' }, controls);
  assert.equal(period.total, 3);
});

test('stale reserved receipts are reconciled after a process interruption', () => {
  const { dbPath, controls } = setup();
  const beforeDispatch = beginLlmReceipt({
    messages: [], provider: 'qwen', model: 'qwen', purpose: 'before-dispatch',
    startedAt: '2026-09-30T17:00:00.000Z',
  }, controls);
  const afterDispatch = beginLlmReceipt({
    messages: [], provider: 'deepseek', model: 'deepseek', purpose: 'after-dispatch',
    startedAt: '2026-09-30T17:01:00.000Z',
  }, controls);
  markLlmReceiptDispatched(afterDispatch, { dispatchedAt: '2026-09-30T17:01:00.100Z' }, controls);

  getLlmCallReport({ now: new Date('2026-09-30T18:00:00.000Z') }, controls);
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare('SELECT id, status, error_kind FROM llm_call_receipts ORDER BY started_at').all();
  db.close();

  assert.deepEqual(rows.map(row => ({ status: row.status, kind: row.error_kind })), [
    { status: 'failed', kind: 'process_interrupted' },
    { status: 'unknown', kind: 'process_interrupted' },
  ]);
  assert.equal(rows[0].id, beforeDispatch.id);
  assert.equal(rows[1].id, afterDispatch.id);
});
