// 把飞书云盘里的妙记逐字稿切片入库，建成可按「意思」检索的知识库。
//
//   node scripts/ingest-transcripts.mjs [--dry] [--only=<标题片段>]
//
// 范围（2026-08-11 何雨轩定）：**只做 AI 圈分享/活动那批，只要逐字稿、不要智能纪要**。
// 面试记录（约 30 份）、律师/达人营销等工作项目、测试录音一律不入——隐私 + 噪音。
//
// 切片策略：逐字稿是「说话人 N HH:MM:SS + 一段话」的流水。按发言轮切开后攒到
// CHUNK_CHARS 左右成一片，带上这一片开头的说话人与时间码——检索命中后能答出
// 「谁说的、哪场、第几分钟」并跳回原文。
import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { getDatabase } from '../src/db/init.js';
import { feishuFetch } from '../src/services/feishu-auth.js';
import { embedText, MODEL_NAME } from '../src/services/embeddings.js';

const CHUNK_CHARS = 1400;      // 一片的目标长度；bge-m3 的 maxChars 是 2500，留足余量
const CHUNK_MIN = 200;         // 太碎的尾片并回上一片
const TURN_RE = /(?:说话人 (\d+)|@([^\s]+)) (\d{2}:\d{2}:\d{2})\n/g;

// 入库范围放在 backend/data/transcript-scope.txt（已 gitignore）——那里面全是真实人名和
// 私下会议标题，仓库是公开的，名单不该进 git。要增删场次改那个文件，不用动代码。
// 名单靠人工维护而不是标题正则：实测按标题猜会猜错（「何雨轩的视频会议」其实是他自己在演示
// knowledge-workbench，「产品演示-」是印力集团的 AI BI 产品演示，
// 而「具身智能岗位与候选人沟通会」听着像行业活动、其实是招聘）。
const SCOPE_FILE = new URL('../data/transcript-scope.txt', import.meta.url);
const SESSIONS = existsSync(SCOPE_FILE)
  ? readFileSync(SCOPE_FILE, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
if (!SESSIONS.length) { console.error('❌ 读不到 backend/data/transcript-scope.txt，没有入库范围可跑'); process.exit(1); }

const dry = process.argv.includes('--dry');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

function ensureTable() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_token TEXT NOT NULL,
      session_title TEXT NOT NULL,
      session_date TEXT,
      seq INTEGER NOT NULL,
      speaker TEXT,
      timecode TEXT,
      text TEXT NOT NULL,
      doc_url TEXT,
      embedding TEXT,
      embedding_model TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (file_token, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_tc_session ON transcript_chunks(session_title);
  `);
  db.close();
}

/** 逐字稿正文 → 发言轮 [{speaker, timecode, text}] */
function splitTurns(body) {
  const turns = [];
  const marks = [...body.matchAll(TURN_RE)];
  for (let i = 0; i < marks.length; i += 1) {
    const m = marks[i];
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : body.length;
    const text = body.slice(start, end).trim();
    if (text) turns.push({ speaker: m[1] ? `说话人 ${m[1]}` : m[2], timecode: m[3], text });
  }
  return turns;
}

/** 发言轮 → 切片：攒到 CHUNK_CHARS 就断，片头记住说话人与时间码 */
function chunkTurns(turns) {
  const chunks = [];
  let buf = null;
  for (const t of turns) {
    if (!buf) buf = { speaker: t.speaker, timecode: t.timecode, parts: [], speakers: new Set() };
    buf.parts.push(`${t.speaker}：${t.text}`);
    buf.speakers.add(t.speaker);
    if (buf.parts.join('\n').length >= CHUNK_CHARS) {
      chunks.push({ ...buf, text: buf.parts.join('\n') });
      buf = null;
    }
  }
  if (buf) {
    const text = buf.parts.join('\n');
    // 太短的尾片并回上一片，别留下没有语义的碎渣
    if (text.length < CHUNK_MIN && chunks.length) chunks[chunks.length - 1].text += `\n${text}`;
    else chunks.push({ ...buf, text });
  }
  return chunks.map((c) => ({
    speaker: c.speakers.size > 1 ? `${c.speaker} 等${c.speakers.size}人` : c.speaker,
    timecode: c.timecode,
    text: c.text,
  }));
}

const main = async () => {
  ensureTable();

  let page = null;
  const all = [];
  do {
    const r = await feishuFetch('/open-apis/drive/v1/files', {
      query: { page_size: 200, ...(page ? { page_token: page } : {}) }, preferUser: true,
    });
    all.push(...(r.files || []));
    page = r.has_more ? r.next_page_token : null;
  } while (page);

  const wanted = SESSIONS.filter((s) => !only || s.includes(only));
  const report = [];

  for (const title of wanted) {
    const file = all.find((f) => f.name === `文字记录：${title}` || f.name === `文字记录:${title}`);
    if (!file) { report.push({ title, status: '❌ 云盘里找不到' }); continue; }

    const db0 = getDatabase();
    const done = db0.prepare('SELECT COUNT(*) n FROM transcript_chunks WHERE file_token = ? AND embedding IS NOT NULL').get(file.token);
    db0.close();
    if (done.n > 0) { report.push({ title, chunks: done.n, status: '⏭  已入库，跳过' }); continue; }

    let body = '';
    try {
      const r = await feishuFetch(`/open-apis/docx/v1/documents/${file.token}/raw_content`, { preferUser: true });
      body = (r.content ?? r ?? '').toString();
    } catch (e) { report.push({ title, status: `❌ 读不到（${e.feishuCode || e.message.slice(0, 40)}）` }); continue; }

    const chunks = chunkTurns(splitTurns(body));
    if (!chunks.length) { report.push({ title, status: '⚠️  切不出发言轮（格式不同）' }); continue; }

    const date = title.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const sessionDate = date ? `${date[1]}-${String(date[2]).padStart(2, '0')}-${String(date[3]).padStart(2, '0')}` : null;
    const docUrl = `https://my.feishu.cn/docx/${file.token}`;

    if (dry) {
      report.push({ title, chunks: chunks.length, status: `[dry] ${body.length} 字 → ${chunks.length} 片` });
      continue;
    }

    process.stdout.write(`  ${title} — ${body.length} 字 → ${chunks.length} 片，嵌入中`);
    for (let i = 0; i < chunks.length; i += 1) {
      const c = chunks[i];
      const vec = await embedText(`${title}\n${c.text}`, { isQuery: false });
      const db = getDatabase();
      db.prepare(`INSERT OR REPLACE INTO transcript_chunks
        (file_token, session_title, session_date, seq, speaker, timecode, text, doc_url, embedding, embedding_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(file.token, title, sessionDate, i, c.speaker, c.timecode, c.text, docUrl, JSON.stringify(vec), MODEL_NAME);
      db.close();
      if ((i + 1) % 5 === 0) process.stdout.write('.');
    }
    process.stdout.write(' ✅\n');
    report.push({ title, chunks: chunks.length, status: '✅ 已入库' });
  }

  console.log('\n══════ 入库清单 ══════');
  for (const r of report) console.log(`${r.status.padEnd(12)} ${String(r.chunks ?? '').padStart(4)} 片  ${r.title}`);
  const db = getDatabase();
  const stat = db.prepare('SELECT COUNT(*) chunks, COUNT(DISTINCT file_token) sessions FROM transcript_chunks WHERE embedding IS NOT NULL').get();
  db.close();
  console.log(`\n库里现有：${stat.sessions} 场 / ${stat.chunks} 片`);
};

await main();
