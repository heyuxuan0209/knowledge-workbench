#!/usr/bin/env node
/**
 * html-ppt · 出片入口
 *   node build.mjs <deck.json> [-o out.html] [--no-verify]
 *
 * 流程：render → playwright 量溢出 → 逐页升降级档 → 再量 → 仍溢出则报错（不出半成品）。
 *
 * 为什么必须量：条数预算（SCHEMA §四）挡不住"长文本换行撑爆"。
 * 实测过，溢出是**静默**的——没有滚动条、不报错、元素 overflow 检测返回 false，
 * 内容直接被压到页脚黑条下面切掉一半。不量就等于没解决。
 *
 * 零新增依赖：探针走 **Python playwright**（scripts/measure.py）。VPS 上装的是它
 * （仓内 .venv，供头图渲染，见 backend/scripts/provision-render-env.sh + ADR-080）；
 * Node 版 playwright 只在 Mac 的 backend/node_modules 里，服务器上没有——第一版写成
 * `import('playwright')` 直接 ERR_MODULE_NOT_FOUND，别再改回去。
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const MAX_D = 2;          // 降级档位上限（0 正常 / 1 缩字号 / 2 再收行距）
const TOL = 0;            // 允许的越界像素（1920×1080 坐标系）

const argv = process.argv.slice(2);
if (!argv[0] || argv.includes('-h') || argv.includes('--help')) {
  console.error('用法: node build.mjs <deck.json> [-o out.html] [--no-verify]');
  process.exit(1);
}
const src = resolve(argv[0]);
const outIdx = argv.indexOf('-o');
const out = resolve(outIdx >= 0 ? argv[outIdx + 1] : src.replace(/\.json$/, '.html'));
const doVerify = !argv.includes('--no-verify');

const deck = JSON.parse(readFileSync(src, 'utf8'));

function measure(html) {
  const dir = mkdtempSync(join(tmpdir(), 'htmlppt-'));
  const tmp = join(dir, 'probe.html');
  writeFileSync(tmp, html, 'utf8');
  const py = process.env.HTMLPPT_PYTHON || 'python3';
  const r = spawnSync(py, [join(HERE, 'measure.py'), tmp], { encoding: 'utf8', maxBuffer: 4 << 20 });
  if (r.error) throw new Error(`[html-ppt] 启动探针失败（${py}）：${r.error.message}`);
  if (r.stderr?.trim()) console.error(r.stderr.trim());
  if (r.status !== 0 || !r.stdout?.trim())
    throw new Error(`[html-ppt] 探针退出码 ${r.status}。缺 python playwright？装法见 backend/scripts/provision-render-env.sh`);
  const out = JSON.parse(r.stdout);
  if (out.error) throw new Error(`[html-ppt] 页面运行时报错：${out.error}`);
  return out;
}

let density = {};
let html = render(deck, { density });

if (doVerify) {
  for (let round = 0; round <= MAX_D; round++) {
    const res = measure(html);
    const bad = res.filter((r) => r.overflowPx > TOL);
    if (!bad.length) {
      if (round) console.error(`[html-ppt] 第 ${round} 轮降级后无溢出：${JSON.stringify(density)}`);
      break;
    }
    if (round === MAX_D) {
      const detail = bad.map((b) => `第 ${b.i + 1} 页超出 ${b.overflowPx}px`).join('；');
      // 不返回半成品：上游能重试或人工介入，总好过发一份被切掉一半的纪要
      throw new Error(
        `[html-ppt] 降到最低档仍溢出，拒绝出片。${detail}\n` +
        `建议：缩短条目文本，或把该页拆成两页（decisions/todos 会自动分页，topics/quotes 目前不会）。`
      );
    }
    for (const b of bad) density[b.i] = (density[b.i] ?? 0) + 1;
    console.error(`[html-ppt] 检出溢出 ${bad.map((b) => `#${b.i + 1}(+${b.overflowPx}px)`).join(' ')} → 升降级档重渲染`);
    html = render(deck, { density });
  }
}

writeFileSync(out, html, 'utf8');
console.log(out);
