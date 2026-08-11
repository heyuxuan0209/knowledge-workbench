// 微信视频号助手导出每条视频数据 → sph-YYYYMMDD.csv。
// 路径：channels.weixin.qq.com → 内容管理 → 视频（platform/post/list）。登录态存 ~/.playwright-profiles/sph（微信扫码）。
//
// 实测坑（2026-08-06）：
//  1) 视频列表在 **iframe**（/micro/content/post/list）里，主 frame 只有左侧导航——所以读主 frame 啥都没有，
//     必须取那个子 frame 的 innerText。（子 frame 有反注入守卫，复杂 DOM 遍历会被打断，但简单读 innerText 稳。）
//  2) 后台**没有批量导出**，视频列表是卡片：标题 + 发布时间(精确到分) + **5 个无标签数字** + 操作按钮。
//     5 个数字从左到右（用户 2026-08-06 对着后台核过，图标无字靠她认）：
//       播放量 / 在看 / 评论 / 转发 / 点赞  —— 见 METRIC_KEYS（按位置映射）。
//     注意：视频号列表**不显示收藏**（收藏列留空），但多一个微信特有的「在看」指标，单列保留。
//     （曾误以为"前3=播放/点赞/评论"，被首页「昨日数据」的标签顺序带偏——列表顺序和它不一样，已按真机纠正。）
//  3) ⚠️ 视频号登录态和微信绑定、比公众号更易失效，且**别反复自动开**（风控）——每天只跑一次。
import { pathToFileURL } from 'url';
import { join } from 'path';
import { config, todayStamp } from './lib/config.mjs';
import { openProfile, snap, detectWithReload } from './lib/browser.mjs';
import { writeCsv, dumpRaw } from './lib/scrape.mjs';

const DATA_URL = 'https://channels.weixin.qq.com/platform/post/list';

// 单次判断登录态（读主 frame innerText，精确匹配；unknown 不当已登录，判不准通知扫码不硬闯）。
async function detectSph(page) {
  if (/\/login|\/auth/i.test(page.url())) return 'out';
  const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (/扫码登录|扫描二维码|使用微信.*扫|请使用微信|登录视频号/.test(txt)) return 'out';
  if (/内容管理|数据中心|视频号.*助手|带货中心|互动管理/.test(txt)) return 'in';
  return 'unknown';
}

// 返回 'in'（已登录）/ 'out'（确认看到登录页）/ 'unknown'（判不准，页面没读到内容）。
// 'out' 和 'unknown' 都不硬闯，但上层通知要分开说——扫码 vs 大概率只是没加载出来。
async function ensureLoggedIn(page, { waitForLogin = false } = {}) {
  await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  let status = await detectWithReload(page, detectSph, { url: DATA_URL });
  if (status === 'in') return 'in';
  if (!waitForLogin) return status;

  console.log('\n👉 请打开手机微信，扫描弹出的 Chrome 窗口里的二维码登录视频号助手。');
  console.log('   登录成功后脚本会自动继续导出，最多等 15 分钟…\n');
  const deadline = Date.now() + config.loginWaitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    status = await detectSph(page);
    if (status === 'in') break;
  }
  if (status !== 'in') return status;
  await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('[sph] 登录成功，开始读视频列表…');
  return 'in';
}

// 视频号 CSV 列（含微信特有的「在看」；收藏视频号列表不给、留空；涨粉是账号级、逐条留空）。
const SPH_COLUMNS = ['标题', '发布时间', '曝光/播放量', '点赞', '评论', '分享/转发', '在看', '收藏', '涨粉'];
// 5 个无标签数字，按屏幕从左到右第 1..5 个映射到的列（用户 2026-08-06 对着后台核过）。
const METRIC_KEYS = ['曝光/播放量', '在看', '评论', '分享/转发', '点赞'];
const dtRe = /^\d{4}年\d{2}月\d{2}日\s+\d{1,2}:\d{2}$/; // 发布时间（精确到分，入表匹配主键）
const NUM = /^[\d,]+(\.\d+)?万?$/;
const ACTIONS = new Set(['置顶', '取消置顶', '分享', '弹幕管理', '评论管理', '修改描述和封面', '可见权限', '删除', '数据', '编辑', '推广']);
const HEADER = new Set(['视频管理', '特效创作工具', '发表视频', '「秒剪」自动字幕，免费不限次数']);
// 卡片上的状态徽章，夹在**发布时间和 5 个数字之间**。
// 由来（2026-08-11 实测）：声明了原创的视频多出一行「已声明原创」，卡在时间和数字中间，
// 于是「时间后紧跟最多 5 个数字」这条一读到它就停手 → 那条的指标全空，而它和后面 5 个数字
// 一起被当成**下一条的标题**（sph-20260811.csv 里两条标题以「已声明原创 598 3 1 6 10」开头）。
// 结果是双杀：这条没数据、下一条标题对不上表、回填两条都填不进去。
const BADGES = new Set(['已声明原创', '声明原创', '原创', '已参与', '广告', '合集']);
const stopLine = (l) => /腾讯微信视频号运营规范|Tencent Inc|^©/.test(l);

// 解析视频号 iframe 的 innerText → { declared, recs }。
// 结构：视频 (N) / 合集 (0) / …header… / 发表视频 / [标题 / 发布时间 / 5数字 / 操作按钮] × N / 页脚。
export function parseChannelsVideos(text) {
  let lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const cLine = lines.find((l) => /^视频\s*\(\d+\)/.test(l));
  const declared = cLine ? Number(cLine.match(/\((\d+)\)/)[1]) : null;
  const start = lines.findIndex((l) => l === '发表视频');
  if (start >= 0) lines = lines.slice(start + 1);
  const recs = [];
  let i = 0;
  while (i < lines.length) {
    if (stopLine(lines[i])) break;
    // 标题块：收集到发布时间行为止，跳过操作按钮/表头/「视频(N)」「合集(0)」
    const titleParts = [];
    while (i < lines.length && !dtRe.test(lines[i])) {
      const l = lines[i];
      if (stopLine(l)) { i = lines.length; break; }
      if (!ACTIONS.has(l) && !HEADER.has(l) && !BADGES.has(l) && !/^(合集|视频)\s*\(\d+\)/.test(l)) titleParts.push(l);
      i++;
    }
    if (i >= lines.length) break;
    const datetime = lines[i]; i++;
    // 发布时间和数字之间可能夹着状态徽章（已声明原创…），先跳过它们再收数字
    while (i < lines.length && BADGES.has(lines[i])) i++;
    // 发布时间后紧跟最多 5 个数字
    const nums = [];
    while (i < lines.length && nums.length < 5 && NUM.test(lines[i])) { nums.push(lines[i]); i++; }
    // 跳过该卡的操作按钮和残留徽章
    while (i < lines.length && (ACTIONS.has(lines[i]) || BADGES.has(lines[i]))) i++;
    const rec = { 标题: titleParts.join(' ').trim(), 发布时间: datetime, '曝光/播放量': '', 点赞: '', 评论: '', '分享/转发': '', 在看: '', 收藏: '', 涨粉: '' };
    METRIC_KEYS.forEach((k, idx) => { if (nums[idx] != null) rec[k] = nums[idx]; });
    if (rec.标题 || nums.length) recs.push(rec);
  }
  return { declared, recs };
}

// 取视频列表所在的子 frame 的 innerText（等它出现且有内容）。
async function readListFrameText(page) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => /micro\/content\/post/.test(f.url()));
    if (frame) {
      const txt = await frame.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (/视频\s*\(\d+\)|发表视频/.test(txt)) return txt;
    }
    await page.waitForTimeout(1500);
  }
  return null;
}

export async function exportSph({ waitForLogin = false } = {}) {
  const stamp = todayStamp();
  const target = join(config.exportDir, `sph-${stamp}.csv`);
  const ctx = await openProfile(config.sphProfile);
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    const status = await ensureLoggedIn(page, { waitForLogin });
    if (status !== 'in') {
      await snap(page, status === 'out' ? 'sph-login' : 'sph-undetermined');
      const err = new Error(status === 'out' ? '视频号助手需要扫码登录' : '视频号助手登录态判不准（页面没读到内容）');
      err.loginRequired = true;
      err.loginStatus = status;
      throw err;
    }

    // 已由 DATA_URL 直链进「内容管理→视频」列表页——不再点「视频」（会误命中 logo「视频号·助手」把页面导走）。
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const txt = await readListFrameText(page);
    if (!txt) {
      await snap(page, 'sph-noframe');
      throw new Error('视频号视频列表 iframe 没读到内容（后台可能改版或未加载）');
    }
    dumpRaw('sph', stamp, txt);
    const { declared, recs } = parseChannelsVideos(txt);
    if (declared && declared > 0 && recs.length === 0) {
      await snap(page, 'sph-parse0');
      throw new Error(`视频号标称 ${declared} 个视频，却解析到 0 条（卡片结构可能改版，见 _debug 截图）`);
    }

    writeCsv(target, SPH_COLUMNS, recs);
    console.log(`[sph] 视频列表解析 ${recs.length} 条${declared != null ? `（后台标称 ${declared}）` : ''} → ${target}`);
    return { platform: 'sph', file: target, stamp };
  } catch (e) {
    if (!e.loginRequired) await snap(page, 'sph-fail');
    throw e;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// 单独跑 node sph-export.mjs —— 交互式，会等你微信扫码登录（首次种登录态就用这个）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportSph({ waitForLogin: true }).then(r => console.log('OK', r)).catch(e => { console.error('FAIL', e.message); process.exit(1); });
}
