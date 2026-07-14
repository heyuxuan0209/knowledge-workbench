import dotenv from 'dotenv';
dotenv.config();

import { generateDailyReport } from './report-generation.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// 日报生成 CLI（对标 sync-aihot.js 惯例）。
// 手动：cd backend && node src/services/sync-daily-report.js
// 定时（可选，用户自行加 crontab）：0 8 * * * cd <backend目录> && /usr/local/bin/node src/services/sync-daily-report.js
// 注意：每次运行调用一次 Deepseek（约 3-6k tokens，¥0.005 级别）。

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generateDailyReport().then(result => {
    if (result.success) {
      const r = result.data;
      console.log(`\n📰 ${r.period_key} 日报`);
      console.log(`导语: ${r.summary}`);
      console.log(`焦点 ${r.focus.length} 条 / 选题 ${r.ideas.length} 个:`);
      for (const idea of r.ideas) console.log(`  💡 ${idea.title}`);
    } else {
      console.error('❌', result.error);
    }
    process.exit(result.success ? 0 : 1);
  });
}
