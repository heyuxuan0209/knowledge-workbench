#!/usr/bin/env node
/** 把已验收的月报 Markdown 幂等建档到内容工场，并用 Codex 身份发摘要。 */
import 'dotenv/config';
import fs from 'node:fs';
import { createDocFromMarkdown, updateDocFromMarkdown } from '../src/services/feishu-docs.js';
import { feishuFetch } from '../src/services/feishu-auth.js';
import { sendFeishuText } from './lib/feishu-notify.mjs';

const month = process.argv.find((arg) => arg.startsWith('--month='))?.split('=')[1];
const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice('--report='.length);
const dryRun = process.argv.includes('--dry-run');
if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error('缺 --month=YYYY-MM');
if (!reportPath || !fs.existsSync(reportPath)) throw new Error(`月报文件不存在：${reportPath || '(空)'}`);

const SPACE = process.env.FEISHU_WIKI_SPACE_ID;
const ROOT = process.env.FEISHU_WIKI_PARENT_NODE;
const REVIEW_CHAT = process.env.KW_REVIEW_CHAT_ID;
if (!SPACE || !ROOT) throw new Error('缺 FEISHU_WIKI_SPACE_ID / FEISHU_WIKI_PARENT_NODE');
if (!REVIEW_CHAT) throw new Error('缺 KW_REVIEW_CHAT_ID');

async function listChildren(parentNodeToken) {
  const items = [];
  let pageToken;
  do {
    const result = await feishuFetch(`/open-apis/wiki/v2/spaces/${SPACE}/nodes`, {
      query: { page_size: 50, parent_node_token: parentNodeToken, page_token: pageToken },
    });
    items.push(...(result.items || []));
    pageToken = result.has_more ? result.page_token : undefined;
  } while (pageToken);
  return items;
}

function sectionParagraph(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const body = markdown.slice(start + heading.length + 3);
  return body.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#')) || '';
}

const title = `内容作战简报 · ${month}`;
const markdown = fs.readFileSync(reportPath, 'utf8');
const rootChildren = await listChildren(ROOT);
const monthlyFolder = rootChildren.find((node) => node.title === '📰 月度简报');
if (!monthlyFolder) throw new Error('内容工场中找不到「📰 月度简报」节点');

const existing = (await listChildren(monthlyFolder.node_token)).find((node) => node.title === title);
if (dryRun) {
  console.log(JSON.stringify({
    month, title, action: existing ? 'would-update' : 'would-create',
    parentNode: monthlyFolder.title, notify: false,
  }));
  process.exit(0);
}
let url;
let action;
if (existing?.obj_type === 'docx' && existing.obj_token) {
  await updateDocFromMarkdown({ documentId: existing.obj_token, markdown });
  url = `https://my.feishu.cn/wiki/${existing.node_token}`;
  action = 'updated';
} else {
  const result = await createDocFromMarkdown({
    title, markdown, destination: 'wiki', wikiParentToken: monthlyFolder.node_token,
  });
  url = result.url;
  action = 'created';
}

const conclusion = sectionParagraph(markdown, '一句话结论');
const message = [
  `《${title}》已${action === 'created' ? '生成' : '更新'}。`,
  conclusion && `本期结论：${conclusion}`,
  `完整简报：${url}`,
].filter(Boolean).join('\n\n');
await sendFeishuText(REVIEW_CHAT, message, { requireCodex: true });
console.log(JSON.stringify({ month, title, action, url }));
