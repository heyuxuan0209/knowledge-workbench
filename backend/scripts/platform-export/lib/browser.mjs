// 浏览器驱动——刻意的"真人"配置（工单硬约束）：
//   有头真 Chrome（channel:'chrome'，非 bundled chromium）+ 持久化 profile；
//   不注入任何反检测/隐身/指纹伪装参数——行为等同她自己开浏览器。
import fs from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import { debugDir, config } from './config.mjs';

// 打开一个持久化上下文（profile 目录里存着登录态 cookie）。
// downloadsPath 指向导出目录：点"导出"触发的下载直接落这里，再按需重命名。
export async function openProfile(profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(config.exportDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,               // 有头
    channel: 'chrome',             // 真 Chrome，不是 playwright 自带 chromium
    acceptDownloads: true,
    downloadsPath: config.exportDir,
    viewport: null,                // 用真实窗口尺寸，不锁死 viewport（更像真人）
    args: ['--start-maximized'],
    // 刻意不设 userAgent / 不加 --disable-blink-features / 不做 stealth（工单要求）
  });
  return ctx;
}

// 在 action() 里做的点击/操作若触发下载，捕获它并存成目标文件名。
// timeoutMs：自动点击给较短超时；真人手动点击（manualClick）给很长超时。
export async function downloadTo(page, action, targetPath, timeoutMs) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: timeoutMs }),
    Promise.resolve().then(action),
  ]);
  await download.saveAs(targetPath);
  return targetPath;
}

// 失败时把当前页面截图存到 _debug/，返回截图路径（放进报错/通知里方便定位）。
export async function snap(page, label) {
  try {
    fs.mkdirSync(debugDir, { recursive: true });
    const p = join(debugDir, `${label}-${Date.now()}.png`);
    await page.screenshot({ path: p, fullPage: false });
    return p;
  } catch { return null; }
}

// 轮询探测登录态，拿不到结论（unknown）时**reload 一次**再探——只一次，不循环。
// 由来（2026-08-07 实测）：视频号那次报「未登录」，_debug 截图是一张纯白图——页面压根没渲染出来，
// 12 秒内只拿到 unknown 就被判成未登录，其实登录态好好的。白等一次刷新能救回这种误判；
// 但视频号有"别反复自动开"的风控红线，所以只重试一次，不做退避循环。
// detect: (page) => 'in' | 'out' | 'unknown'；返回最终 status（'unknown' 表示判不准，不当已登录）。
export async function detectWithReload(page, detect, { url, windowMs = 12_000, stepMs = 1000 } = {}) {
  const probe = async () => {
    const deadline = Date.now() + windowMs;
    let s = 'unknown';
    while (Date.now() < deadline) {
      s = await detect(page);
      if (s !== 'unknown') return s;
      await page.waitForTimeout(stepMs);
    }
    return s;
  };
  let status = await probe();
  if (status !== 'unknown') return status;
  console.log('[login] 页面没读到可判断的内容，刷新一次再探（只重试这一次）…');
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  else await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  status = await probe();
  if (status === 'unknown') console.log('[login] 刷新后仍判不准——按纪律不硬闯，报「判不准」而不是「未登录」。');
  return status;
}

// 依次尝试一组"可见文本"定位并点击，命中第一个就返回 true（选择器易漂，文本最稳）。
// 每个候选给短超时，全部落空返回 false 让上层决定是否报错。
export async function clickFirstByText(page, labels, { timeout = 4000 } = {}) {
  for (const label of labels) {
    const loc = page.getByText(label, { exact: false }).first();
    try {
      await loc.waitFor({ state: 'visible', timeout });
      await loc.click();
      return label;
    } catch { /* 试下一个候选 */ }
  }
  return null;
}
