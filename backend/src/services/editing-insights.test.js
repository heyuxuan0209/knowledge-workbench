import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('同平台跨三篇的重复编辑才生成候选，确认后进入生成偏好', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kw-editing-insights-test-'));
  process.env.DB_PATH = join(dir, 'app.db');
  try {
    const db = new DatabaseSync(process.env.DB_PATH);
    db.exec(`
      CREATE TABLE content_works (id TEXT PRIMARY KEY, title TEXT);
      CREATE TABLE artifact_releases (
        id TEXT PRIMARY KEY, work_id TEXT NOT NULL, sequence INTEGER NOT NULL, title TEXT,
        content_snapshot TEXT, metadata_json TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    for (let i = 1; i <= 3; i += 1) {
      db.prepare('INSERT INTO content_works (id, title) VALUES (?, ?)').run(`w${i}`, `作品${i}`);
      db.prepare('INSERT INTO artifact_releases (id, work_id, sequence, title, content_snapshot, metadata_json) VALUES (?, ?, 1, ?, ?, ?)').run(`a${i}`, `w${i}`, '标题', '大家好，今天我们来聊一个问题。\n\n正文', '{"platform":"gzh-long"}');
      db.prepare('INSERT INTO artifact_releases (id, work_id, sequence, title, content_snapshot, metadata_json) VALUES (?, ?, 2, ?, ?, ?)').run(`b${i}`, `w${i}`, '标题', '正文直接开始。', '{"platform":"gzh-long"}');
    }
    db.close();
    const { migrateM34 } = await import('../db/migrate-m34.js'); migrateM34();
    const { analyzeEditPair, updatePreferenceCandidate, confirmedPreferenceBlock } = await import('./editing-insights.js');
    const analyzer = async () => ({ observations: [{ preferenceKey: 'avoid_generic_opening', summary: '删除泛泛的开场', suggestedRule: '正文直接进入具体问题，不写泛泛开场', evidence: ['大家好，今天我们来聊', '正文直接开始'] }], cost: 0 });
    for (let i = 1; i <= 2; i += 1) {
      const result = await analyzeEditPair({ workId: `w${i}`, fromReleaseId: `a${i}`, toReleaseId: `b${i}`, analyzer });
      assert.equal(result.candidates.length, 0);
    }
    const third = await analyzeEditPair({ workId: 'w3', fromReleaseId: 'a3', toReleaseId: 'b3', analyzer });
    assert.equal(third.candidates.length, 1);
    assert.equal(third.candidates[0].distinct_work_count, 3);
    updatePreferenceCandidate(third.candidates[0].id, { status: 'confirmed' });
    assert.match(confirmedPreferenceBlock('gzh-long'), /正文直接进入具体问题/);
    const repeated = await analyzeEditPair({ workId: 'w3', fromReleaseId: 'a3', toReleaseId: 'b3', analyzer });
    assert.equal(repeated.action, 'unchanged');
    assert.equal(repeated.candidates[0].status, 'confirmed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
