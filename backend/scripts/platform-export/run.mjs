// 平台数据导出总入口（launchd 每天 10:07 调这个；手动补数：node run.mjs --force）。
// 流程：小红书 + 公众号 + 抖音 + 视频号 + 知乎各导一次 → 成功的传飞书云盘 → 发一条群通知（云端 Claude 据此入表）。
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

const force = process.argv.includes('--force');
const stamp = todayStamp();
const marker = join(config.exportDir, `_ran-${stamp}.marker`);

// 每天最多跑一次：当天跑过就退出（launchd 唤醒补跑不会重复导出）。手动 --force 补数可绕过。
if (!force && fs.existsSync(marker)) {
  console.log(`[run] ${stamp} 今天已跑过（${marker}），跳过。手动补数用 --force。`);
  process.exit(0);
}

// 跑一个平台：导出 → 逐个上传。返回结构化结果（不抛，把成败收进对象）。
async function runPlatform(name, fn) {
  try {
    const r = await fn();
    const files = [r.file, r.sourceFile].filter(Boolean);
    const uploaded = [];
    for (const f of files) {
      if (!fs.existsSync(f)) { console.warn(`[run] ${name} 导出声称成功但文件不存在：${f}`); continue; }
      await uploadFile(f);
      uploaded.push(basename(f));
    }
    return { name, ok: true, uploaded, note: (r.sourceFile ? '' : (name === 'mp' ? '（阅读来源报表未拿到）' : '')) };
  } catch (e) {
    return { name, ok: false, loginRequired: !!e.loginRequired, error: e.message };
  }
}

console.log(`[${new Date().toISOString()}] platform-export 开始（${stamp}${force ? ' · force' : ''}）`);

// 五个平台独立跑：一个挂了不拖另一个（登录态/风控互不相干）。
const xhs = await runPlatform('xhs', exportXhs);
const mp = await runPlatform('mp', exportMp);
const dy = await runPlatform('dy', exportDy);
const sph = await runPlatform('sph', exportSph);
const zhihu = await runPlatform('zhihu', exportZhihu);
const results = [xhs, mp, dy, sph, zhihu];

// 组装群通知：每个平台一行，✅ 列出实际文件名 / ❌ 列出原因（未登录 or 失败）。
// 目的（工单）：她一眼看清哪个平台这次「没有数据」，不会把「导出失败」误读成「没流量」。
const label = { xhs: '小红书', mp: '公众号', dy: '抖音', sph: '视频号', zhihu: '知乎' };
const lines = [];
for (const r of results) {
  if (r.ok) {
    const files = r.uploaded.join(' / ') || '(无文件)';
    lines.push(`✅ ${files}${r.note}`);
  } else if (r.loginRequired) {
    lines.push(`❌ ${label[r.name]} 未登录，需扫码（不硬闯，扫码后补数：node run.mjs --force）`);
  } else {
    lines.push(`❌ ${label[r.name]} 导出失败：${r.error}（不自动重试，请人工检查）`);
  }
}

const allOk = results.every((r) => r.ok);
const head = '数据导出已更新：';
await notifySafe([head, ...lines].join('\n'));

// 写当日标记（无论成败都写——失败按工单不自动重试，需人工 --force 补数）
try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* 标记写不了不影响主流程 */ }

console.log(`[${new Date().toISOString()}] platform-export 完成`);
console.log(lines.join('\n'));
// 有任一平台失败 → 非零退出码（launchd 日志可见），但不触发重试
process.exit(allOk ? 0 : 1);
