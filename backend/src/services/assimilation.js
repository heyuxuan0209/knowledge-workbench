import { getDatabase } from '../db/init.js';
import { randomUUID } from 'crypto';
import { chat } from './llm.js';
import { EMPTY_BODY } from './topic-pages.js';

// 同化引擎（M3 知识层核心，ADR-009）：把待并入素材合进活页正文。
// 成本控制：只在用户点"并入"时调 LLM（一批素材一次调用），自动匹配阶段零成本。
// 产出三件事：更新 topics.body、写一条 topic_changelog（时间线）、素材标记 assimilated。

// 演进阶段从同化次数自然涌现（changelog 即时间线，ADR-009）：不手动维护
function derivePhase(changelogCount) {
  if (changelogCount >= 10) return 'mature';
  if (changelogCount >= 3) return 'active';
  return 'emerging';
}

function buildPrompt(topic, body, notes) {
  const notesBlock = notes.map((n, i) =>
    `[素材${i + 1}]（来源：${n.source_title || '未知'}）\n${n.excerpt.slice(0, 1500)}`
  ).join('\n\n');

  const viewsBlock = body.views.length
    ? body.views.map(v => `- ${v.who}：${v.what}${v.conflict ? '（⚡与他方冲突）' : ''} [${v.ref}]`).join('\n')
    : '（暂无）';

  return `你是一位知识库维护者，负责维护主题「${topic.name}」的活页综述（一份持续演进的认知文档）。

# 活页现状
## 当前认知
${body.current || '（空白——这是第一次并入素材，请从零写出综述）'}

## 各方观点
${viewsBlock}

## 共识 / 非共识
${body.consensus || '（暂无）'}

# 新并入的素材
${notesBlock}

请把新素材同化进活页：补充新证据、修正过时论断、标记观点冲突。输出 JSON（不要 markdown 代码块）：
{
  "current": "更新后的当前认知综述（300字内，保留仍然成立的旧结论，融入新信息）",
  "views": [
    { "who": "观点方（人名/机构，来自素材或原有观点）", "what": "观点一句话", "ref": "来源短标（素材来源名）", "conflict": false }
  ],
  "consensus": "更新后的共识/非共识描述（150字内，用'共识：…'和'非共识：…'两段）",
  "changelog": "本次修订的一句话说明（40字内，说清并入了什么、改了什么）",
  "hasConflict": false
}

要求：
- views 合并新旧观点，同一方的观点更新为最新表述，上限 8 条；互相矛盾的观点把 conflict 设为 true
- hasConflict：本次并入是否引入了与已有认知矛盾的论断
- 不得编造素材里没有的信息；全部用中文`;
}

// 移出素材（误并撤销）：
// - pending 状态：纯解除关联，零成本
// - 已并入：解除关联 + 一次 LLM 修订，把"仅由该素材支撑"的论点/观点从活页里剔除，
//   写一条 'revised' changelog（修订失败不阻塞移出，如实记录综述未修订）
export async function removeNoteFromTopic(topicId, noteId) {
  const db = getDatabase();
  const link = db.prepare('SELECT status FROM note_topics WHERE topic_id = ? AND note_id = ?').get(topicId, noteId);
  if (!link) { db.close(); return { success: false, error: '该素材未关联此主题' }; }
  const note = db.prepare('SELECT excerpt, title, source_title FROM notes WHERE id = ?').get(noteId);
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
  const label = note?.title || note?.source_title || '素材';

  db.prepare('DELETE FROM note_topics WHERE topic_id = ? AND note_id = ?').run(topicId, noteId);

  if (link.status === 'pending' || !note) {
    db.close();
    return { success: true, data: { removed: label, revised: false } };
  }

  let body;
  try { body = { ...EMPTY_BODY, ...JSON.parse(topic.body || '{}') }; } catch { body = { ...EMPTY_BODY }; }

  let revised = false;
  let summary = `移出素材《${label}》（综述未修订，可手动检查残留论点）`;
  try {
    const result = await chat([{
      role: 'user',
      content: `主题「${topic.name}」的活页综述中，以下素材被用户移出（不再属于该主题），请修订活页：删除**仅由这条素材支撑**的论点、观点（views 里出处指向它的条目）和共识描述；其他素材支撑的内容原样保留，不要改写。输出 JSON（不要 markdown 代码块）：{"current": "...", "views": [{"who","what","ref","conflict"}], "consensus": "...", "changelog": "一句话说明移出了什么、删了哪些论点（40字内）"}

# 被移出的素材（来源：${note.source_title || '未知'}）
${note.excerpt.slice(0, 1500)}

# 当前活页
## 当前认知
${body.current}
## 各方观点
${body.views.map(v => `- ${v.who}：${v.what} [${v.ref}]`).join('\n') || '（无）'}
## 共识/非共识
${body.consensus}`,
    }]);
    if (result.success) {
      const cleaned = result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      const newBody = {
        current: typeof parsed.current === 'string' ? parsed.current : body.current,
        views: Array.isArray(parsed.views) ? parsed.views.map(v => ({ who: String(v.who || ''), what: String(v.what || ''), ref: String(v.ref || ''), conflict: !!v.conflict })) : body.views,
        consensus: typeof parsed.consensus === 'string' ? parsed.consensus : body.consensus,
      };
      db.prepare("UPDATE topics SET body = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(newBody), topicId);
      summary = (parsed.changelog || `移出素材《${label}》并修订综述`).slice(0, 120);
      revised = true;
    }
  } catch (err) {
    console.error('[assimilation] 移出修订失败:', err.message);
  }

  db.prepare(`
    INSERT INTO topic_changelog (id, topic_id, change_type, summary, note_ids)
    VALUES (?, ?, 'revised', ?, ?)
  `).run(randomUUID(), topicId, summary, JSON.stringify([noteId]));
  db.close();
  return { success: true, data: { removed: label, revised } };
}

// 并入：noteIds 为空 = 全部待并入素材。一批素材一次 LLM 调用。
// minRelevance：自动触发场景传 0.15——弱匹配（0.06~0.15）留在待并入等用户确认，
// 不自动写进综述（实测弱匹配误并会污染活页正文）；手动"立即并入"传 0 全量。
export async function assimilate(topicId, noteIds = null, minRelevance = 0) {
  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
  if (!topic) { db.close(); throw new Error('Topic not found'); }

  let sql = `
    SELECT n.id, n.excerpt, n.source_title
    FROM note_topics nt JOIN notes n ON nt.note_id = n.id
    WHERE nt.topic_id = ? AND nt.status = 'pending'
      AND (nt.relevance >= ? OR nt.added_by = 'user')
  `;
  const params = [topicId, minRelevance];
  if (Array.isArray(noteIds) && noteIds.length) {
    sql += ` AND n.id IN (${noteIds.map(() => '?').join(',')})`;
    params.push(...noteIds);
  }
  // 单次并入上限 10 条：控制 prompt 长度与单次成本，剩余的下次再并
  const notes = db.prepare(sql + ' ORDER BY nt.created_at LIMIT 10').all(...params);

  if (notes.length === 0) { db.close(); return { success: false, error: '没有待并入的素材' }; }

  let body;
  try { body = { ...EMPTY_BODY, ...JSON.parse(topic.body || '{}') }; } catch { body = { ...EMPTY_BODY }; }

  const result = await chat([{ role: 'user', content: buildPrompt(topic, body, notes) }]);
  if (!result.success) { db.close(); return { success: false, error: `LLM 调用失败: ${result.error}` }; }

  let parsed;
  try {
    const cleaned = result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    db.close();
    return { success: false, error: `LLM 返回的不是合法 JSON: ${result.content.slice(0, 200)}` };
  }

  // LLM 偶尔会把同一方拆成多条近似观点，按 who 去重（保留最后一条 = 最新表述）
  const dedupeViews = views => {
    const byWho = new Map();
    for (const v of views) byWho.set(v.who, v);
    return [...byWho.values()];
  };
  const newBody = {
    current: typeof parsed.current === 'string' ? parsed.current : body.current,
    views: Array.isArray(parsed.views)
      ? dedupeViews(parsed.views.map(v => ({
          who: String(v.who || ''), what: String(v.what || ''),
          ref: String(v.ref || ''), conflict: !!v.conflict,
        }))).slice(0, 8)
      : body.views,
    consensus: typeof parsed.consensus === 'string' ? parsed.consensus : body.consensus,
  };
  const summary = (parsed.changelog || `并入 ${notes.length} 条素材，更新综述`).slice(0, 120);
  const changeType = parsed.hasConflict ? 'conflict' : 'assimilated';

  db.exec('BEGIN');
  try {
    db.prepare("UPDATE topics SET body = ?, last_active_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(newBody), topicId);

    db.prepare(`
      INSERT INTO topic_changelog (id, topic_id, change_type, summary, note_ids)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), topicId, changeType, summary, JSON.stringify(notes.map(n => n.id)));

    const mark = db.prepare(`
      UPDATE note_topics SET status = 'assimilated', assimilated_at = datetime('now')
      WHERE note_id = ? AND topic_id = ?
    `);
    for (const n of notes) mark.run(n.id, topicId);

    // 演进阶段从修订次数涌现（不含 created 这条）
    const clCount = db.prepare(
      "SELECT COUNT(*) c FROM topic_changelog WHERE topic_id = ? AND change_type != 'created'"
    ).get(topicId).c;
    db.prepare('UPDATE topics SET evolution_phase = ? WHERE id = ?').run(derivePhase(clCount), topicId);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }
  db.close();

  console.log(`✅ Assimilated ${notes.length} notes into topic「${topic.name}」(¥${result.cost?.toFixed(4)})`);
  return {
    success: true,
    data: {
      topicId,
      assimilated: notes.length,
      changelog: summary,
      hasConflict: !!parsed.hasConflict,
      cost: result.cost,
    },
  };
}
