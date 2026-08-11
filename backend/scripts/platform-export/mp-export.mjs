// 公众号后台导出：内容分析（近30天）+ 阅读来源截图 + **逐篇明细** + 逐篇互动
//   → mp-YYYYMMDD.xlsx / mp-source-YYYYMMDD.png / mp-detail[-nonotice]-YYYYMMDD.xls / mp-engage-YYYYMMDD.csv
// 工单：预期半自动，微信后台登录态短命。所以先检测登录，未登录不硬闯——抛 loginRequired，
// 由 run.mjs 发飞书「公众号后台需要扫码，脚本已暂停」并退出。
// 阅读来源报表是复盘归因的关键缺口，务必尽力拿到；拿不到也不让主表失败，只在结果里标记。
import fs from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { config, todayStamp } from './lib/config.mjs';
import { openProfile, downloadTo, snap, clickFirstByText, detectWithReload } from './lib/browser.mjs';
import { writeCsv } from './lib/scrape.mjs';

const HOME = 'https://mp.weixin.qq.com/';

// 单次判断登录态（不导航、不等待）。返回 'in' | 'out' | 'unknown'。
// 已登录首页 URL 带 token=；登录页是 bizlogin / 无 token，且有扫码提示。
async function detectMp(page) {
  const url = page.url();
  if (/token=/.test(url) && !/bizlogin|loginpage/i.test(url)) return 'in';
  // 登录页文案会改（2026-08-11 实测：现在写的是「微信扫一扫，选择公众平台账号登录」，
  // 老正则一个都没命中 → 明明是二维码登录页却报「判不准」，通知里让她"直接补数"，
  // 补几次都白补，真正该做的是掏手机扫码）。所以多留几个锚：扫码提示 + 只在登出态出现的
  // 「使用账号登录 / 立即注册」入口，任一命中就算确凿的 out。
  const loginHint = await page.getByText(/扫码登录|扫一扫|使用微信.*扫描|请使用微信|使用账号登录|立即注册/).first()
    .isVisible({ timeout: 600 }).catch(() => false);
  if (loginHint) return 'out';
  return 'unknown';
}

// 确保已登录。返回 'in' / 'out'（确认看到二维码登录页）/ 'unknown'（判不准，页面没读到内容）。
// 微信后台登录态短命，所以自动跑先检测、未登录不硬闯——交给上层发通知；
// 但 'out' 和 'unknown' 通知里要分开说，别把「没加载出来」也喊成「去扫码」。
async function ensureLoggedIn(page, { waitForLogin = false } = {}) {
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  let status = await detectWithReload(page, detectMp, { url: HOME, windowMs: 8_000, label: 'mp' });
  if (status === 'in') return 'in';
  if (!waitForLogin) return status;

  // 交互式：等用户用微信扫码。扫码成功后 MP 自动跳带 token= 的首页，同页轮询即可。
  console.log('\n👉 请打开手机微信，扫描弹出的 Chrome 窗口里的二维码登录公众号后台。');
  console.log('   登录成功后脚本会自动继续导出，最多等 15 分钟…\n');
  const deadline = Date.now() + config.loginWaitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    status = await detectMp(page);
    if (status === 'in') { console.log('[mp] 登录成功，开始导出…'); return 'in'; }
  }
  return status; // 等超时也没登上：把最后一次探测结果如实带出去（out / unknown）
}

// ——————————————————————————————————————————————————————————————
// 逐篇明细（2026-08-11 补的最大缺口）
//
// 在此之前公众号只导了**全号汇总**：每天各渠道多少阅读人数。于是复盘时一篇文章只剩一个「阅读 N」，
// 而 N 小根本不等于内容差——实测某篇「101 阅读」看着像扑街，逐篇明细一开是
// 「送达 64 → 公众号消息里打开 11 → 4 人转发带来 85 次阅读，完读率 50.6%」：不是内容不行，是**分发盘子小**。
// 这两件事的复盘动作完全相反（一个改选题，一个改推送/引流），只看汇总必然误判。
//
// 怎么拿到的（探过一轮才定这个方案）：
//   数据分析 → 内容分析 有四个 tab，每个 tab 的「下载数据明细」指向同一个后台接口
//   /misc/datacubequery?action=query_download&busi=3&tmpl=<T>&args={"begin_date":…,"end_date":…}
//     tmpl=19 已通知内容   → 逐篇 16 列，**含送达人数/送达阅读率**（推送出去的文章）
//     tmpl=20 未开启通知内容 → 逐篇 14 列，无送达（没推送，只有分享/推荐来的量）
//     tmpl=14 全部        → 日期 × 渠道 的聚合，**不是逐篇**，对复盘没用，不取
//   已发表内容 tab 那个下载是另一个接口（download_summary_tendency），就是原来 mp-*.xlsx 那份。
//
// 为什么直接拼 URL 而不是点按钮：页面上那张逐篇表**是坏的**——日期控件默认停在
// 2025-09-30~2025-10-30（一年前），表里恒显示「暂无数据」，且 fill() 改不动它（自绘控件不吃 value）。
// 但下载接口本身好好的，把 args 里的日期换成最近的就能拿到全量。顺带也就不用逐篇点进详情页了——
// 一次请求覆盖全部文章，正好躲开「公众号登录态短命、逐篇点 N 次多半中途掉线」这个风险。
//
// 代价（如实记下，别以为拿全了）：性别/年龄/地域分布和平均停留时长只在**单篇详情页**里有，
// 这条路没覆盖到；单篇详情页的入口没在 DOM 里找到（列表页的数字都是 tooltip、不是链接）。
const DETAIL_TMPL = [
  { tmpl: 19, suffix: '', label: '已通知' },
  { tmpl: 20, suffix: '-nonotice', label: '未通知' },
];
// 回收档位最长 D30，取数窗口给足富余（默认 60 天）
const DETAIL_DAYS = Number(process.env.PLATFORM_EXPORT_MP_DETAIL_DAYS) || 60;

const yyyymmdd = (d) => Number(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);

async function downloadPerArticle(page, token, stamp) {
  const end = new Date();
  const begin = new Date(end.getTime() - DETAIL_DAYS * 864e5);
  const args = encodeURIComponent(JSON.stringify({ begin_date: yyyymmdd(begin), end_date: yyyymmdd(end) }));
  const files = [];
  for (const { tmpl, suffix, label } of DETAIL_TMPL) {
    const target = join(config.exportDir, `mp-detail${suffix}-${stamp}.xls`);
    const url = `${HOME}misc/datacubequery?action=query_download&busi=3&tmpl=${tmpl}&args=${args}&token=${token}&lang=zh_CN`;
    try {
      // 这是个 GET 就直接吐文件的接口，导航本身会被浏览器当成下载，goto 会「失败」——忽略它，等 download 事件。
      await downloadTo(page, () => page.goto(url).catch(() => {}), target, 45_000);
      files.push(target);
      console.log(`[mp] 逐篇明细（${label}）→ ${target}`);
    } catch (e) {
      console.warn(`[mp] 逐篇明细（${label}）没拿到：${e.message.split('\n')[0]}`);
    }
  }
  return files;
}

// ——————————————————————————————————————————————————————————————
// 逐篇互动（点赞/在看/评论/分享/送达）
//
// 上面那份逐篇明细给的是阅读侧（阅读/分享/完读/涨粉），**没有点赞、在看、评论**。这几个数在
// 内容管理 → 发表记录 里：页面把整页数据以 `publish_page = {...}` 内联在 HTML 里，比读 DOM 稳得多
// （DOM 里那些数字是 tooltip 结构，没有语义标签）。
// 字段对照（对着后台 tooltip 核过 2026-08-11）：read_num=阅读人数、old_like_num=点赞人数、
// like_num=在看、comment_num=评论、share_num=分享、sent_status.total=送达人数。
// 收藏公众号后台逐篇不给，留空（别写 0，会被复盘读成"没人收藏"）。
const ENGAGE_COLUMNS = ['标题', '发布时间', '送达人数', '曝光/播放量', '点赞', '在看', '评论', '分享/转发', '收藏', '涨粉', '内容url'];

// 从发表记录页的 HTML 里抠出内联的 publish_page JSON（导出以便单测）。
export function extractPublishPage(html) {
  const at = html.indexOf('publish_page');
  if (at < 0) return null;
  const from = html.indexOf('{', at);
  if (from < 0) return null;
  let depth = 0;
  for (let i = from; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(from, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const unescapeHtml = (s) => String(s)
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const fmtTime = (sec) => {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 把 publish_page 里的一页记录摊平成逐篇行（一次群发可能带多条文章，itemidx 区分）。
export function flattenPublishList(page0) {
  const rows = [];
  for (const item of page0?.publish_list || []) {
    let info = item.publish_info;
    if (typeof info === 'string') {
      try { info = JSON.parse(unescapeHtml(info)); } catch { continue; }
    }
    const sent = info?.sent_status?.total ?? '';
    const time = info?.sent_info?.time ? fmtTime(info.sent_info.time) : '';
    for (const a of info?.appmsg_info || []) {
      if (!a?.title) continue;
      rows.push({
        标题: a.title,
        发布时间: time,
        送达人数: sent,
        '曝光/播放量': a.read_num ?? '',
        点赞: a.old_like_num ?? '',
        在看: a.like_num ?? '',
        评论: a.comment_num ?? '',
        '分享/转发': a.share_num ?? '',
        收藏: '',  // 公众号后台逐篇不给收藏
        涨粉: '',  // 逐篇涨粉在 mp-detail 那份里（阅读后关注人数）
        内容url: a.content_url || '',
      });
    }
  }
  return rows;
}

async function harvestEngagement(page, token, stamp) {
  const target = join(config.exportDir, `mp-engage-${stamp}.csv`);
  const rows = [];
  let total = null;
  for (let begin = 0; begin < 200; begin += 10) {   // 200 是防跑飞的上限，不是真分页数
    const url = `${HOME}cgi-bin/appmsgpublish?sub=list&begin=${begin}&count=10&token=${token}&lang=zh_CN`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const data = extractPublishPage(await page.content());
    if (!data) throw new Error(`发表记录第 ${begin / 10 + 1} 页没读到 publish_page（后台可能改版）`);
    if (total == null) total = data.total_count ?? 0;
    const batch = flattenPublishList(data);
    rows.push(...batch);
    if (!batch.length || rows.length >= total) break;
  }
  if (!rows.length) throw new Error('发表记录解析到 0 篇');
  writeCsv(target, ENGAGE_COLUMNS, rows);
  console.log(`[mp] 逐篇互动 ${rows.length} 篇${total != null ? `（后台标称 ${total}）` : ''} → ${target}`);
  return target;
}

// 导航到 内容分析 页（数据 → 内容分析）。
async function gotoContentAnalysis(page) {
  await clickFirstByText(page, ['数据', '数据分析', '统计'], { timeout: 6000 });
  await page.waitForTimeout(1500);
  await clickFirstByText(page, ['内容分析', '图文分析', '内容数据'], { timeout: 6000 });
  await page.waitForTimeout(2000);
}

export async function exportMp({ waitForLogin = false } = {}) {
  const stamp = todayStamp();
  const mainTarget = join(config.exportDir, `mp-${stamp}.xlsx`);
  const ctx = await openProfile(config.mpProfile);
  const page = ctx.pages()[0] || await ctx.newPage();
  let sourceFile = null;
  const extraFiles = [];
  const missing = [];
  try {
    const status = await ensureLoggedIn(page, { waitForLogin });
    if (status !== 'in') {
      await snap(page, status === 'out' ? 'mp-login' : 'mp-undetermined');
      const err = new Error(status === 'out' ? '公众号后台需要扫码登录' : '公众号后台登录态判不准（页面没读到内容）');
      err.loginRequired = true;
      err.loginStatus = status;
      throw err;
    }

    // token 只在登录后的 URL 上，后面拼后台接口要用
    const token = page.url().match(/token=(\d+)/)?.[1];

    await gotoContentAnalysis(page);
    // 注意（2026-08-03 实测）：内容分析页时间范围默认就是「近30天」（数据时间显示近30天区间），
    // 千万别再去点「近30天」——上一版点了它反而把视图切走、找不到下载按钮。保持默认即可。
    await page.waitForTimeout(1500);

    // 实测：导出按钮的真实文字是「下载数据明细」（<a class="mass_all-downlink">），不是「导出Excel」。
    if (config.manualClick) {
      console.log('[mp] MANUAL_CLICK：请在浏览器里点「下载数据明细」…');
      await downloadTo(page, () => {}, mainTarget, config.manualTimeoutMs);
    } else {
      await downloadTo(page, async () => {
        const hit = await clickFirstByText(
          page,
          ['下载数据明细', '导出数据明细', '下载明细', '导出Excel', '导出'],
          { timeout: 8000 },
        );
        if (!hit) throw new Error('没找到「下载数据明细」按钮（后台可能改版，或未进到内容分析页）');
      }, mainTarget, 60_000);
    }
    console.log(`[mp] 内容分析导出成功 → ${mainTarget}`);

    // 阅读来源（关键归因缺口）：内容分析页有「流量来源」板块（朋友圈/聊天/推荐/搜一搜…占比），
    // 但它没有独立下载按钮、图表是 canvas 抓不到文字。实测能稳拿到的办法＝把这块截成图，
    // 云端 Claude / 人都能直接读渠道占比。存 mp-source-YYYYMMDD.png（独立 try，失败不拖垮主表）。
    try {
      const src = page.getByText('流量来源', { exact: false }).first();
      await src.waitFor({ state: 'visible', timeout: 5000 });
      await src.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
      // 截「流量来源」标题所在的板块容器（往上找一个卡片祖先），拿不到就退回整屏
      const section = src.locator('xpath=ancestor::*[contains(@class,"weui-desktop-panel") or contains(@class,"card") or contains(@class,"panel")][1]');
      const sourceShot = join(config.exportDir, `mp-source-${stamp}.png`);
      if (await section.count()) await section.first().screenshot({ path: sourceShot });
      else await page.screenshot({ path: sourceShot, fullPage: true });
      sourceFile = sourceShot;
      console.log(`[mp] 流量来源已截图 → ${sourceShot}`);
    } catch (e) {
      await snap(page, 'mp-source-fail');
      console.warn(`[mp] 流量来源没截到（不影响主表）：${e.message}`);
    }

    // 逐篇明细 + 逐篇互动。都是独立 try——这两块是「锦上添花」，塌了也不该把主表拖成失败，
    // 但**必须在结果里说清哪块没拿到**，否则云端回填会把"没数据"当成"没流量"（工单反复强调的误判）。
    if (!token) {
      missing.push('逐篇明细/互动（URL 里没读到 token）');
    } else {
      try {
        const files = await downloadPerArticle(page, token, stamp);
        extraFiles.push(...files);
        if (!files.length) missing.push('逐篇明细');
      } catch (e) {
        await snap(page, 'mp-detail-fail');
        console.warn(`[mp] 逐篇明细失败（不影响主表）：${e.message}`);
        missing.push('逐篇明细');
      }
      try {
        extraFiles.push(await harvestEngagement(page, token, stamp));
      } catch (e) {
        await snap(page, 'mp-engage-fail');
        console.warn(`[mp] 逐篇互动失败（不影响主表）：${e.message}`);
        missing.push('逐篇互动');
      }
    }

    return { platform: 'mp', file: mainTarget, sourceFile, extraFiles, missing, stamp };
  } catch (e) {
    if (!e.loginRequired) await snap(page, 'mp-fail');
    throw e;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// 单独跑 node mp-export.mjs —— 交互式，会等你扫码登录（首次种登录态就用这个）
// pathToFileURL 归一化 argv[1]（相对路径直接拼 file:// 匹配不上 import.meta.url）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportMp({ waitForLogin: true }).then(r => console.log('OK', r)).catch(e => { console.error('FAIL', e.message); process.exit(1); });
}
