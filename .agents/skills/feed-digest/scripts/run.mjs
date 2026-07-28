#!/usr/bin/env node
// feed-digest 自主入口（供 crontab / 手动一次性运行）：
//   抓取增量 → 翻译标题为中文 → 写入 data/digest.md → 推进 state。
// 全程一条命令、无需 Claude 在场。翻译走 DeepSeek（key 取自 backend/.env 或环境变量）。
//
//   node run.mjs                # 正常运行
//   node run.mjs --source hf-papers   # 只跑一个源（调试）
//   node run.mjs --dry-run      # 抓取+翻译但不落 state / 不写文件（预览）
//
// 退出码：0 正常（含"无新增"）；非 0 仅在致命异常时。

import { collectNewItems, persistState } from './fetch-feeds.mjs';
import { translateTitles } from './translate.mjs';
import { writeDigest } from './write-digest.mjs';

function log(...a) { console.log(`[feed-digest ${new Date().toLocaleTimeString('en-GB')}]`, ...a); }

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
  const dry = args.includes('--dry-run');

  log('开始抓取…');
  const { newItems, report, state } = await collectNewItems({ only });

  // 抓取健康度上报
  const failed = report.filter(r => r.error);
  const okCount = report.length - failed.length;
  log(`源 ${report.length}：成功 ${okCount}，失败 ${failed.length}，新增条目 ${newItems.length}`);
  for (const f of failed) log(`  ⚠ ${f.name}（${f.id}）：${f.error}`);

  if (!newItems.length) {
    if (!dry) persistState(state);
    log('没有新条目，state 已更新（如非 dry-run）。结束。');
    return;
  }

  log(`翻译 ${newItems.length} 条标题…`);
  const { titles_zh, translated, error } = await translateTitles(newItems.map(it => it.title));
  if (!translated) log(`  ⚠ 翻译降级（保留英文标题）：${error}`);
  const items = newItems.map((it, i) => ({ ...it, title_zh: titles_zh[i] }));

  if (dry) {
    log('dry-run：以下为将写入的条目预览（未落盘）');
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  const res = writeDigest(items);
  persistState(state);   // 只有成功写完 digest 才推进 state，避免丢条目
  log(`已写入 ${res.count} 条 → ${res.digestPath}`);
  log('完成。');
}

main().catch(err => { console.error('[feed-digest] FATAL', err); process.exit(1); });
