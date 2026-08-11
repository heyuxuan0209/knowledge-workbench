// 把 platform-export 每天落到飞书云盘的快照，自动回填进「发布记录」多维表格。
//
//   node scripts/backfill-from-exports.mjs [--dry] [--notify]
//
// 背景（2026-08-11 发现）：Mac 每天 10:07 导出 5 个平台并上传云盘，但「入表」这一环
// 原设计是「云端 Claude 据群通知手动填」——从来没自动化过，数据在云盘躺了 8 天没人捡。
//
// 口径纪律（别"优化"掉）：
// - 每行按「回收状态」里的档位（D3/D7/D30）去找**发布后第 N 天那张快照**，不是拿最新累计值硬填。
//   偏差超过 TOLERANCE_DAYS 就跳过并如实报"错过取数窗口"，不将就。
// - 互动率只在**真拿到互动数**时才写。公众号导出目前只有阅读人数、没有逐篇互动，
//   写 0 会把一篇好文章记成零互动——宁可留空。
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { feishuFetch } from '../src/services/feishu-auth.js';

const APP = 'QIlkbwmGma9Tb1sRyAicfZeEnjb';
const TABLE = 'tblL11CZzfQSxIy9';
const REVIEW_CHAT = process.env.KW_REVIEW_CHAT_ID || 'oc_1cce937115d3a6771d9dd3d497e0be3b';
const PYTHON = process.env.KW_PYTHON || '/home/bot/.venv-kw/bin/python3';
const CACHE = process.env.KW_EXPORT_CACHE || path.join(os.homedir(), '.cache/kw-exports');
const SNAP_PATTERN = /^(xhs|mp|zhihu|dy|sph)-(\d{8})\.(xlsx|csv)$/;
const TOLERANCE_DAYS = 1.5;   // 快照实际天数与目标档位的最大偏差
const SNAP_HOUR_CST = 10;     // Mac launchd 10:07 取数，按当天 10:00 北京时间折算
const NEXT_STAGE = { 3: '待回收D7', 7: '待回收D30', 30: '已回收完' };

const dry = process.argv.includes('--dry');
const notify = process.argv.includes('--notify');
const force = process.argv.includes('--force');   // 覆盖已填过的档位（默认不覆盖手填值）
const log = (...a) => console.log(...a);
const normTitle = (s) => String(s ?? '').replace(/[\s,，。？?！!、：:；;「」【】""''·~—\-()（）]/g, '').toLowerCase();
const flat = (v) => (Array.isArray(v) ? v.map((x) => x?.text ?? x).join('') : (v?.text ?? v));

/** 快照日期(YYYYMMDD) → 取数时刻的毫秒时间戳 */
function snapshotTime(d) {
  return Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${String(SNAP_HOUR_CST).padStart(2, '0')}:00:00+08:00`);
}

async function userToken() {
  const { getUserAccessTokenIfConnected } = await import('../src/services/feishu-user-auth.js');
  return getUserAccessTokenIfConnected();
}

/** 递归找出云盘里所有平台导出文件（Mac 侧 FOLDER_TOKEN 指哪儿都能找到） */
async function findExportFiles() {
  const found = [];
  const walk = async (token, depth) => {
    let page = null;
    const files = [];
    do {
      const r = await feishuFetch('/open-apis/drive/v1/files', {
        query: { page_size: 200, ...(token ? { folder_token: token } : {}), ...(page ? { page_token: page } : {}) },
        preferUser: true,
      });
      files.push(...(r.files || []));
      page = r.has_more ? r.next_page_token : null;
    } while (page);
    for (const f of files) {
      if (f.type === 'folder') { if (depth > 0) await walk(f.token, depth - 1); }
      else if (SNAP_PATTERN.test(f.name)) found.push(f);
    }
  };
  await walk(null, 2);
  return found;
}

/** 只下载本地缓存里没有的快照 */
async function syncSnapshots() {
  fs.mkdirSync(CACHE, { recursive: true });
  const files = await findExportFiles();
  const tok = await userToken();
  let added = 0;
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    const dest = path.join(CACHE, f.name);
    if (fs.existsSync(dest)) continue;
    const res = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${f.token}/download`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!res.ok) { log(`  ⚠️ 下载失败 ${f.name} (HTTP ${res.status})`); continue; }
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    added += 1;
  }
  return { total: seen.size, added };
}

function parseSnapshots() {
  const out = execFileSync(PYTHON, [path.join(import.meta.dirname, 'parse-exports.py'), CACHE], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

async function fetchRecords() {
  let page = null;
  const items = [];
  do {
    const r = await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
      query: { page_size: 100, ...(page ? { page_token: page } : {}) },
    });
    items.push(...(r.items || []));
    page = r.has_more ? r.page_token : null;
  } while (page);
  return items;
}

async function fetchFieldNames() {
  const r = await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/fields`, { query: { page_size: 200 } });
  return new Set(r.items.map((f) => f.field_name));
}

/** 在一张快照里找这条内容：先精确匹配归一化标题，再退回前缀匹配。
 *  知乎「想法」、抖音等没有独立标题，导出里塞的是正文截断，跟表里记的长度对不上。 */
function lookup(byTitle, key) {
  if (byTitle[key]) return byTitle[key];
  if (key.length < 12) return null;
  for (const [k, v] of Object.entries(byTitle)) {
    if (k.length >= 12 && (k.startsWith(key.slice(0, 12)) || key.startsWith(k.slice(0, 12)))) return v;
  }
  return null;
}

/** 在该平台的所有快照里，挑第一张「到了第 stage 天之后」且离档位最近的。
 *  只往后不往前——拿第 5.6 天的数填 D7 会把数字记小，宁可等明天那张快照。 */
function pickSnapshot(snapsOfPlatform, key, pubMs, stage) {
  let best = null;
  let nearest = null;   // 不满足"已过档位"时用来解释还差多少
  for (const [date, byTitle] of Object.entries(snapsOfPlatform || {})) {
    const hit = lookup(byTitle, key);
    if (!hit) continue;
    const age = (snapshotTime(date) - pubMs) / 864e5;
    const cand = { date, age, gap: Math.abs(age - stage), data: hit };
    if (!nearest || cand.gap < nearest.gap) nearest = cand;
    if (age < stage) continue;
    if (!best || cand.gap < best.gap) best = cand;
  }
  return best ?? (nearest ? { ...nearest, early: true } : null);
}

const main = async () => {
  const sync = await syncSnapshots();
  log(`快照同步：云盘 ${sync.total} 份，新下载 ${sync.added} 份 → ${CACHE}`);

  const { snapshots, errors } = parseSnapshots();
  for (const e of errors) log(`  ⚠️ 解析失败 ${e}`);
  log('可用快照：' + Object.entries(snapshots).map(([p, s]) => `${p} ${Object.keys(s).length} 天`).join('，'));

  const fieldNames = await fetchFieldNames();
  const records = await fetchRecords();
  const pending = records.filter((r) => /待回收/.test(flat(r.fields['回收状态']) || ''));
  log(`\n待回收 ${pending.length} 行：\n`);

  const filled = [];
  const missedWindow = [];
  const noMatch = [];
  const alreadyFilled = [];
  const notYetDue = [];

  for (const rec of pending) {
    const f = rec.fields;
    const title = flat(f['平台化标题']);
    const platform = flat(f['平台']);
    const pubMs = f['发布时间'];
    const stage = Number((flat(f['回收状态']) || '').match(/D(\d+)/)?.[1]);
    const label = `[${platform}] ${title}`;
    if (!pubMs || !stage) { noMatch.push(`${label} — 缺发布时间或回收档位`); continue; }

    // 已经有人（多半是他自己或我手动）填过这一档就别碰——自动覆盖手填值是不可接受的
    if (!force && f[`D${stage}曝光`] != null && f[`D${stage}曝光`] !== '') {
      alreadyFilled.push(`${label} D${stage} — 已有值 ${flat(f[`D${stage}曝光`])}，跳过（--force 可覆盖）`);
      continue;
    }

    const best = pickSnapshot(snapshots[platform], normTitle(title), pubMs, stage);
    if (!best) { noMatch.push(`${label} — 该平台快照里找不到同名条目`); continue; }

    const ageNow = (Date.now() - pubMs) / 864e5;
    if (best.early || best.gap > TOLERANCE_DAYS) {
      const line = `${label} D${stage} — 现龄 ${ageNow.toFixed(1)} 天，最近快照 ${best.date} 是第 ${best.age.toFixed(1)} 天`;
      (best.early ? notYetDue : missedWindow).push(line);
      continue;
    }

    const d = best.data;
    const interactions = d.like + d.comment + d.fav + d.share;
    const hasInteraction = interactions > 0 || d.like || d.comment || d.fav || d.share;
    const fields = {};
    const put = (name, value) => { if (fieldNames.has(name)) fields[name] = value; };
    put(`D${stage}曝光`, d.exposure);
    put(`D${stage}涨粉`, d.fans);
    if (d.ctr) put(`D${stage}点击率`, d.ctr);
    // 只有真拿到互动数才写互动率——公众号导出目前没有逐篇互动，写 0 会污染复盘
    if (hasInteraction && d.exposure > 0) put(`D${stage}互动率`, Number((interactions / d.exposure).toFixed(4)));
    const spread = hasInteraction
      ? `赞${d.like} 评${d.comment} 藏${d.fav} 分享${d.share}`
      : (d.extra || '');
    if (spread) put(`D${stage}传播`, `${spread}｜快照${best.date}(第${best.age.toFixed(1)}天)`);
    put('回收状态', NEXT_STAGE[stage] ?? '已回收完');

    const desc = `${label} D${stage} → 曝光${d.exposure}`
      + (hasInteraction ? ` 互动率${(interactions / (d.exposure || 1) * 100).toFixed(2)}%` : ' (无互动数据)')
      + ` [快照${best.date}·第${best.age.toFixed(1)}天]`;
    if (dry) { log(`  [dry] ${desc}`); }
    else {
      await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${rec.record_id}`, {
        method: 'PUT', body: { fields },
      });
      log(`  ✅ ${desc}`);
    }
    filled.push(desc);
  }

  const section = (t, arr) => (arr.length ? `\n${t}（${arr.length}）：\n` + arr.map((x) => `  · ${x}`).join('\n') : '');
  log(section('已有值·跳过', alreadyFilled));
  log(section('未到取数窗口', notYetDue));
  log(section('⚠️ 已错过取数窗口（那几天没有快照）', missedWindow));
  log(section('❓ 快照里匹配不上（标题改过？）', noMatch));
  log(`\n合计：回填 ${filled.length} 行，未到期 ${notYetDue.length}，错过窗口 ${missedWindow.length}，匹配不上 ${noMatch.length}`);

  if (notify && !dry && (filled.length || missedWindow.length || noMatch.length)) {
    const text = `📊 发布记录自动回填（${new Date().toISOString().slice(0, 10)}）\n\n`
      + (filled.length ? `已回填 ${filled.length} 行：\n${filled.map((x) => `• ${x}`).join('\n')}\n` : '本轮无新数据到期。\n')
      + section('⚠️ 已错过取数窗口', missedWindow)
      + section('❓ 匹配不上', noMatch);
    await feishuFetch('/open-apis/im/v1/messages', {
      method: 'POST', query: { receive_id_type: 'chat_id' },
      body: { receive_id: REVIEW_CHAT, msg_type: 'text', content: JSON.stringify({ text }) },
    });
    log('已推送到「KW · 数据复盘」群');
  }
};

await main();
