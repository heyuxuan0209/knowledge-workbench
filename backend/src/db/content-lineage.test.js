import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('内容血缘：旧稿推断回填，新稿关键版本幂等且可跨工具接续', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kw-lineage-test-'));
  process.env.DB_PATH = join(dir, 'app.db');
  try {
    const db = new DatabaseSync(process.env.DB_PATH);
    db.exec(`
      CREATE TABLE drafts (
        id TEXT PRIMARY KEY, platform TEXT NOT NULL, title TEXT, body TEXT NOT NULL DEFAULT '',
        paragraph_refs TEXT DEFAULT '[]', source_kind TEXT, source_id TEXT, source_label TEXT,
        status TEXT DEFAULT 'draft', tokens INTEGER DEFAULT 0, cost_yuan REAL DEFAULT 0,
        feishu_doc_token TEXT, feishu_url TEXT, feishu_hash TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO drafts (id, platform, title, body, paragraph_refs, source_kind, source_id)
      VALUES ('old-draft', 'gzh-long', '旧稿', '旧正文', '[{"noteId":"note-1"}]', 'topic', 'topic-1');
    `);
    db.close();

    const { migrateM33 } = await import('./migrate-m33.js');
    assert.deepEqual(migrateM33(), { backfilled: 1 });
    assert.deepEqual(migrateM33(), { backfilled: 0 });

    const inspect = new DatabaseSync(process.env.DB_PATH);
    const oldRelease = inspect.prepare("SELECT * FROM artifact_releases WHERE artifact_ref = 'old-draft'").get();
    assert.equal(oldRelease.provenance_status, 'inferred');
    assert.equal(inspect.prepare("SELECT COUNT(*) n FROM artifact_relations WHERE from_release_id = ?").get(oldRelease.id).n, 2);
    inspect.close();

    const { createDraft, updateDraft } = await import('./drafts.js');
    const { checkpointDraft, createRelease, getDraftLineage } = await import('./content-lineage.js');
    const master = createDraft({
      platform: 'gzh-long', title: '新作品', body: '第一版正文',
      paragraphRefs: [{ noteId: 'note-2', contentId: 'content-2' }],
      sourceKind: 'manual', lineage: { originTool: 'codex_cli', originAccount: 'account-b', creatorType: 'human_ai' },
    });
    assert.ok(master.work_id);
    assert.ok(master.latest_release_id);

    updateDraft(master.id, { body: '第二版正文' });
    const checkpoint = checkpointDraft(master.id, { releaseKind: 'reviewed', originTool: 'desktop_app', creatorType: 'human' });
    assert.equal(checkpoint.action, 'created');
    const duplicate = checkpointDraft(master.id, { releaseKind: 'reviewed', originTool: 'desktop_app', creatorType: 'human' });
    assert.equal(duplicate.action, 'unchanged');

    const platform = createRelease({
      workId: master.work_id, parentReleaseId: checkpoint.release.id, releaseKind: 'platform',
      artifactType: 'draft', artifactRefType: 'local_file', artifactRef: '/tmp/xhs.md',
      title: '小红书版', content: '平台正文', originTool: 'codex_cli', creatorType: 'human_ai',
    });
    assert.equal(platform.release.sequence, 3);
    const lineage = getDraftLineage(master.id);
    assert.deepEqual(lineage.releases.map(release => release.release_kind), ['initial', 'reviewed', 'platform']);
    assert.equal(lineage.releases[0].origin_account, 'account-b');
    assert.ok(lineage.relations.some(relation => relation.relation_type === 'revises' && relation.to_entity_id === checkpoint.release.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
