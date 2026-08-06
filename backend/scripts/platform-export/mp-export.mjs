// 公众号后台导出内容分析 Excel（近30天）+ 阅读来源报表 → mp-YYYYMMDD.xlsx / mp-source-YYYYMMDD.xlsx。
// 工单：预期半自动，微信后台登录态短命。所以先检测登录，未登录不硬闯——抛 loginRequired，
// 由 run.mjs 发飞书「公众号后台需要扫码，脚本已暂停」并退出。
// 阅读来源报表是复盘归因的关键缺口，务必尽力拿到；拿不到也不让主表失败，只在结果里标记。
import { join } from 'path';
import { pathToFileURL } from 'url';
import { config, todayStamp } from './lib/config.mjs';
import { openProfile, downloadTo, snap, clickFirstByText } from './lib/browser.mjs';

const HOME = 'https://mp.weixin.qq.com/';

// 单次判断登录态（不导航、不等待）。返回 'in' | 'out' | 'unknown'。
// 已登录首页 URL 带 token=；登录页是 bizlogin / 无 token，且有扫码提示。
async function detectMp(page) {
  const url = page.url();
  if (/token=/.test(url) && !/bizlogin|loginpage/i.test(url)) return 'in';
  const loginHint = await page.getByText(/扫码登录|使用微信.*扫描|请使用微信/).first()
    .isVisible({ timeout: 600 }).catch(() => false);
  if (loginHint) return 'out';
  return 'unknown';
}

// 确保已登录。waitForLogin=true（交互式首次登录）时等用户扫码；false（自动跑）时未登录即返回 false。
// 微信后台登录态短命，所以自动跑先检测、未登录不硬闯——交给上层发「需扫码，已暂停」。
async function ensureLoggedIn(page, { waitForLogin = false } = {}) {
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  let status = await detectMp(page);
  if (status === 'in') return true;
  if (!waitForLogin) return false;

  // 交互式：等用户用微信扫码。扫码成功后 MP 自动跳带 token= 的首页，同页轮询即可。
  console.log('\n👉 请打开手机微信，扫描弹出的 Chrome 窗口里的二维码登录公众号后台。');
  console.log('   登录成功后脚本会自动继续导出，最多等 15 分钟…\n');
  const deadline = Date.now() + config.loginWaitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    status = await detectMp(page);
    if (status === 'in') { console.log('[mp] 登录成功，开始导出…'); return true; }
  }
  return false;
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
    const ok = await ensureLoggedIn(page, { waitForLogin });
    if (!ok) {
      await snap(page, 'mp-login');
      const err = new Error('公众号后台需要扫码登录');
      err.loginRequired = true;
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
