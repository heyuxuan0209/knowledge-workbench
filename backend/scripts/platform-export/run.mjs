// 平台数据导出总入口（launchd 每天 10:07 调这个；手动补数：node run.mjs --force）。
// 流程：小红书 + 公众号 + 抖音 + 视频号 + 知乎 + X 各导一次 → 成功的传飞书云盘 → 发一条群通知（VPS 确定性脚本随后入表）。
// 硬约束（工单）：每天最多一次、失败不自动重试、未登录不硬闯。任何结果都发通知说清在哪一步——
// 尤其把「哪个平台这次没数据」列清楚，好让她一眼分辨「没数据≠没流量」，不误判。
import fs from 'fs';
import { join, basename } from 'path';
import { config, todayStamp } from './lib/config.mjs';
import { uploadFile, notifySafe } from './lib/feishu.mjs';
import { exportXhs } from './xhs-export.mjs';
import { exportMp } from './mp-export.mjs';
import { exportDy } from './dy-export.mjs';
import { exportSph } from './sph-export.mjs';
import { exportZhihu } from './zhihu-export.mjs';
import { exportX } from './x-export.mjs';

const force = process.argv.includes('--force');
const stamp = todayStamp();
const marker = join(config.exportDir, `_ran-${stamp}.marker`);

// 每天最多跑一次：当天跑过就退出（launchd 唤醒补跑不会重复导出）。手动 --force 补数可绕过。
if (!force && fs.existsSync(marker)) {
  console.log(`[run] ${stamp} 今天已跑过（${marker}），跳过。手动补数用 --force。`);
  process.exit(0);
}

// 开跑前先确认这台机器真的联网（2026-08-10/11 实测踩坑）：
// launchd 的定时点撞上 Mac 在睡觉时，会在「唤醒的那一瞬间」补跑——此时 Wi-Fi 还没重连上，
// 于是五个平台全部打开成 Chrome 恐龙页（ERR_INTERNET_DISCONNECTED），被判成「登录态判不准」，
// 连报错的飞书通知都发不出去（fetch failed）。结果：数据没更新、人也不知道，静默断更两天。
// 所以：探网 → 没网就等一会儿再探（唤醒后几十秒内一般就好），始终没网就**什么都不做直接退**，
// 且**不写当日标记**——这样下一次唤醒/下一个定时点还会再试，断网不该吃掉当天的名额。
const NET_PROBES = ['https://creator.xiaohongshu.com/', 'https://open.feishu.cn/'];
async function online() {
  for (const url of NET_PROBES) {
    try {
      await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      return true; // 能拿到任何 HTTP 响应就算通（404/403 也说明网是通的）
    } catch { /* 换下一个探针 */ }
  }
  return false;
}
async function waitOnline({ tries = 10, gapMs = 60_000 } = {}) {
  for (let i = 1; i <= tries; i++) {
    if (await online()) return true;
    if (i < tries) {
      console.log(`[net] 第 ${i}/${tries} 次探测：没网（多半是刚从睡眠唤醒，Wi-Fi 还没连上），${gapMs / 1000}s 后再探…`);
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
  return false;
}

if (!(await waitOnline())) {
  console.log(`[net] 等了 10 分钟仍然没网，本次不导出、也不写当日标记——下次唤醒/明天定时还会再试。`);
  process.exit(75); // EX_TEMPFAIL：临时性失败，区别于「跑了但平台失败」的 1
}

// 跑一个平台：导出 → 逐个上传。返回结构化结果（不抛，把成败收进对象）。
async function runPlatform(name, fn) {
  try {
    const r = await fn();
    const files = [r.file, r.sourceFile, ...(r.extraFiles || [])].filter(Boolean);
    const uploaded = [];
    for (const f of files) {
      if (!fs.existsSync(f)) { console.warn(`[run] ${name} 导出声称成功但文件不存在：${f}`); continue; }
      await uploadFile(f);
      uploaded.push(basename(f));
    }
    // 「主表成了但某块附加数据没拿到」要在通知里点名——她据此判断这次的数能不能拿来复盘。
    const gaps = [...(r.missing || []), ...(!r.sourceFile && name === 'mp' ? ['阅读来源报表'] : [])];
    return { name, ok: true, uploaded, note: gaps.length ? `（未拿到：${gaps.join('、')}）` : '' };
  } catch (e) {
    return { name, ok: false, loginRequired: !!e.loginRequired, loginStatus: e.loginStatus, error: e.message };
  }
}

console.log(`[${new Date().toISOString()}] platform-export 开始（${stamp}${force ? ' · force' : ''}）`);

// 各平台独立跑：一个挂了不拖另一个（登录态/风控互不相干）。
const xhs = await runPlatform('xhs', exportXhs);
const mp = await runPlatform('mp', exportMp);
const dy = await runPlatform('dy', exportDy);
const sph = await runPlatform('sph', exportSph);
const zhihu = await runPlatform('zhihu', exportZhihu);
const results = [xhs, mp, dy, sph, zhihu];
// X 默认不跑（config.enableX，见那里的注释）：登录态没种上，天天报「未登录」只是噪音。
// 登过一次后在 .env 设 PLATFORM_EXPORT_ENABLE_X=true 就会加进来。
if (config.enableX) results.push(await runPlatform('x', exportX));

// 组装群通知：每个平台一行，✅ 列出实际文件名 / ❌ 列出原因（未登录 or 判不准 or 失败）。
// 目的（工单）：她一眼看清哪个平台这次「没有数据」，不会把「导出失败」误读成「没流量」。
// 「真掉线」和「判不准」必须分开说（2026-08-07 实测）：前者得掏手机扫码，后者多半只是页面没渲染出来、
// 直接补一次就过——混成一条会让她每天白掏一次手机。
const label = { xhs: '小红书', mp: '公众号', dy: '抖音', sph: '视频号', zhihu: '知乎', x: 'X' };
const lines = [];
for (const r of results) {
  if (r.ok) {
    const files = r.uploaded.join(' / ') || '(无文件)';
    lines.push(`✅ ${files}${r.note}`);
  } else if (r.loginRequired && r.loginStatus === 'unknown') {
    lines.push(`⚠️ ${label[r.name]} 登录态判不准：页面没读到内容（刷新重试过一次仍如此），未取数。多半不是真掉线，先直接补数：node run.mjs --force`);
  } else if (r.loginRequired) {
    lines.push(`❌ ${label[r.name]} 未登录，需扫码（不硬闯，扫码后补数：node run.mjs --force）`);
  } else {
    lines.push(`❌ ${label[r.name]} 导出失败：${r.error}（不自动重试，请人工检查）`);
  }
}

const allOk = results.every((r) => r.ok);
const head = '数据导出已更新：';
const notified = await notifySafe([head, ...lines].join('\n'));

// 写当日标记（跑过了就不重复跑——失败按工单不自动重试，需人工 --force 补数）。
// 唯一的例外：**一个平台都没成、通知也没发出去**——这种「全军覆没且她还不知道」的局面
// 基本只有网络/环境整体出问题才会出现，把标记写下去等于把当天彻底锁死在静默失败上。
// 这种情况下不写标记，留给下一次唤醒/下一个定时点再试一遍。
const anyOk = results.some((r) => r.ok);
if (anyOk || notified) {
  try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* 标记写不了不影响主流程 */ }
} else {
  console.log('[run] 所有平台全败 + 飞书通知也没送达（多半是网络/环境整体有问题）——不写当日标记，留待重试。');
}

console.log(`[${new Date().toISOString()}] platform-export 完成`);
console.log(lines.join('\n'));
// 有任一平台失败 → 非零退出码（launchd 日志可见），但不触发重试
process.exit(allOk ? 0 : 1);
