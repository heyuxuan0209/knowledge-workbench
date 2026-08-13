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
// 平台前缀 + 可选的种类后缀 + 日期 + 扩展名。
// 种类后缀是 2026-08-11 加的：公众号除了 mp-<日期>.xlsx（全号汇总）还多了
// mp-detail-*.xls / mp-detail-nonotice-*.xls（逐篇明细）和 mp-engage-*.csv（逐篇互动）。
// 旧正则只认 `<平台>-<日期>.(xlsx|csv)`，这三份新文件**一份都不会被下载**，
// 于是逐篇数据传到了云盘却永远进不了表——跟"数据在云盘躺 8 天"是同一类失败。
// 注意 xhs 必须排在 x 前面：正则的 | 是有序的，`x` 先命中会把 `xhs-…` 卡死在下一段上。
const SNAP_PATTERN = /^(xhs|mp|zhihu|dy|sph|x)(?:-[a-z]+)*-(\d{8})\.(xlsx|xls|csv)$/;
const TOLERANCE_DAYS = 1.5;   // 快照实际天数与目标档位的最大偏差
const SNAP_HOUR_CST = 10;     // Mac launchd 10:07 取数，按当天 10:00 北京时间折算
const NEXT_STAGE = { 3: '待回收D7', 7: '待回收D30', 30: '已回收完' };

const dry = process.argv.includes('--dry');
const notify = process.argv.includes('--notify');
const force = process.argv.includes('--force');   // 覆盖已填过的档位（默认不覆盖手填值）
const log = (...a) => console.log(...a);
// 弯引号也要去：表里手打的是「可能“说清楚”只对了一半」，公众号后台存的是直引号，
// 只去直引号这两个串就永远对不上（2026-08-11 实测，一篇公众号文章因此回填不进去）。
const normTitle = (s) => String(s ?? '').replace(/[\s,，。？?！!、：:；;「」【】《》〈〉""''“”‘’·~～—\-()（）]/g, '').toLowerCase();

/** 各平台导出里的发布时间写法不统一，统一折算成毫秒（一律按北京时间解读） */
function pubToMs(pub) {
  const s = String(pub ?? '').trim();
  const p2 = (x) => String(x).padStart(2, '0');
  let m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
  if (m) return Date.parse(`${m[1]}-${p2(m[2])}-${p2(m[3])}T${p2(m[4])}:${m[5]}:00+08:00`);
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return Date.parse(`${m[1]}-${p2(m[2])}-${p2(m[3])}T00:00:00+08:00`);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`);
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return Date.parse(`${m[1]}-${p2(m[2])}-${p2(m[3])}T${p2(m[4] ?? 0)}:${m[5] ?? '00'}:00+08:00`);
  return NaN;
}
/** 北京时间的「哪一天」 */
const dayOf = (ms) => (Number.isFinite(ms) ? new Date(ms + 8 * 3600e3).toISOString().slice(0, 10) : null);
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

/** 在一张快照里找这条内容：精确标题 → 前缀 → **按发布日兜底**。
 *
 *  为什么要有第三级（2026-08-11 实测）：视频号后台**根本不给标题**，列表里那一行是视频正文；
 *  知乎「想法」同理。而表里记的「平台化标题」是她自己起的短标题——
 *  「把 X 上的英文长视频，4 分钟读完」对上「经常刷到30分钟以上的英文长视频，现场读起来头疼…」，
 *  靠任何字符串相似度都不可能匹配上，视频号 3 条因此一条都填不进去。
 *  但**发布时间是准的**（导出器一直按"发布时间是入表匹配主键"抓到分），所以按发布日兜底：
 *  只有当天该平台**恰好只有一条**时才敢认——多条就宁可报"匹配不上"让人看一眼，不瞎猜。
 *
 *  前缀阈值 12 → 8：「你相信AI能一键出片吗」归一化才 10 个字，卡在 12 上直接被判死。
 *  放宽的代价是系列稿（…启动1/…启动2）可能撞前缀，所以前缀候选**多于一条时先用发布日消歧**。 */
const PREFIX_MIN = 8;
function lookup(byTitle, key, pubMs) {
  if (byTitle[key]) return byTitle[key];
  const entries = Object.entries(byTitle);
  const day = dayOf(pubMs);
  const sameDay = (v) => day != null && v?.pub && dayOf(pubToMs(v.pub)) === day;

  if (key.length >= PREFIX_MIN) {
    const head = key.slice(0, PREFIX_MIN);
    const cands = entries
      .filter(([k]) => k.length >= PREFIX_MIN && (k.startsWith(head) || key.startsWith(k.slice(0, PREFIX_MIN))))
      .map(([, v]) => v);
    if (cands.length === 1) return cands[0];
    if (cands.length > 1) {
      const narrowed = cands.filter(sameDay);
      if (narrowed.length === 1) return narrowed[0];
    }
  }

  const byDay = entries.map(([, v]) => v).filter(sameDay);
  return byDay.length === 1 ? byDay[0] : null;
}

/** 在该平台的所有快照里，挑第一张「到了第 stage 天之后」且离档位最近的。
 *  只往后不往前——拿第 5.6 天的数填 D7 会把数字记小，宁可等明天那张快照。 */
function pickSnapshot(snapsOfPlatform, key, pubMs, stage) {
  let best = null;
  let nearest = null;   // 不满足"已过档位"时用来解释还差多少
  for (const [date, byTitle] of Object.entries(snapsOfPlatform || {})) {
    const hit = lookup(byTitle, key, pubMs);
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
  // 「这个平台压根没有导出数据」和「有数据但这条对不上」是两回事，必须分开。
  // 由来（2026-08-12 首次线上干跑）：X 的导出器默认没启用，于是表里 9 行 X **每天**都会出现在
  // 「❓匹配不上」里——一个天天亮的红灯会把真红灯一起淹掉，而真红灯（某条标题改过了、
  // 某个平台改版了）恰恰是这份通知唯一的价值。所以没数据的平台按平台**折成一行**，
  // 不逐行刷屏；「匹配不上」那一栏只留真正需要人看一眼的。
  const noSnapshotByPlatform = new Map();

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

    // 该平台一张快照都没有＝没有导出器/没启用，不是这一条的问题，别混进「匹配不上」
    if (!snapshots[platform] || !Object.keys(snapshots[platform]).length) {
      noSnapshotByPlatform.set(platform, (noSnapshotByPlatform.get(platform) || 0) + 1);
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
    // d.engaged = 这份快照里**确实读到了逐篇互动数**（公众号 mp-engage 才有这个标记）。
    // 原来的规则是「只在真拿到互动数时才写」，而公众号那时根本拿不到，只能一直留空；
    // 现在拿到了，就算真的是 0 赞 0 评也该如实写 0——那是"没人互动"，不是"没数据"。
    const hasInteraction = d.engaged === true || interactions > 0;
    const fields = {};
    const put = (name, value) => { if (fieldNames.has(name)) fields[name] = value; };
    put(`D${stage}曝光`, d.exposure);
    put(`D${stage}涨粉`, d.fans);
    if (d.ctr) put(`D${stage}点击率`, d.ctr);
    // 互动率的分母＝「真实消费量」，不是曝光（2026-08-13 她拍板统一口径）。
    // 小红书的「曝光」是封面从信息流划过的次数，那一段已经有「封面点击率」在管；
    // 拿它当互动率分母，会把小红书系统性压低一个数量级，且与抖音/视频号的「播放量」
    // 根本不是一回事，横向比出来的高低是假的。实测同一条 8/5 内容：
    // D3(分母=观看119)15.13% vs D7(分母=曝光899)2.22%，看着像暴跌 85%，其实只是换了分母。
    // 判据用 ctr 而非平台名：有封面点击率 ⇒ 该平台的 exposure 是展示量，此时改用 view。
    const engageBase = (d.ctr && d.view > 0) ? d.view : d.exposure;
    // 只有真拿到互动数才写互动率——公众号导出目前没有逐篇互动，写 0 会污染复盘
    if (hasInteraction && engageBase > 0) put(`D${stage}互动率`, Number((interactions / engageBase).toFixed(4)));
    // 互动数和分发口径要**一起**写进「传播」：原来是二选一，一旦有互动数就把 extra 丢掉，
    // 而公众号最该被看见的恰恰在 extra 里——「送达64 消息内打开11 分享带来85 完读率50.6%」。
    // 只看「阅读101」会把一篇好文判成扑街，看到送达才知道是盘子小、不是内容差。
    const spread = [
      hasInteraction ? `赞${d.like} 评${d.comment} 藏${d.fav} 分享${d.share}` : '',
      // 分母是什么必须写进去。否则半年后没人知道这个百分比是按曝光还是按观看算的，
      // 复盘时只能靠猜——这正是这次要修的那个坑。
      hasInteraction && engageBase > 0 ? `互动率分母=${d.ctr && d.view > 0 ? `观看${d.view}` : `曝光${d.exposure}`}` : '',
      d.extra || '',
    ].filter(Boolean).join(' ');
    if (spread) put(`D${stage}传播`, `${spread}｜快照${best.date}(第${best.age.toFixed(1)}天)`);
    put('回收状态', NEXT_STAGE[stage] ?? '已回收完');

    const desc = `${label} D${stage} → 曝光${d.exposure}`
      + (hasInteraction ? ` 互动率${(interactions / (engageBase || 1) * 100).toFixed(2)}%（分母${d.ctr && d.view > 0 ? `观看${d.view}` : `曝光${d.exposure}`}）` : ' (无互动数据)')
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
  // 没有导出数据的平台：一个平台一行，不逐行刷屏
  const noSnapLines = [...noSnapshotByPlatform.entries()]
    .map(([p, n]) => `${p} ${n} 行 — 该平台没有导出数据（没有导出器或未启用），非本条的问题`);
  log(section('已有值·跳过', alreadyFilled));
  log(section('未到取数窗口', notYetDue));
  log(section('ℹ️ 该平台无导出数据', noSnapLines));
  log(section('⚠️ 已错过取数窗口（那几天没有快照）', missedWindow));
  log(section('❓ 快照里匹配不上（标题改过？）', noMatch));
  log(`\n合计：回填 ${filled.length} 行，未到期 ${notYetDue.length}，错过窗口 ${missedWindow.length}，`
    + `匹配不上 ${noMatch.length}，无导出数据 ${[...noSnapshotByPlatform.values()].reduce((a, b) => a + b, 0)}`);

  // 通知只在**有人需要做点什么**时才发：回填了（好消息）、错过窗口、或匹配不上（要人看一眼）。
  // 「该平台没有导出数据」不进这个条件——那是个已知的常态，天天推一遍只会让人不再看这条通知。
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
