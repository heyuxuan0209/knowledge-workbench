import dotenv from 'dotenv';
dotenv.config();

import { generatePeriodReport } from './period-report.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// 周报/月报生成 CLI（对标 sync-daily-report.js 惯例）。
// 手动：cd backend && node src/services/sync-period-report.js weekly|monthly（默认 weekly）
// 定时（可选，用户自行加 crontab）：
//   周报：0 9 * * 1 cd <backend目录> && /usr/local/bin/node src/services/sync-period-report.js weekly
//   月报：0 9 1 * * cd <backend目录> && /usr/local/bin/node src/services/sync-period-report.js monthly
// 注意：每次运行调用一次 Deepseek（约 4-8k tokens，¥0.01 级别）。

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const periodType = process.argv[2] === 'monthly' ? 'monthly' : 'weekly';
  generatePeriodReport(periodType).then(result => {
    if (result.success) {
      const r = result.data;
      console.log(`\n📰 ${r.period_key} ${periodType === 'weekly' ? '周报' : '月报'}`);
      console.log(`导语: ${r.summary}`);
      console.log(`动向 ${r.trends.length} 条 / 活页更新 ${r.page_changes.length} 项 / 选题 ${r.ideas.length} 个`);
      for (const t of r.trends) console.log(`  ${t.direction === 'rising' ? '↗' : '↘'} ${t.theme}：${t.evidence}`);
      for (const n of r.emergent.newTopics || []) console.log(`  🌱 建议新活页「${n.name}」：${n.why}`);
      for (const c of r.emergent.conflicts || []) console.log(`  ⚡ ${c}`);
      for (const idea of r.ideas) console.log(`  💡 ${idea.title}`);
    } else {
      console.error('❌', result.error);
    }
    process.exit(result.success ? 0 : 1);
  });
}
