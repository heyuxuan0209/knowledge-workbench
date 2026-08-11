// 知乎创作中心导出每条内容数据 → zhihu-YYYYMMDD.csv。
// 路径：创作中心 → 内容管理 → 全部（manage/creation/all）。四类内容（文章/视频/想法/回答…）**都在这一个「全部」列表里**，一网打尽。
// 登录态存 ~/.playwright-profiles/zhihu（首次扫码/密码登录）。
//
// 实测结构（2026-08-06 真机）：每张卡 = div.CreationManage-CreationCard，知乎允许 DOM eval（无反注入守卫），所以走 DOM 抽取（比 innerText 稳）：
//  - 类型：标题元素 .CreationCardTitle-wrapper 文本**前缀**就是类型徽标（文章/视频/想法/回答/提问/播客/专栏）——比按 href 判准（视频也可能挂在 /pin/ 下）。
//  - 发布时间：时间 div 的 **data-tooltip**（可见文本只到「发布于 08-06」，但 tooltip 是「发布于 08-06 07:51」**精确到分**，入表匹配主键就取它）。
//  - 指标：带文字标签、逐卡不同——阅读/播放(→播放量) · 赞同(→点赞) · 评论 · 收藏 · 喜欢(知乎特有，单列保留)。知乎列表**无分享/转发计数**（分享是按钮），留空。
import { join } from 'path';
import { pathToFileURL } from 'url';
import { config, todayStamp } from './lib/config.mjs';
import { openProfile, snap, detectWithReload } from './lib/browser.mjs';
import { writeCsv } from './lib/scrape.mjs';

const DATA_URL = 'https://www.zhihu.com/creator/manage/creation/all';

// 知乎 CSV 列（含知乎特有的「喜欢」和「类型」；分享/转发列表不给、涨粉账号级——都留空）。
const ZHIHU_COLUMNS = ['类型', '标题', '发布时间', '曝光/播放量', '点赞', '评论', '收藏', '喜欢', '分享/转发', '涨粉'];

// 单次判断登录态（读 body.innerText 精确匹配；unknown 不当已登录，判不准通知登录不硬闯）。
async function detectZhihu(page) {
  if (/\/signin|\/login/i.test(page.url())) return 'out';
  const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (/扫码登录|密码登录|验证码登录|登录知乎|注册知乎|同意.*协议/.test(txt)) return 'out';
  if (/创作中心|内容管理|数据分析|我的创作|创作分/.test(txt)) return 'in';
  return 'unknown';
}

// 返回 'in' / 'out'（确认看到登录页）/ 'unknown'（判不准，页面没读到内容）。
async function ensureLoggedIn(page, { waitForLogin = false } = {}) {
  await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  let status = await detectWithReload(page, detectZhihu, { url: DATA_URL, label: 'zhihu' });
  if (status === 'in') return 'in';
  if (!waitForLogin) return status;

  console.log('\n👉 请在弹出的 Chrome 窗口里登录知乎（扫码 / 密码 / 短信验证码都行）。');
  console.log('   登录成功后脚本会自动继续，最多等 15 分钟…\n');
  const deadline = Date.now() + config.loginWaitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    status = await detectZhihu(page);
    if (status === 'in') break;
  }
  if (status !== 'in') return status;
  await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('[zhihu] 登录成功，开始读内容列表…');
  return 'in';
}

// DOM 抽取每张内容卡 → 记录数组 + 后台标称条数。
async function extractZhihu(page) {
  return await page.evaluate(() => {
    const TYPES = ['文章', '视频', '想法', '回答', '提问', '播客', '专栏'];
    // 注意：指标标签**逐类型不同**——文章/视频是「阅读/播放」，想法是「被浏览」；想法还有「转发」，文章的"分享"只是按钮无数字。
    const LABELS = ['阅读', '播放', '被浏览', '赞同', '评论', '收藏', '喜欢', '转发'];
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const declaredM = (document.body.innerText || '').match(/共\s*(\d+)\s*条内容/);
    const declared = declaredM ? Number(declaredM[1]) : null;

    const cards = [...document.querySelectorAll('.CreationManage-CreationCard')];
    const recs = cards.map((card) => {
      const timeEl = card.querySelector('[data-tooltip]');
      const time = (timeEl?.getAttribute('data-tooltip') || timeEl?.textContent || '').replace(/^发布于\s*/, '').trim();
      const titleEl = card.querySelector('[class*="CreationCardTitle"]') || card.querySelector('h1,h2,h3');
      // 想法/视频没有独立标题，这里塞的是整段正文——去掉尾部「收起/展开」，超长截断（匹配主要靠发布时间，标题够辨认即可）。
      let title = clean(titleEl?.textContent).replace(/\s*(收起|展开)\s*$/, '');
      let type = '';
      for (const t of TYPES) { if (title.startsWith(t)) { type = t; title = title.slice(t.length).trim(); break; } }
      if (title.length > 100) title = title.slice(0, 100) + '…';
      // 指标：找文本为已知标签的叶子，值＝前一个叶子（实测「值 标签」相邻）
      const metrics = {};
      const leaves = [...card.querySelectorAll('*')].filter((e) => e.children.length === 0);
      for (let i = 0; i < leaves.length; i++) {
        const tx = clean(leaves[i].textContent);
        if (LABELS.includes(tx)) {
          const prev = clean(leaves[i - 1]?.textContent);
          if (/^\d[\d,]*$/.test(prev)) metrics[tx] = prev;
        }
      }
      return { type, title, time, metrics };
    });
    return { declared, recs };
  });
}

async function scrapeToCsv(page, stamp) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  // 触发懒加载：滚到底几次直到卡片数稳定（知乎「全部」列表滚动加载）
  let prev = -1;
  for (let k = 0; k < 8; k++) {
    const n = await page.locator('.CreationManage-CreationCard').count().catch(() => 0);
    if (n === prev) break;
    prev = n;
    await page.mouse.wheel(0, 3000).catch(() => {});
    await page.waitForTimeout(1200);
  }

  const { declared, recs } = await extractZhihu(page);
  if (!recs.length) {
    await snap(page, 'zhihu-probe');
    throw new Error('知乎内容列表没读到卡片（后台可能改版，见 _debug/zhihu-probe 截图）');
  }
  if (declared && recs.length < declared) {
    console.warn(`[zhihu] ⚠️ 后台标称 ${declared} 条，只抓到 ${recs.length} 条（可能有未加载/分页，未静默截断，请核对）`);
  }

  const records = recs.map((r) => ({
    类型: r.type,
    标题: r.title,
    发布时间: r.time,
    '曝光/播放量': r.metrics['阅读'] || r.metrics['播放'] || r.metrics['被浏览'] || '',
    点赞: r.metrics['赞同'] || '',
    评论: r.metrics['评论'] || '',
    收藏: r.metrics['收藏'] || '',
    喜欢: r.metrics['喜欢'] || '',
    '分享/转发': r.metrics['转发'] || '',
    涨粉: '',
  }));
  const target = join(config.exportDir, `zhihu-${stamp}.csv`);
  writeCsv(target, ZHIHU_COLUMNS, records);
  console.log(`[zhihu] 内容列表解析 ${records.length} 条${declared != null ? `（后台标称 ${declared}）` : ''} → ${target}`);
  return target;
}

export async function exportZhihu({ waitForLogin = false } = {}) {
  const stamp = todayStamp();
  const ctx = await openProfile(config.zhihuProfile);
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    const status = await ensureLoggedIn(page, { waitForLogin });
    if (status !== 'in') {
      await snap(page, status === 'out' ? 'zhihu-login' : 'zhihu-undetermined');
      const err = new Error(status === 'out' ? '知乎创作中心需要登录' : '知乎创作中心登录态判不准（页面没读到内容）');
      err.loginRequired = true;
      err.loginStatus = status;
      throw err;
    }
    const csv = await scrapeToCsv(page, stamp);
    return { platform: 'zhihu', file: csv, stamp };
  } catch (e) {
    if (!e.loginRequired) await snap(page, 'zhihu-fail');
    throw e;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// 单独跑 node zhihu-export.mjs —— 交互式，会等你登录（首次种登录态就用这个）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportZhihu({ waitForLogin: true }).then(r => console.log('OK', r)).catch(e => { console.error('FAIL', e.message); process.exit(1); });
}
