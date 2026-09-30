import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { classifyFetchError, derivePlatformHealth, recordSourceFetchRun } from './source-health.js';

const NOW = new Date('2026-09-29T12:00:00Z').getTime();

test('空更新与失败严格分开，连续失败可见', () => {
  const empty = { status: 'empty', item_count: 0, finished_at: '2026-09-29T11:00:00Z', duration_ms: 100 };
  assert.equal(derivePlatformHealth({ trackMode: 'active-rss', latest: empty, recentRuns: [empty], now: NOW }).status, 'empty');

  const failures = [
    { status: 'failure', finished_at: '2026-09-29T11:00:00Z', error_kind: 'timeout', error_message: 'timeout' },
    { status: 'failure', finished_at: '2026-09-28T11:00:00Z', error_kind: 'timeout', error_message: 'timeout' },
    { status: 'success', finished_at: '2026-09-27T11:00:00Z', item_count: 2 },
  ];
  const health = derivePlatformHealth({ trackMode: 'active-rss', latest: failures[0], recentRuns: failures, now: NOW });
  assert.equal(health.status, 'failure');
  assert.equal(health.consecutiveFailures, 2);
  assert.equal(health.lastSuccessAt, '2026-09-27T11:00:00Z');
});

test('超过 72 小时未检查显示 stale；link-only 不伪装成失败', () => {
  const old = { status: 'success', item_count: 1, finished_at: '2026-09-25T11:00:00Z' };
  assert.equal(derivePlatformHealth({ trackMode: 'active-query', latest: old, recentRuns: [old], now: NOW }).status, 'stale');
  assert.equal(derivePlatformHealth({ trackMode: 'link-only', now: NOW }).status, 'unsupported');
});

test('错误类型可区分超时、限流、鉴权和网络', () => {
  assert.equal(classifyFetchError('AbortError: timeout'), 'timeout');
  assert.equal(classifyFetchError('HTTP 429'), 'rate_limit');
  assert.equal(classifyFetchError('HTTP 403'), 'auth');
  assert.equal(classifyFetchError('getaddrinfo ENOTFOUND'), 'network');
});

test('运行事实持久化到独立账本', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'kw-source-health-')), 'health.db');
  const setup = new DatabaseSync(dbPath);
  setup.exec(`
    CREATE TABLE sources (id TEXT PRIMARY KEY);
    CREATE TABLE source_platforms (id INTEGER PRIMARY KEY, source_id TEXT);
    INSERT INTO sources(id) VALUES ('s1');
    INSERT INTO source_platforms(id, source_id) VALUES (1, 's1');
  `);
  setup.close();
  const openDatabase = () => new DatabaseSync(dbPath);
  assert.equal(recordSourceFetchRun({
    sourceId: 's1', sourcePlatformId: 1, channel: 'rss', status: 'failure',
    startedAt: '2026-09-29T11:00:00Z', finishedAt: '2026-09-29T11:00:01Z',
    durationMs: 1000, error: 'HTTP 429',
  }, { openDatabase }), true);
  const verify = openDatabase();
  const row = verify.prepare('SELECT status, error_kind, duration_ms FROM source_fetch_runs').get();
  verify.close();
  assert.equal(row.status, 'failure');
  assert.equal(row.error_kind, 'rate_limit');
  assert.equal(row.duration_ms, 1000);
});
