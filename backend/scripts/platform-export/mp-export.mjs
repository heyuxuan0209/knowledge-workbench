// 公众号后台导出内容分析 Excel（近30天）+ 阅读来源报表 → mp-YYYYMMDD.xlsx / mp-source-YYYYMMDD.xlsx。
// 工单：预期半自动，微信后台登录态短命。所以先检测登录，未登录不硬闯——抛 loginRequired，
// 由 run.mjs 发飞书「公众号后台需要扫码，脚本已暂停」并退出。
// 阅读来源报表是复盘归因的关键缺口，务必尽力拿到；拿不到也不让主表失败，只在结果里标记。
import { join } from 'path';
import { pathToFileURL } from 'url';
import { config, todayStamp } from './lib/config.mjs';
import { openProfile, downloadTo, snap, clickFirstByText, detectWithReload } from './lib/browser.mjs';

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
  let status = await detectWithReload(page, detectMp, { url: HOME, windowMs: 8_000 });
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
  try {
    const status = await ensureLoggedIn(page, { waitForLogin });
    if (status !== 'in') {
      await snap(page, status === 'out' ? 'mp-login' : 'mp-undetermined');
      const err = new Error(status === 'out' ? '公众号后台需要扫码登录' : '公众号后台登录态判不准（页面没读到内容）');
      err.loginRequired = true;
      err.loginStatus = status;
      throw err;
    }

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

    return { platform: 'mp', file: mainTarget, sourceFile, stamp };
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
