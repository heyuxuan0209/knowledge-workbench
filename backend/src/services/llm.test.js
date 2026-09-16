import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepseekControls, reserveBackgroundCall } from './llm.js';

test('Deepseek thinking is disabled unless a caller explicitly opts in', () => {
  assert.deepEqual(deepseekControls({ maxTokens: 1200 }), {
    thinking: { type: 'disabled' },
    max_tokens: 1200,
  });
  assert.deepEqual(deepseekControls({ thinking: true }), {
    thinking: { type: 'enabled' },
  });
});

test('background Deepseek calls are persisted and hard-stopped at the daily limit', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'kw-llm-budget-')), 'budget.db');
  const init = new DatabaseSync(dbPath);
  init.exec('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
  init.close();
  const controls = { openDatabase: () => new DatabaseSync(dbPath), day: '2026-09-16', limit: 2 };

  assert.equal(reserveBackgroundCall('deepseek', { background: true }, controls), 1);
  assert.equal(reserveBackgroundCall('deepseek', { background: true }, controls), 2);
  assert.throws(
    () => reserveBackgroundCall('deepseek', { background: true }, controls),
    /当日调用已达上限 2/,
  );
  assert.equal(reserveBackgroundCall('deepseek', { background: false }, controls), undefined);
});
