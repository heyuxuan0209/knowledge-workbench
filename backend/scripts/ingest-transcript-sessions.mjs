// 建「场次索引」层：一场一条，让检索先选场、再进场内找原话。
//
//   node scripts/ingest-transcript-sessions.mjs [--dry] [--skip-new]
//
// 做两件事：
//   A) 把妙记转写接口这一路的新场次切片入 transcript_chunks（file_token = minute_token）。
//      来源是 ~/kw-transcripts/*.md 里落地的那批。面试/求职类只留在飞书，本地不落地
//      （排除清单在 ~/.claude/skills/kw-search/exclude-sessions.txt，抓取时就跳过）。
//      跟已有的 docx 那路按**正文指纹**去重——同一场录音两条路都能拿到，标题却对不上
//      （「智能冰箱贴 2026年8月1日」vs「智能冰箱贴0801-飞书绝活大会上海」），只能比内容。
//   B) 给 transcript_chunks 里**所有**场次建/刷新索引条目。
//      索引文本优先用飞书智能纪要正文；找不到纪要就退回用该场逐字稿开头兜底。
//
// 为什么用纪要当索引：当材料嫌它提炼过头（要的是原话），当索引恰好合适——一场一份、短、
// AI 已经写好，零额外成本。逐字稿负责给原话，纪要负责告诉你去哪一场找。
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getDatabase } from '../src/db/init.js';
import { feishuFetch, feishuBase, getTenantAccessToken } from '../src/services/feishu-auth.js';
import { embedText, MODEL_NAME } from '../src/services/embeddings.js';

const TRANSCRIPT_DIR = process.env.KW_TRANSCRIPT_DIR || join(homedir(), 'kw-transcripts');
const CHUNK_CHARS = 1400;
const CHUNK_MIN = 200;
const INDEX_HEAD_CHARS = 2000;      // 没有纪要时，拿逐字稿开头这么多字当索引
const FP_CHARS = 120;               // 正文指纹长度，用来判「这场是不是已经入过库」

const dry = process.argv.includes('--dry');
const skipNew = process.argv.includes('--skip-new');

// ── 工具 ────────────────────────────────────────────────
// 指纹只看「说了什么」：把行首的说话人标签剥掉再归一化。
// 同一场录音走 docx 那路和走妙记那路，说话人可能一个标成「说话人 3」、一个认出真名，
// 但第一句话的内容是同一句——所以比内容，不比标签。
const norm = (s) => (s || '').replace(/^[^：\n]{1,20}：/gm, '').replace(/[\s\p{P}\p{S}]/gu, '');
const fingerprint = (body) => norm(body).slice(0, FP_CHARS);

/** 妙记转写正文（带说话人 + 时间码）。KW 的 getMinuteText 默认不带时间码，这里显式要。 */
async function fetchMinuteTranscript(minuteToken) {
  const { getUserAccessTokenIfConnected } = await import('../src/services/feishu-user-auth.js');
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

function splitTurns(body) {
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

/** 发言轮 → 切片（跟 ingest-transcripts.mjs 同一套策略，片头记住说话人与时间码） */
function chunkTurns(turns) {
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

/** 读 ~/kw-transcripts/*.md 的 frontmatter（minutes-harvest.mjs 写的） */
function readHarvested() {
  if (!existsSync(TRANSCRIPT_DIR)) return [];
  return readdirSync(TRANSCRIPT_DIR).filter((f) => f.endsWith('.md')).map((f) => {
    const raw = readFileSync(join(TRANSCRIPT_DIR, f), 'utf8');
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
    const meta = {};
    if (fm) for (const line of fm[1].split('\n')) {
      const i = line.indexOf(': '); if (i > 0) meta[line.slice(0, i)] = line.slice(i + 2);
    }
    return {
      file: f,
      title: (meta.title || f.replace(/\.md$/, '')).replace(/^智能纪要[：:]/, '').trim(),
      minuteToken: meta.minute_token,
      minuteUrl: meta.minute_url,
      summaryDocId: meta.doc_id,
      body: raw.slice(fm ? fm[0].length : 0),
    };
  }).filter((x) => x.minuteToken);
}

const dateOf = (title) => {
  const m = title.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const d = title.match(/(20\d{2})(\d{2})(\d{2})/);
  return d ? `${d[1]}-${d[2]}-${d[3]}` : null;
};

// ── A) 妙记那一路的新场次入库 ──────────────────────────
async function ingestNewSessions() {
  const harvested = readHarvested();
  console.log(`本地逐字稿 ${harvested.length} 份（面试/求职类已排除）`);

  const db0 = getDatabase();
  const existing = db0.prepare('SELECT file_token, session_title, MIN(seq) s FROM transcript_chunks GROUP BY file_token').all();
  const firstChunks = db0.prepare('SELECT file_token, text FROM transcript_chunks WHERE seq = 0').all();
  db0.close();
  const seenFp = new Map(firstChunks.map((r) => [fingerprint(r.text), r.file_token]));
  const seenToken = new Set(existing.map((r) => r.file_token));

  const report = [];
  for (const h of harvested) {
    if (seenToken.has(h.minuteToken)) { report.push(`⏭  已入库  ${h.title}`); continue; }

    let body;
    try { body = await fetchMinuteTranscript(h.minuteToken); }
    catch (e) { report.push(`❌ ${e.message}  ${h.title}`); continue; }

    const chunks = chunkTurns(splitTurns(body));
    if (!chunks.length) { report.push(`⚠️  切不出发言轮  ${h.title}`); continue; }

    // 去重放在切片之后：拿第一片跟库里第一片比，两边都是同一种形态，才比得准
    const fp = fingerprint(chunks[0].text);
    const dupOf = [...seenFp.entries()].find(([k]) => k.slice(0, 60) === fp.slice(0, 60));
    if (dupOf) { report.push(`⏭  与已入库的同一场重复  ${h.title}`); continue; }
    if (dry) { report.push(`[dry] ${body.length} 字 → ${chunks.length} 片  ${h.title}`); continue; }

    process.stdout.write(`  ${h.title} — ${chunks.length} 片，嵌入中`);
    for (let i = 0; i < chunks.length; i += 1) {
      const c = chunks[i];
      const vec = await embedText(`${h.title}\n${c.text}`, { isQuery: false });
      const db = getDatabase();
      db.prepare(`INSERT OR REPLACE INTO transcript_chunks
        (file_token, session_title, session_date, seq, speaker, timecode, text, doc_url, embedding, embedding_model)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(h.minuteToken, h.title, dateOf(h.title), i, c.speaker, c.timecode, c.text, h.minuteUrl,
          JSON.stringify(vec), MODEL_NAME);
      db.close();
      if ((i + 1) % 5 === 0) process.stdout.write('.');
    }
    process.stdout.write(' ✅\n');
    seenFp.set(fingerprint(chunks[0].text), h.minuteToken);
    report.push(`✅ ${chunks.length} 片  ${h.title}`);
  }
  console.log('\n── 新场次入库 ──');
  report.forEach((r) => console.log('  ' + r));
}

// ── B) 建场次索引 ──────────────────────────────────────
/** 云盘里所有「智能纪要：X」，用来给场次配索引文本 */
async function loadSummaryDocs() {
  let page = null; const all = [];
  do {
    const r = await feishuFetch('/open-apis/drive/v1/files',
      { query: { page_size: 200, ...(page ? { page_token: page } : {}) }, preferUser: true });
    all.push(...(r.files || [])); page = r.has_more ? r.next_page_token : null;
  } while (page);
  return all.filter((f) => /^智能纪要[：:]/.test(f.name))
    .map((f) => ({ key: f.name.replace(/^智能纪要[：:]/, '').trim(), token: f.token }));
}

/** 场次标题 → 智能纪要 token。先精确，再去掉日期后互相包含，最后取最长公共前缀 ≥4 字 */
function matchSummary(title, summaries) {
  const strip = (s) => s.replace(/\s*20\d{2}年\d{1,2}月\d{1,2}日\s*/g, '').replace(/\s+/g, '').trim();
  const t = strip(title);
  return summaries.find((s) => s.key === title)
    || summaries.find((s) => strip(s.key) === t)
    || summaries.find((s) => strip(s.key).includes(t) || t.includes(strip(s.key)))
    || summaries.find((s) => { const k = strip(s.key); let i = 0; while (i < Math.min(k.length, t.length) && k[i] === t[i]) i += 1; return i >= 4; })
    || null;
}

async function buildSessionIndex() {
  const db0 = getDatabase();
  const sessions = db0.prepare(`
    SELECT file_token, session_title, MIN(session_date) session_date, MIN(doc_url) doc_url, COUNT(*) n
    FROM transcript_chunks GROUP BY file_token, session_title`).all();
  db0.close();
  console.log(`\n共 ${sessions.length} 场需要索引`);

  const summaries = await loadSummaryDocs();
  console.log(`云盘里的智能纪要 ${summaries.length} 份`);

  const report = [];
  for (const s of sessions) {
    const hit = matchSummary(s.session_title, summaries);
    let indexText = '';
    let indexSource = 'transcript_head';
    let summaryUrl = null;

    if (hit) {
      try {
        const r = await feishuFetch(`/open-apis/docx/v1/documents/${hit.token}/raw_content`, { preferUser: true });
        const text = (r?.content ?? '').toString().trim();
        if (text.length > 100) { indexText = text; indexSource = 'summary'; summaryUrl = `https://my.feishu.cn/docx/${hit.token}`; }
      } catch { /* 抓不到就走兜底 */ }
    }
    if (!indexText) {
      const db = getDatabase();
      const head = db.prepare('SELECT text FROM transcript_chunks WHERE file_token = ? ORDER BY seq LIMIT 3').all(s.file_token);
      db.close();
      indexText = head.map((h) => h.text).join('\n').slice(0, INDEX_HEAD_CHARS);
    }

    if (dry) { report.push(`[dry] ${indexSource.padEnd(15)} ${s.session_title}`); continue; }

    const vec = await embedText(`${s.session_title}\n${indexText}`, { isQuery: false });
    const db = getDatabase();
    db.prepare(`INSERT OR REPLACE INTO transcript_sessions
      (file_token, session_title, session_date, source_kind, index_text, index_source, summary_url, doc_url,
       chunk_count, embedding, embedding_model, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
      .run(s.file_token, s.session_title, s.session_date,
        s.doc_url && s.doc_url.includes('/minutes/') ? 'minutes' : 'docx',
        indexText, indexSource, summaryUrl, s.doc_url, s.n, JSON.stringify(vec), MODEL_NAME);
    db.close();
    report.push(`${indexSource === 'summary' ? '📄 纪要' : '✂️  开头'}  ${String(s.n).padStart(3)} 片  ${s.session_title}`);
  }
  console.log('\n── 场次索引 ──');
  report.forEach((r) => console.log('  ' + r));
}

// ── main ────────────────────────────────────────────────
if (!skipNew) await ingestNewSessions();
await buildSessionIndex();

const db = getDatabase();
const a = db.prepare('SELECT COUNT(*) c, COUNT(DISTINCT file_token) s FROM transcript_chunks WHERE embedding IS NOT NULL').get();
const b = db.prepare("SELECT COUNT(*) c, SUM(index_source='summary') withSummary FROM transcript_sessions WHERE embedding IS NOT NULL").get();
db.close();
console.log(`\n═══ 现状：${a.s} 场 / ${a.c} 片；索引 ${b.c} 条（其中 ${b.withSummary} 条用的是智能纪要）`);
