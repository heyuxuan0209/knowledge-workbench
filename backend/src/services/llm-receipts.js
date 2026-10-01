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
  startedAt = new Date().toISOString(),
}, { openDatabase = getDatabase } = {}) {
  const id = randomUUID();
  const inputChars = (messages || []).reduce((sum, message) => sum + String(message.content || '').length, 0);
  return withDb(openDatabase, db => {
    db.prepare(`
      INSERT INTO llm_call_receipts
        (id, logical_key, retry_of, provider, model, purpose, background, status, request_fingerprint, input_chars, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)
    `).run(id, logicalKey, retryOf, provider, model, purpose, background ? 1 : 0, fingerprintMessages(messages), inputChars, startedAt);
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

function aggregate(db, where, params) {
  return db.prepare(`
    SELECT COUNT(*) calls,
      SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) succeeded,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END) unknown,
      SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) blocked,
      COALESCE(SUM(total_tokens), 0) total_tokens,
      COALESCE(SUM(cost_yuan_estimate), 0) cost_yuan_estimate
    FROM llm_call_receipts WHERE ${where}
  `).get(...params);
}

export function getLlmCallReport({ days = 30, limit = 20, now = new Date() } = {}, { openDatabase = getDatabase } = {}) {
  return withDb(openDatabase, db => {
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
    const timezoneOffsetMinutes = -now.getTimezoneOffset();
    const localNow = new Date(now.getTime() + timezoneOffsetMinutes * 60_000);
    const localDay = localNow.toISOString().slice(0, 10);
    const dayStart = new Date(`${localDay}T00:00:00.000Z`).getTime() - timezoneOffsetMinutes * 60_000;
    const dayEnd = dayStart + 864e5;
    const since = new Date(now.getTime() - Math.max(1, days) * 864e5).toISOString();
    const todayStats = aggregate(db, 'started_at>=? AND started_at<?', [new Date(dayStart).toISOString(), new Date(dayEnd).toISOString()]);
    const periodStats = aggregate(db, 'started_at>=?', [since]);
    const byPurpose = db.prepare(`
      SELECT purpose, COUNT(*) calls,
        SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) succeeded,
        SUM(CASE WHEN status IN ('failed','unknown') THEN 1 ELSE 0 END) problems,
        COALESCE(SUM(total_tokens), 0) total_tokens,
        COALESCE(SUM(cost_yuan_estimate), 0) cost_yuan_estimate
      FROM llm_call_receipts WHERE started_at>=? AND started_at<?
      GROUP BY purpose ORDER BY cost_yuan_estimate DESC, calls DESC
    `).all(new Date(dayStart).toISOString(), new Date(dayEnd).toISOString());
    const recent = db.prepare(`
      SELECT id, purpose, provider, model, status, total_tokens, cost_yuan_estimate,
             error_kind, error_message, started_at, duration_ms, retry_of
      FROM llm_call_receipts ORDER BY started_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(100, limit)));
    return { today: todayStats, period: { days, ...periodStats }, byPurpose, recent };
  }, { today: {}, period: { days }, byPurpose: [], recent: [] });
}
