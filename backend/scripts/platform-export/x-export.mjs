// X（Twitter）逐帖数据 → x-YYYYMMDD.csv。
// 路径：x.com → 账号分析（/i/account_analytics）的「内容 / Content」列表。登录态存 ~/.playwright-profiles/x。
//
// 为什么也走「有头真 Chrome + 持久化 profile」这条路（2026-08-11 用户拍板）：
//   X 官方 API 里能拿到自己帖子曝光/互动的档位是**按月订阅的付费档**，为了 13 行复盘数据不值当；
//   而这套浏览器方案是另外五个平台已经在跑的架构，零成本、行为等同她自己开浏览器。
//   代价如实记：X 对自动化比国内平台敏感，**所以这里比别处更保守**——只读渲染好的页面，
//   不翻页不滚动加载（analytics 首屏就给全量列表），失败只截图不重试。
//
// ⚠️ 和视频号同一个毛病：X 的帖子**没有标题**，导出里那一列是正文。表里记的「平台化标题」是她自己起的，
//    两者对不上——靠的是 backfill 的第三级「按发布日兜底」（当天该平台只有一条时才认）。
//    所以同一天发多条 X（比如 thread 拆成几条）时会如实报「匹配不上」，不瞎猜。
import { join } from 'path';
import { pathToFileURL } from 'url';
import { config, todayStamp } from './lib/config.mjs';
import { openProfile, snap, detectWithReload } from './lib/browser.mjs';
import { writeCsv, STD_COLUMNS, dumpRaw, extractTable, rowsToObjects } from './lib/scrape.mjs';

const HOME = 'https://x.com/home';
const DATA_URL = 'https://x.com/i/account_analytics';

// 判断登录态的**纯函数**（拿 url + 页面文字，不碰浏览器，好写单测）。返回 'in' | 'out' | 'unknown'。
//
// 锚点全部照 2026-08-11 真机截图来，别凭印象写（这条已经栽过两次）：
// 第一版按英文站写的「Sign in to X / Create account / Forgot password」，结果中文站的落地页
// 一个都不命中——明明是登录页却报「判不准」。而「判不准」在通知里的意思是"多半没掉线，直接补一次数"，
// 于是她会一遍遍补数、每次都白补，真正该做的是去登录。公众号 2026-08-11 刚踩过同一个坑
// （见 mp-export.mjs 的注释），X 又踩一遍——**登录页文案是本地化的，必须按真机文案写。**
//
// 中文站未登录落地页长这样：标题「正发生.」+ 三个按钮「使用手机继续 / 使用 Google 继续 / 使用 Apple 继续」
// + 输入框占位符「电子邮箱或用户名」+「继续」+ 底部 Cookie 横幅。注意 URL 可能还停在 x.com/home，**不跳 login**。
export function classifyX(url, txt) {
  if (/\/i\/flow\/login|\/login|\/i\/flow\/signup/i.test(url || '')) return 'out';
  const t = String(txt || '');
  if (!t.trim()) return 'unknown';
  if (/正发生|What'?s happening|使用手机继续|使用 ?Google ?继续|Continue with Google|使用 ?Apple ?继续|电子邮箱或用户名|Phone, email, or username|立即注册|Create account|Sign in to X|忘记密码|Forgot password/i.test(t)) return 'out';
  // 已登录才有的：左侧导航（私信/书签/个人资料）、发帖框、时间线分栏、分析页标题
  if (/账号分析|Account analytics|有什么新鲜事|私信|书签|个人资料|Bookmarks|Direct Messages|为你推荐|正在关注|Following/i.test(t)) return 'in';
  return 'unknown';
}

async function detectX(page) {
  const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  return classifyX(page.url(), txt);
}

async function ensureLoggedIn(page, { waitForLogin = false } = {}) {
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  let status = await detectWithReload(page, detectX, { url: HOME, label: 'x' });
  if (status === 'in') return 'in';
  if (!waitForLogin) return status;

  console.log('\n👉 请在弹出的 Chrome 窗口里登录 X（账号密码 / 或已登录的手机确认）。');
  console.log('   登录成功后脚本会自动继续取数，最多等 15 分钟…\n');
  const deadline = Date.now() + config.loginWaitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    status = await detectX(page);
    if (status === 'in') break;
  }
  if (status !== 'in') return status;
  console.log('[x] 登录成功，开始读账号分析…');
  return 'in';
}

// X 的指标列名（中英双语后台都可能出现，按关键词匹配，别按列位——列会随账号类型增减）。
const X_ALIASES = [
  { key: '标题', aliases: ['帖子', '推文', 'Post', 'Tweet', '内容'] },
  { key: '发布时间', aliases: ['日期', '时间', 'Date', 'Time'] },
  { key: '曝光/播放量', aliases: ['曝光', '展现', '查看', 'Impressions', 'Views'] },
  { key: '点赞', aliases: ['喜欢', '点赞', 'Likes'] },
  { key: '评论', aliases: ['回复', '评论', 'Replies'] },
  { key: '收藏', aliases: ['书签', '收藏', 'Bookmarks'] },
  { key: '分享/转发', aliases: ['转帖', '转推', '转发', 'Reposts', 'Retweets', 'Shares'] },
  { key: '涨粉', aliases: ['新关注', '新增关注', '涨粉', 'New follows', 'Follows'] },
];

// 把抓到的表按 X 的叫法归一到标准列。一列都对不上（改版）时返回 null，让上层报错而不是落一份空表。
export function normalizeX(objects) {
  if (!objects.length) return null;
  const rawKeys = Object.keys(objects[0]);
  const pick = {};
  for (const col of X_ALIASES) {
    const hit = rawKeys.find((rk) => col.aliases.some((a) => rk.toLowerCase().includes(a.toLowerCase())));
    if (hit) pick[col.key] = hit;
  }
  // 至少要认出「哪一列是帖子」和「哪一列是曝光」，否则这份数据没法用来复盘
  if (!pick['标题'] || !pick['曝光/播放量']) return null;
  return objects.map((o) => {
    const r = {};
    for (const col of STD_COLUMNS) r[col.key] = pick[col.key] ? String(o[pick[col.key]] ?? '').trim() : '';
    return r;
  }).filter((r) => r['标题']);
}

export async function exportX({ waitForLogin = false } = {}) {
  const stamp = todayStamp();
  const target = join(config.exportDir, `x-${stamp}.csv`);
  const ctx = await openProfile(config.xProfile);
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    const status = await ensureLoggedIn(page, { waitForLogin });
    if (status !== 'in') {
      await snap(page, status === 'out' ? 'x-login' : 'x-undetermined');
      const err = new Error(status === 'out' ? 'X 需要登录' : 'X 登录态判不准（页面没读到内容）');
      err.loginRequired = true;
      err.loginStatus = status;
      throw err;
    }

    await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    // analytics 是前端渲染的，domcontentloaded 时表还是空的——等到出现「帖子/Post」这类表头再读。
    await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => {});
    await page.getByText(/曝光|Impressions/i).first().waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const txt = await page.evaluate(() => document.body?.innerText || '');
    dumpRaw('x', stamp, txt);

    const table = await extractTable(page);
    const recs = table ? normalizeX(rowsToObjects(table)) : null;
    if (!recs || !recs.length) {
      await snap(page, 'x-parse0');
      throw new Error('X 账号分析没解析出逐帖数据（页面可能改版或没加载出来），'
        + `原文见 _debug/x-raw-${stamp}.txt、截图见 _debug/x-parse0-*.png`);
    }

    writeCsv(target, STD_COLUMNS.map((c) => c.key), recs);
    console.log(`[x] 账号分析解析 ${recs.length} 条 → ${target}`);
    return { platform: 'x', file: target, stamp };
  } catch (e) {
    if (!e.loginRequired) await snap(page, 'x-fail');
    throw e;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// 单独跑 node x-export.mjs —— 交互式，会等你登录（首次种登录态就用这个）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportX({ waitForLogin: true }).then(r => console.log('OK', r)).catch(e => { console.error('FAIL', e.message); process.exit(1); });
}
