// 历史发布补档（ADR-062 Phase 1 实战验收）：writing/published 的定稿 → 飞书文档，
// 并回填多维表格「内容主表」的母稿文档字段。用法：
//   cd backend && node scripts/backfill-published-to-feishu.mjs --dry-run   # 只看匹配计划
//   cd backend && node scripts/backfill-published-to-feishu.mjs            # 实际执行
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';

const DRY = process.argv.includes('--dry-run');
const W = join(process.env.HOME, 'Documents/项目/writing/published');
const APP = 'QIlkbwmGma9Tb1sRyAicfZeEnjb';
const CONTENT_TID = 'tblna4uWPhP0qQMH';

// 作品清单（人工核对过：2 个 md 母稿、4 个公众号排版 html；两个无文字稿的已排除）。
// recordId = 内容主表对应行（2026-07-30 人工对照 9 行定的显式映射——模糊匹配漏了「read-anything→我的收藏夹…」这种改名，弃用）；
// recordId 为空 → 主表还没这篇，建新行。
const WORKS = [
  { dir: '2026-07-16-别再逼自己把需求想清楚了', file: '小红书长文.md', ext: 'md', date: '2026-07-16', recordId: 'recvqPQ1FBwovr' }, // 首轮已建档 TUdWdLTU6osYGcxXmMpcSa2Fnhf
  { dir: '2026-07-17-read-anything', file: '长文-小红书公众号.md', ext: 'md', date: '2026-07-17', recordId: 'recvqPHDnkWOQl' },
  { dir: '2026-07-21-说清楚只对了一半', file: '和 AI 高效协作，可能"说清楚"只对了一半0721.html', ext: 'html', date: '2026-07-21', recordId: 'recvqPHDnk7wjo' },
  { dir: '2026-07-24-AI 早就够强了，是我们把它拴住了', file: '公众号排版版-AI 早就够强了，是我们把它拴住了.html', ext: 'html', date: '2026-07-24', recordId: 'recvqPHDnkIWFV' },
  { dir: '2026-07-29-有些需求，天生说不清楚', file: '有些需求AI 天生听不懂.html', ext: 'html', date: '2026-07-29', recordId: 'recvqPos5m88N3' },
  { dir: '2026-07-31-让 AI 整理文件夹之前，先看看我踩的两个坑', file: 'AI整理文件夹前的排雷-公众号排版.html', ext: 'html', date: '2026-07-31', recordId: null },
];

const titleOf = (dir) => dir.replace(/^\d{4}-\d{2}-\d{2}-/, '');

// dotenv 已就位后再拉飞书模块（项目已知坑：ESM import 提升会让 dotenv 晚于模块级初始化）
const { feishuFetch } = await import('../src/services/feishu-auth.js');
const { createDocFromMarkdown } = await import('../src/services/feishu-docs.js');

// 瞬时网络抖动重试（首轮实测 undici ConnectTimeout 打断过一次）
async function retry(fn, label, n = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= n) throw e;
      console.log(`   ${label} 第${i}次失败(${e.message?.slice(0, 60)})，重试…`);
      await new Promise(r => setTimeout(r, 3000 * i));
    }
  }
}

for (const w of WORKS) {
  const title = titleOf(w.dir);
  console.log(`\n── ${title}`);
  console.log(`   计划: 建文档${w.recordId ? ` + 回填主表行 ${w.recordId}` : ' + 新建主表行'}`);
  if (DRY) continue;

  // 幂等：主表行已有母稿文档链接 → 这篇之前跑过，跳过
  if (w.recordId) {
    const cur = await retry(() => feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${CONTENT_TID}/records/${w.recordId}`), '查行');
    if (cur.record?.fields?.['母稿文档']?.link) { console.log('   已有母稿文档，跳过'); continue; }
  }

  const raw = readFileSync(join(W, w.dir, w.file), 'utf8');
  const brief = `> 📋 **创作简报**（历史发布补档）\n> **发布日期**：${w.date}\n> **来源**：writing/published/${w.dir}/${w.file}\n> 本文为已发布定稿的补档，供母稿留存与日后复用。\n\n---\n\n`;
  // md 前面拼简报；html 是完整排版文档，插不进 md 简报，原样导入（简报信息主表行里都有）
  const content = w.ext === 'md' ? brief + raw : raw;
  const doc = await retry(() => createDocFromMarkdown({ title, markdown: content, fileExtension: w.ext }), '建文档');
  console.log(`   文档 ✓ ${doc.url}`);

  const docField = { '母稿文档': { link: doc.url, text: '母稿' } };
  if (w.recordId) {
    await retry(() => feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${CONTENT_TID}/records/${w.recordId}`, {
      method: 'PUT', body: { fields: docField },
    }), '回填');
    console.log('   回填主表行 ✓');
  } else {
    const r = await retry(() => feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${CONTENT_TID}/records`, {
      method: 'POST',
      body: { fields: { '母稿标题': title, '状态': '已分发', '创建日期': new Date(w.date).getTime(), ...docField } },
    }), '建行');
    console.log(`   新建主表行 ✓ ${r.record?.record_id}`);
  }
}
console.log('\n完成');
