#!/usr/bin/env node
// 把（已翻译的）新条目增量写入单一 Markdown 文件 data/digest.md。
// 最新一天的板块置顶；同时把结构化条目追加到 data/items.jsonl 供程序化消费。
//
// 作为库使用: import { writeDigest } from './write-digest.mjs'

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFeeds } from './fetch-feeds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const DIGEST_PATH = join(DATA_DIR, 'digest.md');
const JSONL_PATH = join(DATA_DIR, 'items.jsonl');
const SENTINEL = '<!-- SECTIONS-BELOW -->';

function localDate(d = new Date()) { return d.toLocaleDateString('en-CA'); }        // YYYY-MM-DD
function localStamp(d = new Date()) {
  return `${d.toLocaleDateString('en-CA')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function header(stamp) {
  return [
    '# 资讯追更 · Feed Digest',
    '',
    `> 每日增量抓取 · 标题自动翻译为中文 · 由 \`feed-digest\` skill 生成`,
    `> 最后更新：${stamp}`,
    '',
    SENTINEL,
    '',
  ].join('\n');
}

function itemLine(it) {
  const zh = it.title_zh || it.title;
  const en = it.title && it.title !== zh ? ` — ${it.title}` : '';
  const score = it.score != null ? ` · ▲${it.score}` : '';
  return `- [${zh}](${it.url})${en} · ${it.source_zh || it.source}${score}`;
}

// items: [{category, source, source_zh, title, title_zh, url, date, score, cadence, sourceId}]
export function writeDigest(items, { stamp = localStamp(), day = localDate() } = {}) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const catOrder = loadFeeds().categories;

  // 分组
  const byCat = new Map();
  for (const it of items) {
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category).push(it);
  }
  const cats = [...catOrder.filter(c => byCat.has(c)), ...[...byCat.keys()].filter(c => !catOrder.includes(c))];

  const lines = [`## ${day} · 新增 ${items.length} 条`, ''];
  for (const c of cats) {
    const arr = byCat.get(c);
    lines.push(`### ${c}（${arr.length}）`, '');
    for (const it of arr) lines.push(itemLine(it));
    lines.push('');
  }
  const section = lines.join('\n');

  // 读旧文件，拆出 sentinel 之后的历史板块
  let body = '';
  if (existsSync(DIGEST_PATH)) {
    const old = readFileSync(DIGEST_PATH, 'utf8');
    const idx = old.indexOf(SENTINEL);
    body = idx >= 0 ? old.slice(idx + SENTINEL.length).replace(/^\s*\n/, '') : old;
  }
  writeFileSync(DIGEST_PATH, header(stamp) + '\n' + section + '\n' + body);

  // JSONL：追加，供 workbench 程序化消费
  const jsonl = items.map(it => JSON.stringify({ ...it, ingestedAt: new Date().toISOString() })).join('\n');
  if (jsonl) appendFileSync(JSONL_PATH, jsonl + '\n');

  return { digestPath: DIGEST_PATH, jsonlPath: JSONL_PATH, day, count: items.length };
}

// CLI: node write-digest.mjs <translated-items.json>
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const f = process.argv[2];
  if (!f || !existsSync(f)) { console.error('用法: node write-digest.mjs <items.json>'); process.exit(1); }
  const items = JSON.parse(readFileSync(f, 'utf8'));
  const r = writeDigest(Array.isArray(items) ? items : items.newItems || []);
  console.log(JSON.stringify(r, null, 2));
}
