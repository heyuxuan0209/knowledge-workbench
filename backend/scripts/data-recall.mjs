#!/usr/bin/env node
/**
 * 发布数据到期回收提醒（确定性任务，不依赖 Agent）。
 *
 * 用法：
 *   cd backend
 *   node scripts/data-recall.mjs             # 只读预览
 *   node scripts/data-recall.mjs --json      # 机器可读预览
 *   node scripts/data-recall.mjs --notify    # 有到期项才发「KW · 数据复盘」群
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { feishuFetch } from '../src/services/feishu-auth.js';

const APP = process.env.KW_BITABLE_APP || 'QIlkbwmGma9Tb1sRyAicfZeEnjb';
const TABLE = process.env.KW_PUBLISH_TABLE || 'tblL11CZzfQSxIy9';
const REVIEW_CHAT = process.env.KW_REVIEW_CHAT_ID;
const NOTIFY_APP_ID = process.env.KW_NOTIFY_FEISHU_APP_ID;
const NOTIFY_APP_SECRET = process.env.KW_NOTIFY_FEISHU_APP_SECRET;
const DAY = 86_400_000;
const STAGES = new Map([
  ['待回收D7', { label: 'D7', days: 7 }],
  ['待回收D30', { label: 'D30', days: 30 }],
]);

const flatText = (value) => Array.isArray(value)
  ? value.map((item) => item?.text ?? item).join('')
  : (value?.text ?? value ?? '');

async function fetchAllRecords() {
  let pageToken;
  const records = [];
  do {
    const data = await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
      query: { page_size: 100, page_token: pageToken },
    });
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return records;
}

export function findDueRecords(records, timestamp = Date.now()) {
  return records.flatMap((record) => {
    const fields = record.fields || {};
    const title = String(flatText(fields['平台化标题'])).trim();
    const platform = String(flatText(fields['平台'])).trim();
    const status = String(flatText(fields['回收状态'])).trim();
    const publishedAt = Number(fields['发布时间'] || 0);
    const stage = STAGES.get(status);

    if (!stage || !publishedAt || !title) return [];
    if (platform === 'X' || /示例|可删/.test(title)) return [];

    const ageDays = (timestamp - publishedAt) / DAY;
    if (ageDays < stage.days) return [];
    return [{
      recordId: record.record_id,
      title,
      platform: platform || '未标平台',
      stage: stage.label,
      ageDays,
    }];
  }).sort((left, right) => right.ageDays - left.ageDays);
}

export function buildReminderText(due) {
  const lines = due.map((item) =>
    `• ${item.title}\n  ${item.platform} · 已发布 ${item.ageDays.toFixed(1)} 天 · 请补 ${item.stage} 后台截图`
  );
  return `数据回收提醒：目前有 ${due.length} 条到期未回收。\n\n${lines.join('\n\n')}\n\n请把截图直接发在本群，Codex 会按同口径回填；X 平台不催。`;
}

async function sendReminder(text) {
  if (!NOTIFY_APP_ID || !NOTIFY_APP_SECRET) {
    return feishuFetch('/open-apis/im/v1/messages', {
      method: 'POST',
      query: { receive_id_type: 'chat_id' },
      body: {
        receive_id: REVIEW_CHAT,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }

  const base = (process.env.FEISHU_BASE || 'https://open.feishu.cn').replace(/\/$/, '');
  const authResponse = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: NOTIFY_APP_ID, app_secret: NOTIFY_APP_SECRET }),
  });
  const auth = await authResponse.json();
  if (auth.code !== 0 || !auth.tenant_access_token) {
    throw new Error(`Codex 飞书身份鉴权失败(${auth.code}): ${auth.msg || '未知错误'}`);
  }

  const response = await fetch(`${base}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.tenant_access_token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      receive_id: REVIEW_CHAT,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  const result = await response.json();
  if (result.code !== 0) {
    throw new Error(`Codex 飞书身份发消息失败(${result.code}): ${result.msg || '未知错误'}`);
  }
  return result.data;
}

async function main() {
  const notify = process.argv.includes('--notify');
  const asJson = process.argv.includes('--json');
  if (notify && !REVIEW_CHAT) {
    throw new Error('缺 KW_REVIEW_CHAT_ID（backend/.env）——「KW · 数据复盘」群 chat_id');
  }

  const records = await fetchAllRecords();
  const due = findDueRecords(records);
  const result = { checked: records.length, due: due.length, items: due };

  if (notify && due.length) {
    await sendReminder(buildReminderText(due));
    result.notified = true;
  } else {
    result.notified = false;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!due.length) {
    console.log(`数据回收巡检：检查 ${records.length} 条，无 D7/D30 到期项，不发送。`);
  } else {
    console.log(buildReminderText(due));
    console.log(notify ? '\n已发送到数据复盘群。' : '\n预览模式：未发送。');
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
