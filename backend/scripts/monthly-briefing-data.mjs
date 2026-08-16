#!/usr/bin/env node
/**
 * 为《内容作战简报》生成确定性数据包。只读飞书，不调用模型、不写表、不发消息。
 *
 * 用法：node scripts/monthly-briefing-data.mjs [--month=YYYY-MM] [--output=/path/data.json]
 */
import 'dotenv/config';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { feishuFetch } from '../src/services/feishu-auth.js';

const APP = process.env.KW_BITABLE_APP || 'QIlkbwmGma9Tb1sRyAicfZeEnjb';
const CONTENT_TABLE = process.env.KW_CONTENT_TABLE || 'tblna4uWPhP0qQMH';
const PUBLISH_TABLE = process.env.KW_PUBLISH_TABLE || 'tblL11CZzfQSxIy9';
const STAGES = ['D3', 'D7', 'D30'];

const flatText = (value) => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(flatText).join('');
  if (typeof value === 'object') return value.text ?? value.name ?? value.link ?? '';
  return String(value);
};

const numberOrNull = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`月份格式应为 YYYY-MM：${month}`);
  const [year, rawMonth] = month.split('-').map(Number);
  const start = Date.parse(`${month}-01T00:00:00+08:00`);
  const endYear = rawMonth === 12 ? year + 1 : year;
  const endMonth = rawMonth === 12 ? 1 : rawMonth + 1;
  const end = Date.parse(`${endYear}-${String(endMonth).padStart(2, '0')}-01T00:00:00+08:00`);
  return { start, end };
}

export function currentMonthCst(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}`;
}

async function fetchAll(table) {
  const items = [];
  let pageToken;
  do {
    const result = await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${table}/records`, {
      query: { page_size: 100, page_token: pageToken },
    });
    items.push(...(result.items || []));
    pageToken = result.has_more ? result.page_token : undefined;
  } while (pageToken);
  return items;
}

function linkedIds(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (Array.isArray(item?.record_ids)) return item.record_ids;
    return [item?.record_id || item?.recordId || item?.id].filter(Boolean);
  });
}

function normalizePublish(record) {
  const fields = record.fields || {};
  const metrics = Object.fromEntries(STAGES.map((stage) => [stage, {
    exposure: numberOrNull(fields[`${stage}曝光`]),
    engagementRate: numberOrNull(fields[`${stage}互动率`]),
    clickRate: numberOrNull(fields[`${stage}点击率`]),
    followers: numberOrNull(fields[`${stage}涨粉`]),
    spread: flatText(fields[`${stage}传播`]),
  }]));
  return {
    recordId: record.record_id,
    title: flatText(fields['平台化标题']),
    platform: flatText(fields['平台']),
    format: flatText(fields['形态']),
    publishedAt: numberOrNull(fields['发布时间']),
    status: flatText(fields['回收状态']),
    comments: flatText(fields['评论摘录']),
    contentRecordIds: linkedIds(fields['关联母稿']),
    metrics,
  };
}

function normalizeContent(record) {
  const fields = record.fields || {};
  return {
    recordId: record.record_id,
    title: flatText(fields['母稿标题']),
    topic: flatText(fields['选题标签']),
    genre: flatText(fields['文体']),
    series: flatText(fields['系列']),
    status: flatText(fields['状态']),
    verdict: flatText(fields['验证结论']),
  };
}

function stageSummary(records, stage) {
  const usable = records.filter((record) => record.metrics[stage].exposure != null);
  const exposures = usable.map((record) => record.metrics[stage].exposure);
  return {
    stage,
    sampleSize: usable.length,
    averageExposure: exposures.length
      ? Math.round(exposures.reduce((sum, value) => sum + value, 0) / exposures.length)
      : null,
    medianExposure: exposures.length
      ? [...exposures].sort((a, b) => a - b)[Math.floor(exposures.length / 2)]
      : null,
    completeEngagement: usable.filter((record) => record.metrics[stage].engagementRate != null).length,
  };
}

export function buildBriefingPackage({ month, publishRecords, contentRecords, generatedAt = new Date() }) {
  const { start, end } = monthRange(month);
  const publications = publishRecords.map(normalizePublish)
    .filter((record) => record.publishedAt >= start && record.publishedAt < end)
    .sort((left, right) => left.publishedAt - right.publishedAt);
  const relevantContentIds = new Set(publications.flatMap((record) => record.contentRecordIds));
  const contents = contentRecords.map(normalizeContent)
    .filter((record) => relevantContentIds.has(record.recordId));
  const platforms = [...new Set(publications.map((record) => record.platform).filter(Boolean))].sort();
  const byPlatform = Object.fromEntries(platforms.map((platform) => {
    const rows = publications.filter((record) => record.platform === platform);
    return [platform, {
      publications: rows.length,
      stages: STAGES.map((stage) => stageSummary(rows, stage)),
    }];
  }));
  const missing = Object.fromEntries(STAGES.map((stage) => [stage,
    publications.filter((record) => record.metrics[stage].exposure == null).map((record) => ({
      title: record.title, platform: record.platform, status: record.status,
    })),
  ]));

  return {
    schemaVersion: 1,
    month,
    generatedAt: generatedAt.toISOString(),
    rules: {
      sameAgeOnly: '跨内容比较必须 D3 比 D3、D7 比 D7、D30 比 D30',
      minimumSample: 5,
      attribution: '归因需同时看数字与评论；没有分发因素证据时标注假设，不编造',
      northStar: '价值与同频密度优先于单纯流量',
    },
    counts: { publications: publications.length, linkedContents: contents.length },
    byPlatform,
    missing,
    contents,
    publications,
  };
}

async function main() {
  const month = process.argv.find((arg) => arg.startsWith('--month='))?.split('=')[1] || currentMonthCst();
  const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);
  const [publishRecords, contentRecords] = await Promise.all([
    fetchAll(PUBLISH_TABLE), fetchAll(CONTENT_TABLE),
  ]);
  const data = buildBriefingPackage({ month, publishRecords, contentRecords });
  const text = JSON.stringify(data, null, 2);
  if (output) {
    fs.writeFileSync(output, `${text}\n`, { mode: 0o600 });
    console.error(`月报数据包：${data.counts.publications} 条发布记录 → ${output}`);
  } else {
    console.log(text);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
