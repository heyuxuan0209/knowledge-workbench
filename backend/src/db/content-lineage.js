import { createHash, randomUUID } from 'node:crypto';
import { getDatabase } from './init.js';

const RELEASE_KINDS = new Set(['initial', 'checkpoint', 'reviewed', 'platform', 'feishu_handoff', 'published']);
const PROVENANCE = new Set(['confirmed', 'inferred']);
const CREATORS = new Set(['human', 'ai', 'human_ai', 'unknown']);

const parseJson = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const hashContent = (title, content) => createHash('sha256').update(`${title || ''}\n${content || ''}`).digest('hex');
// 时间线只需要版本身份与摘要信息。关键正文仍保存在数据库中，但不随列表接口整篇返回，
// 避免一打开“版本链”就把多份长文传到浏览器；以后恢复单版时走单独的按 id 读取接口。
const parseRelease = row => {
  if (!row) return null;
  const { sources_json, metadata_json, content_snapshot, ...release } = row;
  return {
    ...release,
    content_length: content_snapshot?.length || 0,
    sources: parseJson(sources_json, []),
    metadata: parseJson(metadata_json, {}),
  };
};

function validateRelease(input) {
  if (!RELEASE_KINDS.has(input.releaseKind)) throw new Error(`Unsupported releaseKind: ${input.releaseKind}`);
  if (!PROVENANCE.has(input.provenanceStatus)) throw new Error(`Unsupported provenanceStatus: ${input.provenanceStatus}`);
  if (!CREATORS.has(input.creatorType)) throw new Error(`Unsupported creatorType: ${input.creatorType}`);
}

function addRelation(db, { fromReleaseId, relationType, toEntityType, toEntityId, provenanceStatus = 'confirmed', metadata = {} }) {
  if (!fromReleaseId || !relationType || !toEntityType || !toEntityId) return null;
  const existing = db.prepare('SELECT * FROM artifact_relations WHERE from_release_id = ? AND relation_type = ? AND to_entity_type = ? AND to_entity_id = ?').get(fromReleaseId, relationType, toEntityType, toEntityId);
  if (existing) return existing;
  const id = randomUUID();
  db.prepare('INSERT INTO artifact_relations (id, from_release_id, relation_type, to_entity_type, to_entity_id, provenance_status, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, fromReleaseId, relationType, toEntityType, toEntityId, provenanceStatus, JSON.stringify(metadata));
  return db.prepare('SELECT * FROM artifact_relations WHERE id = ?').get(id);
}

function createReleaseInDb(db, {
  workId, releaseKind = 'checkpoint', artifactType = 'draft', artifactRefType = 'manual', artifactRef = null,
  parentReleaseId = null, title = null, content = null, originTool = 'unknown', originAccount = null,
  creatorType = 'unknown', provenanceStatus = 'confirmed', sources = [], metadata = {}, relations = [],
}) {
  validateRelease({ releaseKind, provenanceStatus, creatorType });
  if (!db.prepare('SELECT id FROM content_works WHERE id = ?').get(workId)) throw new Error(`Work not found: ${workId}`);
  const contentHash = content == null ? null : hashContent(title, content);
  const latest = db.prepare('SELECT * FROM artifact_releases WHERE work_id = ? ORDER BY sequence DESC LIMIT 1').get(workId);
  const unchanged = latest
    && latest.release_kind === releaseKind
    && latest.artifact_type === artifactType
    && (latest.artifact_ref_type || '') === (artifactRefType || '')
    && (latest.artifact_ref || '') === (artifactRef || '')
    && (latest.content_hash || '') === (contentHash || '');
  if (unchanged) return { release: parseRelease(latest), action: 'unchanged' };

  const parentId = parentReleaseId || latest?.id || null;
  if (parentId) {
    const parent = db.prepare('SELECT work_id FROM artifact_releases WHERE id = ?').get(parentId);
    if (!parent || parent.work_id !== workId) throw new Error('parentReleaseId must belong to the same work');
  }
  const id = randomUUID();
  const sequence = (latest?.sequence || 0) + 1;
  db.prepare(`INSERT INTO artifact_releases (id, work_id, sequence, parent_release_id, release_kind, artifact_type, artifact_ref_type, artifact_ref, title, content_hash, content_snapshot, origin_tool, origin_account, creator_type, provenance_status, sources_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, workId, sequence, parentId, releaseKind, artifactType, artifactRefType, artifactRef, title, contentHash, content, originTool, originAccount, creatorType, provenanceStatus, JSON.stringify(sources), JSON.stringify(metadata));
  db.prepare("UPDATE content_works SET title = COALESCE(?, title), updated_at = datetime('now') WHERE id = ?").run(title, workId);
  if (parentId) addRelation(db, { fromReleaseId: id, relationType: 'revises', toEntityType: 'release', toEntityId: parentId, provenanceStatus });
  for (const relation of relations) addRelation(db, { fromReleaseId: id, provenanceStatus, ...relation });
  return { release: parseRelease(db.prepare('SELECT * FROM artifact_releases WHERE id = ?').get(id)), action: 'created' };
}

export function createWork({ title = null, kind = 'content' } = {}) {
  const db = getDatabase(); const id = randomUUID();
  db.prepare('INSERT INTO content_works (id, title, kind) VALUES (?, ?, ?)').run(id, title, kind);
  const work = db.prepare('SELECT * FROM content_works WHERE id = ?').get(id); db.close(); return work;
}

export function createRelease(input) {
  const db = getDatabase(); db.exec('PRAGMA foreign_keys = ON'); db.exec('BEGIN IMMEDIATE');
  try { const result = createReleaseInDb(db, input); db.exec('COMMIT'); db.close(); return result; }
  catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
}

export function recordDraftCreated(db, draft, receipt = {}) {
  const workId = receipt.workId || randomUUID();
  if (!receipt.workId) db.prepare('INSERT INTO content_works (id, title, kind) VALUES (?, ?, ?)').run(workId, draft.title || '未命名作品', 'content');
  else if (!db.prepare('SELECT id FROM content_works WHERE id = ?').get(workId)) throw new Error(`Work not found: ${workId}`);
  const relations = [];
  if (draft.source_kind && draft.source_id) relations.push({ relationType: 'derived_from', toEntityType: draft.source_kind, toEntityId: draft.source_id });
  for (const ref of draft.paragraph_refs || []) {
    if (ref.noteId) relations.push({ relationType: 'cites', toEntityType: 'note', toEntityId: ref.noteId });
    if (ref.contentId) relations.push({ relationType: 'cites', toEntityType: 'content', toEntityId: ref.contentId });
  }
  const result = createReleaseInDb(db, {
    workId, parentReleaseId: receipt.parentReleaseId || null,
    releaseKind: receipt.releaseKind || (receipt.parentReleaseId ? 'platform' : 'initial'),
    artifactType: 'draft', artifactRefType: 'draft', artifactRef: draft.id,
    title: draft.title, content: draft.body, originTool: receipt.originTool || 'knowledge_workbench',
    originAccount: receipt.originAccount || null, creatorType: receipt.creatorType || 'human_ai',
    provenanceStatus: receipt.provenanceStatus || 'confirmed', sources: draft.paragraph_refs || [],
    metadata: { platform: draft.platform, sourceKind: draft.source_kind, sourceLabel: draft.source_label }, relations,
  });
  db.prepare('UPDATE drafts SET work_id = ?, latest_release_id = ? WHERE id = ?').run(workId, result.release.id, draft.id);
  return { workId, ...result };
}

export function checkpointDraft(draftId, receipt = {}) {
  const db = getDatabase(); db.exec('PRAGMA foreign_keys = ON'); db.exec('BEGIN IMMEDIATE');
  try {
    const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    if (!draft.work_id) throw new Error(`Draft has no work: ${draftId}`);
    const result = createReleaseInDb(db, {
      workId: draft.work_id, parentReleaseId: receipt.parentReleaseId || draft.latest_release_id || null,
      releaseKind: receipt.releaseKind || 'checkpoint', artifactType: receipt.artifactType || 'draft',
      artifactRefType: receipt.artifactRefType || 'draft', artifactRef: receipt.artifactRef || draft.id,
      title: receipt.title ?? draft.title, content: receipt.content ?? draft.body,
      originTool: receipt.originTool || 'knowledge_workbench', originAccount: receipt.originAccount || null,
      creatorType: receipt.creatorType || 'human_ai', provenanceStatus: receipt.provenanceStatus || 'confirmed',
      sources: receipt.sources || parseJson(draft.paragraph_refs, []), metadata: { platform: draft.platform, ...(receipt.metadata || {}) },
      relations: receipt.relations || [],
    });
    db.prepare('UPDATE drafts SET latest_release_id = ? WHERE id = ?').run(result.release.id, draftId);
    db.exec('COMMIT'); db.close(); return { workId: draft.work_id, ...result };
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
}

export function addReleaseRelation(input) { const db = getDatabase(); const relation = addRelation(db, input); db.close(); return relation; }

export function getWorkLineage(workId) {
  const db = getDatabase(); const work = db.prepare('SELECT * FROM content_works WHERE id = ?').get(workId);
  if (!work) { db.close(); return null; }
  const releases = db.prepare('SELECT * FROM artifact_releases WHERE work_id = ? ORDER BY sequence').all(workId).map(parseRelease);
  const relations = releases.length ? db.prepare(`SELECT * FROM artifact_relations WHERE from_release_id IN (${releases.map(() => '?').join(',')}) ORDER BY created_at, id`).all(...releases.map(r => r.id)).map(row => ({ ...row, metadata: parseJson(row.metadata_json, {}) })) : [];
  db.close(); return { work, releases, relations };
}

export function getDraftLineage(draftId) {
  const db = getDatabase(); const draft = db.prepare('SELECT work_id FROM drafts WHERE id = ?').get(draftId); db.close();
  return draft?.work_id ? getWorkLineage(draft.work_id) : null;
}

export function compareReleases(workId, fromReleaseId, toReleaseId) {
  const db = getDatabase();
  const from = db.prepare('SELECT * FROM artifact_releases WHERE id = ? AND work_id = ?').get(fromReleaseId, workId);
  const to = db.prepare('SELECT * FROM artifact_releases WHERE id = ? AND work_id = ?').get(toReleaseId, workId);
  db.close();
  if (!from || !to) throw new Error('两个 Release 必须属于当前作品');
  return { from, to };
}

export function restoreReleaseToDraft({ releaseId, draftId, originTool = 'knowledge_workbench', creatorType = 'human' }) {
  const db = getDatabase(); db.exec('PRAGMA foreign_keys = ON'); db.exec('BEGIN IMMEDIATE');
  try {
    const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId);
    const source = db.prepare('SELECT * FROM artifact_releases WHERE id = ?').get(releaseId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    if (!source || source.work_id !== draft.work_id) throw new Error('只能恢复当前作品自己的 Release');
    if (source.content_snapshot == null) throw new Error('这个 Release 没有可恢复的正文快照');
    db.prepare("UPDATE drafts SET title = ?, body = ?, paragraph_refs = ?, updated_at = datetime('now') WHERE id = ?").run(source.title, source.content_snapshot, source.sources_json || '[]', draftId);
    const result = createReleaseInDb(db, {
      workId: draft.work_id, parentReleaseId: draft.latest_release_id || null,
      releaseKind: 'checkpoint', artifactType: 'draft', artifactRefType: 'draft', artifactRef: draftId,
      title: source.title, content: source.content_snapshot, originTool, creatorType,
      provenanceStatus: 'confirmed', sources: parseJson(source.sources_json, []),
      metadata: { platform: draft.platform, restoredFromReleaseId: releaseId },
      relations: [{ relationType: 'restored_from', toEntityType: 'release', toEntityId: releaseId }],
    });
    db.prepare('UPDATE drafts SET latest_release_id = ? WHERE id = ?').run(result.release.id, draftId);
    const restoredDraft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId);
    db.exec('COMMIT'); db.close();
    return { draft: { ...restoredDraft, paragraph_refs: parseJson(restoredDraft.paragraph_refs, []) }, ...result };
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
}
