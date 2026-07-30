// 历史发布补档 v2（ADR-063）：6 篇已发布定稿 → 统一干净 md → 用户知识库「母稿」节点。
// v1 教训：排版 HTML 直接导入=公众号样式进了母稿库，用户否决——母稿必须是干净原始稿（评审/改稿用），
// 排版是创作台定稿后的事。4 篇 HTML 已人工提净为 /tmp/母稿-*.md，2 篇本就是 md（加简报头）。
// 用法：cd backend && node scripts/backfill-published-to-feishu.mjs
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';

const W = join(process.env.HOME, 'Documents/项目/writing/published');
const APP = 'QIlkbwmGma9Tb1sRyAicfZeEnjb';
const CONTENT_TID = 'tblna4uWPhP0qQMH';

const WORKS = [
  { title: '别再逼自己"把需求想清楚"了', src: join(W, '2026-07-16-别再逼自己把需求想清楚了/小红书长文.md'), date: '2026-07-16', recordId: 'recvqPQ1FBwovr', addBrief: true },
  { title: '我的收藏夹从「稍后读」变成了「已读懂」', src: join(W, '2026-07-17-read-anything/长文-小红书公众号.md'), date: '2026-07-17', recordId: 'recvqPHDnkWOQl', addBrief: true },
  { title: '和 AI 高效协作，可能"说清楚"只对了一半', src: '/tmp/母稿-说清楚.md', date: '2026-07-21', recordId: 'recvqPHDnk7wjo', addBrief: false },
  { title: 'AI 早就够强了，是我们把它拴住了', src: '/tmp/母稿-拴住了.md', date: '2026-07-24', recordId: 'recvqPHDnkIWFV', addBrief: false },
  { title: '有些需求，天生说不清楚', src: '/tmp/母稿-说不清楚.md', date: '2026-07-29', recordId: 'recvqPos5m88N3', addBrief: false },
  { title: '让 AI 整理文件夹之前，先看看我踩的两个坑', src: '/tmp/母稿-排雷.md', date: '2026-07-31', recordId: 'recvqPQz3vHNl9', addBrief: false },
];

// v1 建在云空间的旧文档（样式错/位置错），重建后尝试删除；删不掉的（owner 已是用户）列给用户手删
const OLD_DOC_TOKENS = [
  'TUdWdLTU6osYGcxXmMpcSa2Fnhf', 'FHqAdo8JXomS7axLwx5cV3ggnXe', 'KhZ7dWHKUoRjLkxqEfYcChJLnot',
  'F38tdMxg3orFafx1S8rcRttjn9e', 'UyGQdu7c0oX2l2xcmrZcaCyQnkg', 'LPqNdOBouoqMo1xEbxTcpxPmnAh',
  'Mrc1dRoiMoTvgnxqwPBczwXZnkh', // Phase1 链路测试
];

const { feishuFetch } = await import('../src/services/feishu-auth.js');
const { createDocFromMarkdown } = await import('../src/services/feishu-docs.js');

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
  console.log(`\n── ${w.title}`);
  let content = readFileSync(w.src, 'utf8');
  if (w.addBrief) {
    content = `> 📋 **创作简报**(历史发布补档)\n> **发布日期**:${w.date}\n> **来源**:${w.src.replace(process.env.HOME, '~')}\n\n---\n\n` + content;
  }
  const doc = await retry(() => createDocFromMarkdown({ title: w.title, markdown: content, destination: 'wiki' }), '建档');
  console.log(`   知识库文档 ✓ ${doc.url}`);
  await retry(() => feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${CONTENT_TID}/records/${w.recordId}`, {
    method: 'PUT', body: { fields: { '母稿文档': { link: doc.url, text: '母稿' } } },
  }), '回填');
  console.log('   bitable 链接已更新 ✓');
}

console.log('\n=== 清理 v1 旧文档 ===');
for (const tok of OLD_DOC_TOKENS) {
  try {
    await feishuFetch(`/open-apis/drive/v1/files/${tok}`, { method: 'DELETE', query: { type: 'docx' } });
    console.log(`删除 ✓ ${tok}`);
  } catch (e) {
    console.log(`删除 ✗ ${tok}（${e.message.slice(0, 50)}）→ 需用户在飞书里手动删`);
  }
}
console.log('\n完成');
