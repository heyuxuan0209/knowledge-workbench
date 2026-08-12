// 妙记逐字稿的取用、切片、入库——scripts/ 下几个脚本共用这一份，别各写一套。
//
// 妙记没有列表接口，但每份「智能纪要」docx 的 block 里埋着回原妙记的链接
// （raw_content 会把链接吃掉，必须走 blocks）。所以入口一律是：
//   智能纪要 docx → blocks 抽 minute_token → 转写接口取逐字稿。

import { getDatabase } from '../db/init.js';
import { feishuFetch, feishuBase, getTenantAccessToken } from './feishu-auth.js';
import { embedText, MODEL_NAME } from './embeddings.js';

export const CHUNK_CHARS = 1400;   // 一片的目标长度；bge-m3 的 maxChars 是 2500，留足余量
export const CHUNK_MIN = 200;      // 太碎的尾片并回上一片

// 指纹只看「说了什么」：把行首的说话人标签剥掉再归一化。
// 同一场录音走 docx 那路和走妙记那路，说话人可能一个标成「说话人 3」、一个认出真名，
// 但第一句话的内容是同一句——所以比内容，不比标签。
const norm = (s) => (s || '').replace(/^[^：\n]{1,20}：/gm, '').replace(/[\s\p{P}\p{S}]/gu, '');
export const fingerprint = (body) => norm(body).slice(0, 120);

/** 从一份 docx 的 blocks 里抽妙记 token；不是妙记生成的文档返回 null */
export async function minuteTokenOfDoc(documentId) {
  const d = await feishuFetch(`/open-apis/docx/v1/documents/${documentId}/blocks`,
    { query: { page_size: 100 }, preferUser: true });
  const m = JSON.stringify(d).match(/minutes\\?\/([a-z0-9]{15,})/i);
  return m ? m[1] : null;
}

/** 妙记转写正文（带说话人 + 时间码）。KW 的 getMinuteText 默认不带时间码，这里显式要。 */
export async function fetchMinuteTranscript(minuteToken) {
  const { getUserAccessTokenIfConnected } = await import('./feishu-user-auth.js');
  const token = (await getUserAccessTokenIfConnected().catch(() => null)) || (await getTenantAccessToken());
  const url = `${feishuBase()}/open-apis/minutes/v1/minutes/${minuteToken}/transcript`
    + '?need_speaker=true&need_timestamp=true&file_format=txt';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  if (body.trim().startsWith('{') && body.includes('"code"')) {
    let code = ''; try { code = JSON.parse(body).code; } catch { /* 保留原文 */ }
    throw new Error(`转写获取失败(${code || body.slice(0, 40)})`);
  }
  return body;
}

// 妙记转写的行首格式：`说话人 3 00:01:02.480` 或 `何雨轩 00:01:02.480`（识别出姓名时用真名）
const TURN_RE = /^(.{1,20}?) (\d{2}:\d{2}:\d{2})(?:\.\d+)?[ \t]*$/gm;

export function splitTurns(body) {
  const turns = [];
  const marks = [...body.matchAll(TURN_RE)];
  for (let i = 0; i < marks.length; i += 1) {
    const m = marks[i];
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : body.length;
    const text = body.slice(start, end).trim();
    if (text) turns.push({ speaker: m[1].trim(), timecode: m[2], text });
  }
  return turns;
}

/** 发言轮 → 切片，片头记住说话人与时间码（检索命中后能答出「谁说的、第几分钟」） */
export function chunkTurns(turns) {
  const chunks = [];
  let buf = null;
  for (const t of turns) {
    if (!buf) buf = { speaker: t.speaker, timecode: t.timecode, parts: [], speakers: new Set() };
    buf.parts.push(`${t.speaker}：${t.text}`);
    buf.speakers.add(t.speaker);
    if (buf.parts.join('\n').length >= CHUNK_CHARS) { chunks.push({ ...buf, text: buf.parts.join('\n') }); buf = null; }
  }
  if (buf) {
    const text = buf.parts.join('\n');
    if (text.length < CHUNK_MIN && chunks.length) chunks[chunks.length - 1].text += `\n${text}`;
    else chunks.push({ ...buf, text });
  }
  return chunks.map((c) => ({
    speaker: c.speakers.size > 1 ? `${c.speaker} 等${c.speakers.size}人` : c.speaker,
    timecode: c.timecode,
    text: c.text,
  }));
}

export function dateOf(title) {
  const m = title.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const d = title.match(/(20\d{2})(\d{2})(\d{2})/);
  return d ? `${d[1]}-${d[2]}-${d[3]}` : null;
}

/** 库里已有的第一片指纹 → file_token，用来判「这场是不是已经入过库」 */
export function loadFingerprints() {
  const db = getDatabase();
  const rows = db.prepare('SELECT file_token, text FROM transcript_chunks WHERE seq = 0').all();
  db.close();
  return new Map(rows.map((r) => [fingerprint(r.text), r.file_token]));
}

/** 切片写库（逐片嵌入）。返回入库片数。 */
export async function saveChunks({ fileToken, title, date, docUrl, chunks }) {
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    const vec = await embedText(`${title}\n${c.text}`, { isQuery: false });
    const db = getDatabase();
    db.prepare(`INSERT OR REPLACE INTO transcript_chunks
      (file_token, session_title, session_date, seq, speaker, timecode, text, doc_url, embedding, embedding_model)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(fileToken, title, date, i, c.speaker, c.timecode, c.text, docUrl, JSON.stringify(vec), MODEL_NAME);
    db.close();
  }
  return chunks.length;
}

/** 建/刷新一场的索引条目。indexText 优先传智能纪要正文；没有就退回逐字稿开头。 */
export async function saveSessionIndex({ fileToken, title, date, indexText, indexSource, summaryUrl, docUrl, chunkCount }) {
  const vec = await embedText(`${title}\n${indexText}`, { isQuery: false });
  const db = getDatabase();
  db.prepare(`INSERT OR REPLACE INTO transcript_sessions
    (file_token, session_title, session_date, source_kind, index_text, index_source, summary_url, doc_url,
     chunk_count, embedding, embedding_model, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(fileToken, title, date, docUrl && docUrl.includes('/minutes/') ? 'minutes' : 'docx',
      indexText, indexSource, summaryUrl || null, docUrl || null, chunkCount,
      JSON.stringify(vec), MODEL_NAME);
  db.close();
}
