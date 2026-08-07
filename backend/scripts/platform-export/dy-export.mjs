// 抖音创作者后台导出「每条作品」数据 → dy-YYYYMMDD.csv。
// 路径：creator.douyin.com → 内容管理 → 作品管理（creator-micro/content/manage）。
// 登录态存 ~/.playwright-profiles/dy（首次手动扫码/短信）。
//
// 实测坑（2026-08-06）：数据中心「内容数据」页那个「导出」按钮下的是**周期聚合表**
//   （发布时间=区间 / 条均点击率 / 播放量中位数…，一行汇总，无标题、无逐条），
//   对"按发布时间逐条匹配表行"完全没用。真正的逐条数据在**作品管理**，且是**卡片列表不是表格、无导出按钮**：
//   每张卡＝时长/张数 + 标题 + 编辑/权限/置顶/删除 + 发布时间(精确到分) + 已发布 + [官方活动] + 指标(标签\值对)。
//   指标**逐卡不同**（有的有分享、图文卡有文案展开率/平均浏览图片）——所以按「标签取值」解析，不能按列位。
import { join } from 'path';
import { pathToFileURL } from 'url';
import { config, todayStamp } from './lib/config.mjs';
import { openProfile, snap, clickFirstByText, detectWithReload } from './lib/browser.mjs';
import { writeCsv, STD_COLUMNS } from './lib/scrape.mjs';

// 作品管理（逐条卡片列表）
const DATA_URL = 'https://creator.douyin.com/creator-micro/content/manage';

// 单次判断登录态（不导航、不等待）。返回 'in' | 'out' | 'unknown'。
// 未登录不跳 URL、登录 splash 有营销字「作品数据分析」——所以读 body.innerText 精确匹配，
// 别用 getByText(/作品数据/)（会被 splash 子串误命中）。已登录后左侧导航恒有「数据中心/内容管理」。
async function detectDy(page) {
  if (/passport|\/login/i.test(page.url())) return 'out';
  const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (/扫码登录|验证码登录|密码登录|如何扫码|一站式服务平台/.test(txt)) return 'out';
  if (/数据中心|内容管理|作品管理|数据总览/.test(txt)) return 'in';
  return 'unknown';
}

// 返回 'in' / 'out'（确认看到登录页）/ 'unknown'（判不准，页面没读到内容）。
async function ensureLoggedIn(page, { waitForLogin = false } = {}) {
  await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  // 判不准不当已登录：宁可通知扫码，也别硬闯出一份空数据（「没数据≠没流量」的误判成本更高）。
  // 但先 reload 一次再判——纯白页/没渲染完被判成未登录已实测发生过（2026-08-07 视频号）。
  let status = await detectWithReload(page, detectDy, { url: DATA_URL });
  if (status === 'in') return 'in';
  if (!waitForLogin) return status;

  console.log('\n👉 请在弹出的 Chrome 窗口里登录抖音创作者后台（扫码或手机号+验证码）。');
  console.log('   登录成功后脚本会自动继续导出，最多等 15 分钟…\n');
  const deadline = Date.now() + config.loginWaitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    status = await detectDy(page);
    if (status === 'in') break;
  }
  if (status !== 'in') return status;
  await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('[dy] 登录成功，开始读作品管理…');
  return 'in';
}

// 已登录才有的指标标签集合（用于逐卡「标签取值」解析）；ACTIONS 是卡内动作按钮（跳过）。
const METRIC_LABELS = ['播放', '点赞', '评论', '分享', '收藏', '弹幕', '平均播放时长', '封面点击率', '文案展开率', '平均浏览图片', '主页访问'];
const ACTIONS = new Set(['编辑作品', '设置权限', '作品置顶', '删除作品', '取消置顶', '恢复作品', '申请复审']);
const dtRe = /^\d{4}年\d{2}月\d{2}日\s+\d{1,2}:\d{2}$/; // 发布时间（精确到分，入表匹配主键）
const durRe = /^(\d{1,2}:\d{2}|\d+张)$/;                 // 卡片开头的时长 / 图文张数

// 把作品管理页的 innerText 解析成逐条记录。策略：发布时间行作锚，其前是标题块（去掉时长/张数/动作按钮），
// 其后按「指标标签 → 下一行值」成对取值，遇到不认识的标签且指标已开始＝下一张卡开始。
export function parseDouyinWorks(text) {
  let lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const anchor = lines.findIndex((l) => /^共\s*\d+\s*个作品$/.test(l));
  if (anchor >= 0) lines = lines.slice(anchor + 1);
  const recs = [];
  let i = 0;
  while (i < lines.length) {
    const titleParts = [];
    while (i < lines.length && !dtRe.test(lines[i])) {
      const l = lines[i];
      if (!ACTIONS.has(l) && !durRe.test(l) && l !== '已发布') titleParts.push(l);
      i++;
    }
    if (i >= lines.length) break;
    const datetime = lines[i]; i++;
    const m = {};
    while (i < lines.length) {
      const l = lines[i];
      if (dtRe.test(l)) break;
      if (METRIC_LABELS.includes(l)) { m[l] = lines[i + 1] ?? ''; i += 2; continue; }
      if (Object.keys(m).length === 0) { i++; continue; } // 状态/活动前缀
      break; // 指标已开始又遇非指标 → 下一张卡
    }
    if (titleParts.length || Object.keys(m).length) {
      recs.push({
        标题: titleParts.join(' ').trim(),
        发布时间: datetime,
        '曝光/播放量': m['播放'] || '',
        点赞: m['点赞'] || '',
        评论: m['评论'] || '',
        收藏: m['收藏'] || '',
        '分享/转发': m['分享'] || '',
        涨粉: '', // 抖音逐条不给涨粉（账号级指标），留空
      });
    }
  }
  return recs;
}

export async function exportDy({ waitForLogin = false } = {}) {
  const stamp = todayStamp();
  const target = join(config.exportDir, `dy-${stamp}.csv`);
  const ctx = await openProfile(config.dyProfile);
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    const status = await ensureLoggedIn(page, { waitForLogin });
    if (status !== 'in') {
      await snap(page, status === 'out' ? 'dy-login' : 'dy-undetermined');
      const err = new Error(status === 'out' ? '抖音创作者后台需要扫码登录' : '抖音创作者后台登录态判不准（页面没读到内容）');
      err.loginRequired = true;
      err.loginStatus = status;
      throw err;
    }

    // 确保在作品管理列表（左侧「内容管理→作品管理」；直链已进）。等「共 N 个作品」出现＝列表已渲染。
    await clickFirstByText(page, ['作品管理'], { timeout: 4000 });
    const countLoc = page.getByText(/共\s*\d+\s*个作品/).first();
    await countLoc.waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const txt = await page.evaluate(() => document.body?.innerText || '');
    const countMatch = txt.match(/共\s*(\d+)\s*个作品/);
    const declared = countMatch ? Number(countMatch[1]) : null;
    const recs = parseDouyinWorks(txt);

    // 后台说有 N 条却解析到 0 → 大概率改版/没加载，报错让人看截图（别静默出空文件被当"没流量"）。
    if (declared && declared > 0 && recs.length === 0) {
      await snap(page, 'dy-parse0');
      throw new Error(`作品管理显示共 ${declared} 个作品，却解析到 0 条（卡片结构可能改版，见 _debug 截图）`);
    }

    writeCsv(target, STD_COLUMNS.map((c) => c.key), recs);
    console.log(`[dy] 作品管理解析 ${recs.length} 条${declared != null ? `（后台标称 ${declared}）` : ''} → ${target}`);
    return { platform: 'dy', file: target, stamp };
  } catch (e) {
    if (!e.loginRequired) await snap(page, 'dy-fail');
    throw e;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// 单独跑 node dy-export.mjs —— 交互式，会等你登录（首次种登录态就用这个）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportDy({ waitForLogin: true }).then(r => console.log('OK', r)).catch(e => { console.error('FAIL', e.message); process.exit(1); });
}
