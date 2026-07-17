#!/usr/bin/env node
// 定时任务统一入口（launchd 调度，2026-07-17 从 cron 迁移）。
// 为什么是 node 不是 shell：macOS TCC 权限按二进制归因——实测本机 cron 彻底
// 不执行用户任务、launchd 里的 /bin/bash 访问 Documents 被拒（Operation not
// permitted），而 node 已被授权（backend 常驻 launchd 就在本目录跑，先例验证）。
// launchd 相比 cron 的关键优势：睡眠错过的 StartCalendarInterval 唤醒后补跑一次。
//
// 用法: node scheduled-task.mjs <sync-sources|active-query|daily-report|weekly-report|monthly-report>

import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
// active-query 需要 yt-dlp/bili 等 CLI（pip user bin），显式补 PATH（launchd 环境无 shell profile）
const env = {
  ...process.env,
  PATH: `/opt/homebrew/bin:${process.env.HOME}/Library/Python/3.10/bin:/usr/local/bin:/usr/bin:/bin`,
};

const TASKS = {
  'sync-sources': ['sync-aihot.js', 'sync-hackernews.js', 'sync-rss.js', 'sync-github-trending.js'],
  'active-query': ['sync-active-query.js'],
  'daily-report': ['sync-daily-report.js'],
  'weekly-report': [['sync-period-report.js', 'weekly']],
  'monthly-report': [['sync-period-report.js', 'monthly']],
};

const task = process.argv[2];
const scripts = TASKS[task];
if (!scripts) {
  console.error(`用法: scheduled-task.mjs <${Object.keys(TASKS).join('|')}>`);
  process.exit(1);
}

console.log(`[${new Date().toISOString()}] scheduled-task: ${task} 开始`);
let failed = 0;
for (const entry of scripts) {
  const [script, ...args] = Array.isArray(entry) ? entry : [entry];
  try {
    execFileSync('node', [join(backendDir, 'src/services', script), ...args], {
      cwd: backendDir, env, stdio: 'inherit', timeout: 30 * 60000,
    });
  } catch (err) {
    // 单脚本失败不阻塞后续（四源同步里一个源挂了其余照跑），如实计数
    failed++;
    console.error(`[scheduled-task] ${script} 失败: ${err.message}`);
  }
}
console.log(`[${new Date().toISOString()}] scheduled-task: ${task} 完成${failed ? `（${failed} 个子任务失败）` : ''}`);
process.exit(failed ? 1 : 0);
