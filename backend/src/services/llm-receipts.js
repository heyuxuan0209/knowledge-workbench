import { createHash, randomUUID } from 'node:crypto';
import { getDatabase } from '../db/init.js';
import { LLM_CALL_RECEIPTS_SCHEMA } from '../db/migrate-m31.js';

function ensureSchema(db) {
  db.exec(LLM_CALL_RECEIPTS_SCHEMA);
}

function withDb(openDatabase, fn, fallback = null) {
  let db;
  try {
    db = openDatabase();
    ensureSchema(db);
    return fn(db);
  } catch (error) {
    console.error('[llm-receipt] 写入失败:', error.message);
    return fallback;
  } finally {
    db?.close();
  }
}

export function fingerprintMessages(messages) {
  const normalized = (messages || []).map(message => `${message.role || ''}\n${message.content || ''}`).join('\n---\n');
  return createHash('sha256').update(normalized).digest('hex');
}

export function normalizeLlmContexts(contexts = []) {
  const values = Array.isArray(contexts) ? contexts : [contexts];
  return values.filter(Boolean).slice(0, 50).map(context => ({
    kind: String(context.kind || 'content').slice(0, 40),
    id: context.id == null ? null : String(context.id).slice(0, 160),
    label: String(context.label || context.title || '未命名内容').slice(0, 240),
    url: context.url ? String(context.url).slice(0, 1500) : null,
    target: context.target ? String(context.target).slice(0, 60) : null,
  }));
}

function parseContexts(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function enrichContexts(db, contexts) {
  const hasContents = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='contents'").get();
  if (!hasContents) return contexts;
  const findContent = db.prepare('SELECT id, en_title, zh_title, en_summary, zh_summary, zh_body, url FROM contents WHERE id=?');
  return contexts.map(context => {
    if (context.kind !== 'content' || !context.id) return context;
    const content = findContent.get(context.id);
    if (!content) return { ...context, result_present: false };
    const value = context.target === 'zh_title' ? content.zh_title
      : context.target === 'zh_summary' ? content.zh_summary
        : context.target === 'zh_body' ? content.zh_body
          : null;
    const original = context.target === 'zh_title' ? content.en_title
      : context.target === 'zh_summary' ? content.en_summary
        : null;
    const resultPresent = context.target && context.target !== 'relevance'
      ? Boolean(value) && (!original || String(value).trim() !== String(original).trim())
      : null;
    return {
      ...context,
      url: context.url || content.url || null,
      result_present: resultPresent,
      result_preview: resultPresent ? String(value).replace(/\s+/g, ' ').slice(0, 160) : null,
    };
  });
}

export function classifyLlmError(error, { dispatched = false } = {}) {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (/当日调用已达上限/.test(message) || /budget|quota guard/.test(lower)) {
    return { status: 'blocked', kind: 'budget' };
  }
  if (/\b40[01234]\b|insufficient balance|invalid request|content.?filter|rate.?limit|\b429\b/.test(lower)) {
    return { status: 'failed', kind: /429|rate.?limit/.test(lower) ? 'rate_limit' : 'provider_rejected' };
  }
  if (dispatched && /timeout|timed out|econnreset|econnrefused|enotfound|socket|network|connection|fetch failed|abort|disconnect/.test(lower)) {
    return { status: 'unknown', kind: 'transport' };
  }
  return { status: 'failed', kind: 'application' };
}

export function beginLlmReceipt({
  messages,
  provider,
  model,
  purpose,
  background = false,
  logicalKey = null,
  retryOf = null,
  contexts = [],
  startedAt = new Date().toISOString(),
}, { openDatabase = getDatabase } = {}) {
  const id = randomUUID();
  const inputChars = (messages || []).reduce((sum, message) => sum + String(message.content || '').length, 0);
  return withDb(openDatabase, db => {
    db.prepare(`
      INSERT INTO llm_call_receipts
        (id, logical_key, retry_of, provider, model, purpose, background, status, request_fingerprint, context_json, input_chars, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?)
    `).run(
      id, logicalKey, retryOf, provider, model, purpose, background ? 1 : 0,
      fingerprintMessages(messages), JSON.stringify(normalizeLlmContexts(contexts)), inputChars, startedAt,
    );
    return { id, startedAt };
  });
}

export function completeLlmReceipt(receipt, {
  providerRequestId = null,
  outputChars = 0,
  inputTokens = 0,
  outputTokens = 0,
  reasoningTokens = 0,
  totalTokens = 0,
  tokenSource = 'unknown',
  costYuanEstimate = 0,
  finishedAt = new Date().toISOString(),
}, { openDatabase = getDatabase } = {}) {
  if (!receipt?.id) return false;
  return withDb(openDatabase, db => db.prepare(`
    UPDATE llm_call_receipts SET
      status='succeeded', provider_request_id=?, output_chars=?, input_tokens=?, output_tokens=?, reasoning_tokens=?,
      total_tokens=?, token_source=?, cost_yuan_estimate=?, finished_at=?, duration_ms=?
    WHERE id=?
  `).run(
    providerRequestId,
    outputChars,
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    tokenSource,
    costYuanEstimate,
    finishedAt,
    Math.max(0, new Date(finishedAt).getTime() - new Date(receipt.startedAt).getTime()),
    receipt.id,
  ).changes > 0, false);
}

export function markLlmReceiptDispatched(receipt, {
  dispatchedAt = new Date().toISOString(),
} = {}, { openDatabase = getDatabase } = {}) {
  if (!receipt?.id) return false;
  return withDb(openDatabase, db => db.prepare(`
    UPDATE llm_call_receipts SET dispatched_at=? WHERE id=? AND status='reserved'
  `).run(dispatchedAt, receipt.id).changes > 0, false);
}

export function failLlmReceipt(receipt, error, { dispatched = false, finishedAt = new Date().toISOString() } = {}, { openDatabase = getDatabase } = {}) {
  if (!receipt?.id) return { status: 'failed', kind: 'receipt_missing' };
  const classified = classifyLlmError(error, { dispatched });
  withDb(openDatabase, db => db.prepare(`
    UPDATE llm_call_receipts SET status=?, error_kind=?, error_message=?, finished_at=?, duration_ms=? WHERE id=?
  `).run(
    classified.status,
    classified.kind,
    String(error?.message || error || '').slice(0, 500),
    finishedAt,
    Math.max(0, new Date(finishedAt).getTime() - new Date(receipt.startedAt).getTime()),
    receipt.id,
  ));
  return classified;
}

export function getLlmCallReceipt(id, { openDatabase = getDatabase } = {}) {
  return withDb(openDatabase, db => {
    const row = db.prepare(`
      SELECT id, logical_key, retry_of, provider, model, purpose, background, status,
             request_fingerprint, context_json, provider_request_id,
             input_chars, output_chars, input_tokens, output_tokens, reasoning_tokens, total_tokens,
             token_source, cost_yuan_estimate, error_kind, error_message,
             started_at, dispatched_at, finished_at, duration_ms, reviewed_at, review_note
      FROM llm_call_receipts WHERE id=?
    `).get(id);
    return row ? { ...row, contexts: enrichContexts(db, parseContexts(row.context_json)), context_json: undefined } : null;
  });
}

export function reviewLlmCallReceipt(id, {
  reviewed = true,
  note = null,
  reviewedAt = new Date().toISOString(),
} = {}, { openDatabase = getDatabase } = {}) {
  return withDb(openDatabase, db => {
    const result = db.prepare(`
      UPDATE llm_call_receipts SET reviewed_at=?, review_note=? WHERE id=?
    `).run(reviewed ? reviewedAt : null, reviewed ? String(note || '').slice(0, 500) || null : null, id);
    return result.changes > 0 ? getLlmCallReceiptFromDb(db, id) : null;
  });
}

function getLlmCallReceiptFromDb(db, id) {
  const row = db.prepare(`
    SELECT id, logical_key, retry_of, provider, model, purpose, background, status,
           request_fingerprint, context_json, provider_request_id,
           input_chars, output_chars, input_tokens, output_tokens, reasoning_tokens, total_tokens,
           token_source, cost_yuan_estimate, error_kind, error_message,
           started_at, dispatched_at, finished_at, duration_ms, reviewed_at, review_note
    FROM llm_call_receipts WHERE id=?
  `).get(id);
  return row ? { ...row, contexts: enrichContexts(db, parseContexts(row.context_json)), context_json: undefined } : null;
}

function aggregate(db, where, params) {
  return db.prepare(`
    SELECT COUNT(*) calls,
      SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) succeeded,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END) unknown,
      SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) blocked,
      SUM(CASE WHEN status='reserved' THEN 1 ELSE 0 END) reserved,
      COALESCE(SUM(total_tokens), 0) total_tokens,
      COALESCE(SUM(cost_yuan_estimate), 0) cost_yuan_estimate
    FROM llm_call_receipts WHERE ${where}
  `).get(...params);
}

function localDayRange(now) {
  const timezoneOffsetMinutes = -now.getTimezoneOffset();
  const localNow = new Date(now.getTime() + timezoneOffsetMinutes * 60_000);
  const localDay = localNow.toISOString().slice(0, 10);
  const startMs = new Date(`${localDay}T00:00:00.000Z`).getTime() - timezoneOffsetMinutes * 60_000;
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 864e5).toISOString() };
}

function reconcileStaleReceipts(db, now) {
  const staleBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
  db.prepare(`
    UPDATE llm_call_receipts SET
      status=CASE WHEN dispatched_at IS NULL THEN 'failed' ELSE 'unknown' END,
      error_kind='process_interrupted',
      error_message=CASE WHEN dispatched_at IS NULL
        THEN '调用凭证已创建，但请求未发出前进程中断'
        ELSE '请求发出后进程中断，供应商是否完成未知'
      END,
      finished_at=?, duration_ms=MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER))
    WHERE status='reserved' AND started_at<?
  `).run(now.toISOString(), now.toISOString(), staleBefore);
}

function summarizeReceiptRows(rows) {
  return rows.map(row => {
    const contexts = parseContexts(row.context_json);
    const { context_json, ...summary } = row;
    return { ...summary, context_count: contexts.length, context_preview: contexts.slice(0, 2) };
  });
}

export function listLlmCallReceipts({
  scope = 'today',
  status = 'all',
  purpose = null,
  page = 1,
  pageSize = 20,
  now = new Date(),
} = {}, { openDatabase = getDatabase } = {}) {
  return withDb(openDatabase, db => {
    reconcileStaleReceipts(db, now);
    const allowedStatuses = new Set(['failed', 'unknown', 'blocked', 'reserved']);
    const safeStatus = allowedStatuses.has(status) ? status : 'all';
    const safeScope = scope === '30d' ? '30d' : 'today';
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.max(1, Math.min(100, Number(pageSize) || 20));
    const range = safeScope === 'today'
      ? localDayRange(now)
      : { start: new Date(now.getTime() - 30 * 864e5).toISOString(), end: now.toISOString() };

    const baseClauses = ['started_at>=?', 'started_at<?', "status IN ('failed','unknown','blocked','reserved')"];
    const baseParams = [range.start, range.end];
    if (purpose) {
      baseClauses.push('purpose=?');
      baseParams.push(String(purpose).slice(0, 100));
    }
    const itemClauses = [...baseClauses];
    const itemParams = [...baseParams];
    if (safeStatus !== 'all') {
      itemClauses.push('status=?');
      itemParams.push(safeStatus);
    }

    const where = itemClauses.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) count FROM llm_call_receipts WHERE ${where}`).get(...itemParams).count;
    const rows = db.prepare(`
      SELECT id, purpose, provider, model, status, total_tokens, cost_yuan_estimate,
             error_kind, error_message, started_at, duration_ms, retry_of, reviewed_at, context_json
      FROM llm_call_receipts WHERE ${where}
      ORDER BY started_at DESC LIMIT ? OFFSET ?
    `).all(...itemParams, safePageSize, (safePage - 1) * safePageSize);
    const statusCounts = Object.fromEntries(db.prepare(`
      SELECT status, COUNT(*) count FROM llm_call_receipts
      WHERE ${baseClauses.join(' AND ')} GROUP BY status
    `).all(...baseParams).map(row => [row.status, row.count]));
    const purposes = db.prepare(`
      SELECT purpose, COUNT(*) count FROM llm_call_receipts
      WHERE started_at>=? AND started_at<? AND status IN ('failed','unknown','blocked','reserved')
      GROUP BY purpose ORDER BY count DESC, purpose
    `).all(range.start, range.end);

    return {
      items: summarizeReceiptRows(rows),
      total,
      page: safePage,
      pageSize: safePageSize,
      pages: Math.max(1, Math.ceil(total / safePageSize)),
      scope: safeScope,
      status: safeStatus,
      purpose: purpose || null,
      statusCounts,
      purposes,
    };
  }, { items: [], total: 0, page: 1, pageSize: 20, pages: 1, statusCounts: {}, purposes: [] });
}

export function getLlmCallReport({ days = 30, limit = 20, now = new Date() } = {}, { openDatabase = getDatabase } = {}) {
  return withDb(openDatabase, db => {
    reconcileStaleReceipts(db, now);
    const dayRange = localDayRange(now);
    const since = new Date(now.getTime() - Math.max(1, days) * 864e5).toISOString();
    const todayStats = aggregate(db, 'started_at>=? AND started_at<?', [dayRange.start, dayRange.end]);
    const periodStats = aggregate(db, 'started_at>=?', [since]);
    const byPurpose = db.prepare(`
      SELECT purpose, COUNT(*) calls,
        SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) succeeded,
        SUM(CASE WHEN status IN ('failed','unknown') THEN 1 ELSE 0 END) problems,
        COALESCE(SUM(total_tokens), 0) total_tokens,
        COALESCE(SUM(cost_yuan_estimate), 0) cost_yuan_estimate
      FROM llm_call_receipts WHERE started_at>=? AND started_at<?
      GROUP BY purpose ORDER BY cost_yuan_estimate DESC, calls DESC
    `).all(dayRange.start, dayRange.end);
    const recent = db.prepare(`
      SELECT id, purpose, provider, model, status, total_tokens, cost_yuan_estimate,
             error_kind, error_message, started_at, duration_ms, retry_of, reviewed_at, context_json
      FROM llm_call_receipts
      WHERE status!='succeeded'
      ORDER BY started_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(100, limit)));
    return {
      today: todayStats,
      period: { days, ...periodStats },
      byPurpose,
      recent: summarizeReceiptRows(recent),
    };
  }, { today: {}, period: { days }, byPurpose: [], recent: [] });
}
