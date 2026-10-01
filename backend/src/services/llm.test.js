import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { deepseekControls, inferCallPurpose, reserveBackgroundCall } from './llm.js';

test('Deepseek thinking is disabled unless a caller explicitly opts in', () => {
  assert.deepEqual(deepseekControls({ maxTokens: 1200 }), {
    thinking: { type: 'disabled' },
    max_tokens: 1200,
  });
  assert.deepEqual(deepseekControls({ thinking: true }), {
    thinking: { type: 'enabled' },
  });
});

test('background Deepseek and Qwen calls share the persisted daily limit', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'kw-llm-budget-')), 'budget.db');
  const init = new DatabaseSync(dbPath);
  init.exec('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
  init.close();
  const controls = { openDatabase: () => new DatabaseSync(dbPath), day: '2026-09-16', limit: 2 };

  assert.equal(reserveBackgroundCall('deepseek', { background: true }, controls), 1);
  assert.equal(reserveBackgroundCall('qwen', { background: true }, controls), 2);
  assert.throws(
    () => reserveBackgroundCall('deepseek', { background: true }, controls),
    /当日调用已达上限 2/,
  );
  assert.equal(reserveBackgroundCall('deepseek', { background: false }, controls), undefined);
});

test('call purpose is inferred from the first business service in the stack', () => {
  const stack = [
    'Error',
    '    at chat (/app/src/services/llm.js:100:20)',
    '    at translate (/app/src/services/translation.js:42:10)',
    '    at /app/src/server.js:10:2',
  ].join('\n');
  assert.equal(inferCallPurpose(stack), 'translation');
  assert.equal(inferCallPurpose('Error\n    at /app/src/server.js:10:2'), 'api-chat');
  assert.equal(inferCallPurpose('Error\n    at nowhere'), 'unspecified');
});

test('keyword extraction goes through the metered LLM gateway', () => {
  const source = readFileSync(new URL('./keyword-extractor.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ chat \} from '\.\/llm\.js'/);
  assert.doesNotMatch(source, /from ['"]openai|chat\.completions\.create/);
});
