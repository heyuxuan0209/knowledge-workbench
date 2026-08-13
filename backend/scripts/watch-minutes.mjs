// 每天扫一遍飞书妙记：新场次自动入库，测试录音只记不入，最后发一条清单给他过目。
//
//   node scripts/watch-minutes.mjs [--dry] [--notify] [--since=2026-08-01]
//     --dry     只判不动库、不发消息
//     --notify  把清单发到飞书（cron 用；手动跑默认不发，免得刷屏）
//
// 判据（2026-08-12 定，依据是 49 场真实场次的实测分布）：
//   · 标题还是飞书默认名（新录音 N）或写着测试/自测/彩排 → 判 test，不入库
//   · 面试/求职类（exclude 清单）→ 判 test，本地一份都不留
//   · 其余 → 判 keep，直接入库
// **不用时长当判据**：实测最短的真实场次只有 4 分钟（Zara-做有观点的产品），
// 跟测试录音的长度完全重叠，卡阈值必然误伤。时长只作为发给他的参考信息一起列出来。
//
// 判错了不要紧：每一场都在 minute_watchlist 留一行，撤回/补入各一条命令（见文末提示）。
import 'dotenv/config';
import { getDatabase } from '../src/db/init.js';
import { searchDocs, getMinuteInfo } from '../src/services/feishu-client.js';
import { feishuFetch } from '../src/services/feishu-auth.js';
import {
  minuteTokenOfDoc, fetchMinuteTranscript, splitTurns, chunkTurns,
  dateOf, fingerprint, loadFingerprints, saveChunks, saveSessionIndex,
} from '../src/services/minute-transcript.js';

const dry = process.argv.includes('--dry');
const notify = process.argv.includes('--notify');

// 飞书默认名 / 明写测试的
const TEST_PAT = /^新录音(\s*\d+)?(\s|$)|测试|自测|彩排|试录|demo\s*test/i;
// 只巡检最近这些天录的场次（2026-08-13 他定：「太早的没有用」）。
// 用**妙记自己的 start_time**判，不用标题里的日期——标题里那个可能是播客期号
// （「养虾夜话：03-17｜30只AI龙虾…」的 03-17 是节目期号，不是他录音的日子）。
const MAX_AGE_DAYS = Number(process.argv.find((a) => a.startsWith('--max-age='))?.slice(10) || 60);

// 面试求职类：本地一份都不留（他 2026-08-12 定）
const INTERVIEW_PAT = /一面|二面|三面|交叉面|面试|mock|求职课|职业规划|leader沟通/i;

function judge(title) {
  if (INTERVIEW_PAT.test(title)) return { verdict: 'test', reason: '面试/求职类，按约定不进检索' };
  if (TEST_PAT.test(title)) return { verdict: 'test', reason: '标题是飞书默认名或写着测试' };
  return { verdict: 'keep', reason: '标题是你自己起的名字' };
}

const db0 = getDatabase();
const knownSessions = new Set(db0.prepare('SELECT file_token FROM transcript_sessions').all().map((r) => r.file_token));
const knownWatch = new Set(db0.prepare('SELECT minute_token FROM minute_watchlist').all().map((r) => r.minute_token));
db0.close();
const fps = loadFingerprints();

console.log(`库里已有 ${knownSessions.size} 场，清单里已见过 ${knownWatch.size} 条`);

const docs = await searchDocs('智能纪要', { count: 50 });
console.log(`云盘里的智能纪要 ${docs.length} 份，逐份查回链…`);

const fresh = [];
for (const d of docs) {
  const title = d.title.replace(/^智能纪要[：:]/, '').trim();
  let token = null;
  try { token = await minuteTokenOfDoc(d.feishuId); } catch { /* 读不到就跳过 */ }
  if (!token) continue;                       // 不是妙记生成的文档
  if (knownWatch.has(token) || knownSessions.has(token)) continue;   // 见过了
  const info = await getMinuteInfo(token).catch(() => null);
  const startedAt = Number(info?.start_time) || null;
  const ageDays = startedAt ? (Date.now() - startedAt) / 864e5 : null;
  if (ageDays != null && ageDays > MAX_AGE_DAYS) {
    console.log(`  ⏳ ${title} — 录于 ${Math.round(ageDays)} 天前，超过 ${MAX_AGE_DAYS} 天不再巡检`);
    if (!dry) record({ token, title, url: `https://my.feishu.cn/minutes/${token}` }, 'skipped', `太早（${Math.round(ageDays)} 天前）`);
    continue;
  }
  fresh.push({
    token, title, summaryDoc: d.feishuId,
    url: `https://my.feishu.cn/minutes/${token}`,
    durationMin: info?.duration ? Math.round(Number(info.duration) / 60000) : null,
    ...judge(title),
  });
}

if (!fresh.length) { console.log('没有新场次。'); process.exit(0); }
console.log(`发现 ${fresh.length} 场新的\n`);

const done = [];
for (const f of fresh) {
  if (f.verdict === 'test') {
    console.log(`  🚫 ${f.title} — ${f.reason}`);
    if (!dry) record(f, 'skipped', null);
    done.push(f);
    continue;
  }

  let body;
  try { body = await fetchMinuteTranscript(f.token); }
  catch (e) { console.log(`  ❌ ${f.title} — ${e.message}`); if (!dry) record(f, 'failed', e.message); done.push({ ...f, failed: e.message }); continue; }

  const chunks = chunkTurns(splitTurns(body));
  if (!chunks.length) { console.log(`  ⚠️  ${f.title} — 切不出发言轮`); if (!dry) record(f, 'failed', '切不出发言轮'); done.push({ ...f, failed: '切不出发言轮' }); continue; }

  // 同一场录音可能已经走 docx 那路入过库，标题却对不上——只能比正文指纹
  const fp = fingerprint(chunks[0].text);
  const dup = [...fps.keys()].find((k) => k.slice(0, 60) === fp.slice(0, 60));
  if (dup) {
    console.log(`  ⏭  ${f.title} — 跟已入库的同一场重复`);
    if (!dry) record({ ...f, verdict: 'dup', reason: '正文指纹跟已入库的某场一致' }, 'skipped', null);
    done.push({ ...f, verdict: 'dup' });
    continue;
  }

  f.chars = body.length;
  if (dry) { console.log(`  [dry] ${f.title} — ${body.length} 字 → ${chunks.length} 片`); done.push(f); continue; }

  const date = dateOf(f.title);
  await saveChunks({ fileToken: f.token, title: f.title, date, docUrl: f.url, chunks });

  // 索引文本用它自己的智能纪要正文——纪要当材料嫌它提炼过头，当索引恰好合适
  let indexText = '', indexSource = 'transcript_head', summaryUrl = null;
  try {
    const r = await feishuFetch(`/open-apis/docx/v1/documents/${f.summaryDoc}/raw_content`, { preferUser: true });
    const t = (r?.content ?? '').toString().trim();
    if (t.length > 100) { indexText = t; indexSource = 'summary'; summaryUrl = `https://my.feishu.cn/docx/${f.summaryDoc}`; }
  } catch { /* 抓不到就用开头兜底 */ }
  if (!indexText) indexText = chunks.slice(0, 3).map((c) => c.text).join('\n').slice(0, 2000);

  await saveSessionIndex({
    fileToken: f.token, title: f.title, date, indexText, indexSource,
    summaryUrl, docUrl: f.url, chunkCount: chunks.length,
  });
  fps.set(fp, f.token);
  record(f, 'ingested', null);
  f.chunks = chunks.length;
  console.log(`  ✅ ${f.title} — ${chunks.length} 片已入库`);
  done.push(f);
}

function record(f, status, note) {
  const db = getDatabase();
  db.prepare(`INSERT OR REPLACE INTO minute_watchlist
    (minute_token, title, summary_doc, minute_url, duration_min, chars, verdict, reason, status, note, decided_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(f.token, f.title, f.summaryDoc, f.url, f.durationMin ?? null, f.chars ?? null,
      f.verdict, f.reason, status, note);
  db.close();
}

// ── 发一条清单给他 ─────────────────────────────────────
const kept = done.filter((f) => f.verdict === 'keep' && f.chunks);
const skipped = done.filter((f) => f.verdict === 'test');
const dups = done.filter((f) => f.verdict === 'dup');
const failed = done.filter((f) => f.failed);

const lines = ['📼 妙记巡检'];
if (kept.length) {
  lines.push(`\n已入库 ${kept.length} 场：`);
  kept.forEach((f) => lines.push(`· ${f.title}（${f.durationMin ?? '?'} 分，${f.chunks} 片）`));
}
if (skipped.length) {
  // 判为不要的只列前几条：全都记在 minute_watchlist 里，消息里刷屏没意义
  lines.push(`\n判为不要 ${skipped.length} 场：`);
  skipped.slice(0, 5).forEach((f) => lines.push(`· ${f.title}（${f.durationMin ?? '?'} 分）— ${f.reason}`));
  if (skipped.length > 5) lines.push(`· …另有 ${skipped.length - 5} 场同理（面试/测试）`);
}
if (dups.length) lines.push(`\n跳过重复 ${dups.length} 场（同一录音已从别的入口进过库）`);
// 抓失败的只落日志和 watchlist，**不进通知**——他 2026-08-13 定：「这只抓失败就算了」。
// 失败多半是妙记本身没转写成功，催他也没用；要查就看 watch-minutes.log。
if (failed.length) console.log(`（抓失败 ${failed.length} 场，已记进清单不通知：${failed.map((f) => f.title).join('、')}）`);
lines.push('\n判错了跟我说一句就改（哪场该收、哪场是测试）。');
const text = lines.join('\n');

console.log(`\n${'─'.repeat(50)}\n${text}`);

if (notify && !dry && (kept.length || skipped.length)) {
  // 归口「KW · 知识检索」群，不发私聊——2026-08-13 何雨轩定：定时提醒按职能进群，
  // 私聊只留人对话。妙记入库属于知识检索，不是数据复盘。
  // chat_id 不进公开仓（repo 是 PUBLIC）——必填、无内置默认，缺了直接炸而不是发错群。
  const SEARCH_CHAT = process.env.KW_SEARCH_CHAT_ID;
  if (!SEARCH_CHAT) throw new Error('缺 KW_SEARCH_CHAT_ID（backend/.env）——「KW · 知识检索」群 chat_id，无内置默认');
  try {
    const { feishuFetch } = await import('../src/services/feishu-auth.js');
    await feishuFetch('/open-apis/im/v1/messages', {
      method: 'POST', query: { receive_id_type: 'chat_id' },
      body: { receive_id: SEARCH_CHAT, msg_type: 'text', content: JSON.stringify({ text }) },
    });
    console.log('\n已发到「KW · 知识检索」群。');
  } catch (e) { console.log(`\n⚠️ 飞书没发出去：${e.message}`); }
}
