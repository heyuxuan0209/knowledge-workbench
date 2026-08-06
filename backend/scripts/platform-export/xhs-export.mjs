// 小红书创作者后台导出「笔记列表明细表」（全部时间范围）→ xhs-YYYYMMDD.xlsx。
// 工单：预期全自动。登录态存在 ~/.playwright-profiles/xhs（首次手动扫码）。
//
// 选择器易漂（后台改版频繁），策略：走可见文本定位 + 每步截图，失败即抛「卡在哪一步」。
// 真正稳的是"下载捕获"这一步——不管点了什么，只要触发下载就把文件存下来。
// 降级：PLATFORM_EXPORT_MANUAL_CLICK=true 时只开到数据页，导出那一下由真人点。
import { join } from 'path';
import { pathToFileURL } from 'url';
import { config, todayStamp } from './lib/config.mjs';
import { openProfile, downloadTo, snap, clickFirstByText } from './lib/browser.mjs';

const HOME = 'https://creator.xiaohongshu.com';
// 数据中心·笔记数据（直链；改版漂了就退回从首页点导航）
const DATA_URL = 'https://creator.xiaohongshu.com/statistics/data-analysis';

// 单次判断登录态（不导航、不等待）。返回 'in' | 'out' | 'unknown'。
// 实测坑（2026-08-03）：未登录时 XHS 不是立刻跳转——首屏 API 拿到 401 后才客户端跳
// /login?redirectReason=401，延迟约 3~7s；且登录页默认是「短信登录」不是二维码。
async function detectXhs(page) {
  if (/\/login|passport|sign|redirectReason=401/i.test(page.url())) return 'out';
  const loginForm = await page.getByText(/短信登录|发送验证码|扫码登录|登录即同意/).first()
    .isVisible({ timeout: 600 }).catch(() => false);
  if (loginForm) return 'out';
  const authed = await page.getByText(/笔记数据|数据概览|数据中心|内容数据/).first()
    .isVisible({ timeout: 600 }).catch(() => false);
  if (authed) return 'in';
  return 'unknown';
}

// 确保已登录。waitForLogin=true（交互式首次登录）时：检测到未登录不立刻退出，而是把窗口
// 停住、提示用户在浏览器里登录，轮询等登录完成（最多 manualTimeoutMs）。
// waitForLogin=false（launchd 自动跑，无人值守）时：未登录直接返回 false → 上层发通知不硬闯。
async function ensureLoggedIn(page, { waitForLogin = false } = {}) {
  await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  // 首轮轮询 12s 等可能的 401 跳转定型
  let status = 'unknown';
  const firstDeadline = Date.now() + 12_000;
  while (Date.now() < firstDeadline) {
    status = await detectXhs(page);
    if (status !== 'unknown') break;
    await page.waitForTimeout(1000);
  }
  if (status === 'unknown') status = 'in'; // 停在数据页没跳登录 = 会话有效
  if (status === 'in') return true;

  if (!waitForLogin) return false; // 无人值守：不等，交给上层通知

  // 交互式：等用户登录。风控克制——**只观察不折腾**：登录期间纯轮询 URL 不导航（不打断输入、
  // 不制造多余请求）；一旦用户离开登录页（= 登录成功，XHS 自动跳回 lastUrl），只再导航「一次」
  // 到数据页确认并停住，绝不反复 goto。
  console.log('\n👉 请在弹出的 Chrome 窗口里登录小红书创作后台（默认「短信登录」，输入手机号→发验证码）。');
  console.log('   登录成功后脚本会自动继续导出，最多等 15 分钟…\n');
  const deadline = Date.now() + config.loginWaitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if (/\/login|passport|redirectReason=401/i.test(page.url())) continue; // 还在登录页 → 静静等，不动作
    break; // 已离开登录页 = 登录成功
  }
  if (/\/login|passport|redirectReason=401/i.test(page.url())) return false; // 超时仍未登录
  // 登录成功，只导航一次到数据页并停住准备导出
  await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('[xhs] 登录成功，开始导出…');
  return true;
}

export async function exportXhs({ waitForLogin = false } = {}) {
  const stamp = todayStamp();
  const target = join(config.exportDir, `xhs-${stamp}.xlsx`);
  const ctx = await openProfile(config.xhsProfile);
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    const ok = await ensureLoggedIn(page, { waitForLogin });
    if (!ok) {
      await snap(page, 'xhs-login');
      const err = new Error('小红书创作者后台需要扫码登录');
      err.loginRequired = true;
      throw err;
    }

    // 进到笔记数据视图（已在 data-analysis；再点一下"笔记数据"确保是明细维度）
    await clickFirstByText(page, ['笔记数据', '笔记列表', '内容数据'], { timeout: 5000 });
    await page.waitForTimeout(1500);

    if (config.manualClick) {
      // 降级模式：把浏览器停在导出页，选好"全部"范围后由真人点"导出"
      console.log('[xhs] MANUAL_CLICK：请在浏览器里选「全部」时间范围并点「导出笔记列表明细表」…');
      await downloadTo(page, () => {}, target, config.manualTimeoutMs);
      console.log(`[xhs] 已捕获下载 → ${target}`);
      return { platform: 'xhs', file: target, stamp };
    }

    // 自动：选「全部」时间范围（若有该控件），再点导出
    await clickFirstByText(page, ['全部'], { timeout: 4000 });
    await page.waitForTimeout(800);
    await downloadTo(page, async () => {
      const hit = await clickFirstByText(
        page,
        ['导出笔记列表明细表', '笔记列表明细表', '导出明细', '导出数据', '导出'],
        { timeout: 8000 },
      );
      if (!hit) throw new Error('没找到「导出」按钮（后台可能改版，或未进到笔记数据页）');
    }, target, 60_000);

    console.log(`[xhs] 导出成功 → ${target}`);
    return { platform: 'xhs', file: target, stamp };
  } catch (e) {
    if (!e.loginRequired) await snap(page, 'xhs-fail');
    throw e;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// 允许单独跑：node xhs-export.mjs —— 交互式，会等你在浏览器里登录（首次种登录态就用这个）
// 注意用 pathToFileURL 归一化：argv[1] 可能是相对路径，直接拼 file:// 会匹配不上 import.meta.url。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportXhs({ waitForLogin: true }).then(r => console.log('OK', r)).catch(e => { console.error('FAIL', e.message); process.exit(1); });
}
