#!/usr/bin/env node
// 信源抓取 + 增量去重（零 npm 依赖，Node 18+ / 系统 curl）。
//
// 设计要点（沿用 knowledge-workbench 项目实战）：
// - 网络层用 curl 子进程而非 Node fetch：curl 天然读 http_proxy/https_proxy 环境变量，
//   国内网络挂代理时（访问 Google/Substack 系）才拉得动；--compressed 自动解 gzip。
// - 增量：data/state.json 记录每源已见条目指纹（url/guid 的 sha1），只吐新条目。
// - 每源多候选 URL 依次尝试 + 主页 RSS 自动发现兜底，容忍单个 feed 地址失效。
// - 单源失败不影响其他源（隔离），失败原因写进 report 如实上报，不静默吞掉。
//
// 用法:
//   node fetch-feeds.mjs               # 抓取，打印新条目 JSON（不落 state）
//   node fetch-feeds.mjs --commit      # 抓取并把 state 推进（供独立调用/调试）
//   node fetch-feeds.mjs --source hf-papers   # 只抓某一个源
//
// 作为库使用: import { collectNewItems, persistState, loadFeeds } from './fetch-feeds.mjs'

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const pexec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const STATE_PATH = join(DATA_DIR, 'state.json');
const FEEDS_PATH = join(ROOT, 'feeds.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const DEFAULT_MAXNEW = 12;   // 每源每次最多新增条目（首跑防爆量 + 日常防刷屏）
const POOL = 6;              // 并发抓取源数

// ---------- 通用工具 ----------
function fp(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16); }

function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')        // 标题里偶有内联标签，剥掉
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

async function curl(url, { json = false } = {}) {
  let stdout;
  try {
    ({ stdout } = await pexec('curl', [
      '-fsSL', '--compressed', '--max-time', '30', '-A', UA,
      '-H', 'Accept: application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.8',
      url,
    ], { maxBuffer: 48 * 1024 * 1024 }));
  } catch (e) {
    // curl 的真实错误在 stderr（-f 会把 HTTP ≥400 也变成失败）
    const why = (e.stderr || e.message || '').toString().trim().split('\n').pop().slice(0, 160);
    throw new Error(why || 'curl 失败');
  }
  if (json) return JSON.parse(stdout);
  return stdout;
}

async function mapPool(items, fn, concurrency = POOL) {
  const ret = new Array(items.length);
  let i = 0;
  const n = Math.min(concurrency, items.length) || 1;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; ret[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return ret;
}

// ---------- 解析器 ----------
function tagText(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

// RSS <item> / Atom <entry> 通用解析
export function parseFeed(xml) {
  const items = [];
  let blocks = xml.match(/<item[\s\S]*?<\/item>/gi);
  const isAtom = !blocks;
  if (isAtom) blocks = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = tagText(b, 'title');
    let link = '';
    if (!isAtom) {
      link = tagText(b, 'link');
    }
    if (!link) {
      const alt = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
        || b.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i)
        || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (alt) link = decodeEntities(alt[1]);
    }
    const guid = tagText(b, 'guid') || tagText(b, 'id') || link;
    const date = tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date') || '';
    if (title && (link || guid)) items.push({ title, url: link || guid, guid: guid || link, date });
  }
  return items;
}

// ---------- 各类型抓取 ----------
async function fetchRss(src) {
  const urls = src.urls || (src.url ? [src.url] : []);
  let lastErr = null;
  for (const u of urls) {
    try {
      const xml = await curl(u);
      const items = parseFeed(xml);
      if (items.length) return items.map(it => ({ ...it, id: fp(it.guid || it.url) }));
      lastErr = new Error(`feed 返回 0 条（${u}）`);
    } catch (e) { lastErr = new Error(`${u} → ${(e.message || '').slice(0, 120)}`); }
  }
  // 兜底：抓主页做 <link rel=alternate type=application/rss+xml> 自动发现
  if (src.discover) {
    try {
      const home = await curl(src.discover);
      const m = home.match(/<link[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i)
        || home.match(/<link[^>]*href=["']([^"']+)["'][^>]*type=["']application\/(?:rss|atom)\+xml["']/i);
      if (m) {
        let href = decodeEntities(m[1]);
        if (href.startsWith('//')) href = 'https:' + href;
        else if (href.startsWith('/')) href = new URL(src.discover).origin + href;
        const xml = await curl(href);
        const items = parseFeed(xml);
        if (items.length) return items.map(it => ({ ...it, id: fp(it.guid || it.url) }));
      }
    } catch (e) { lastErr = new Error(`自动发现失败 → ${(e.message || '').slice(0, 120)}`); }
  }
  throw lastErr || new Error('无可用 feed');
}

export function transformHF(data, min = 0) {
  const arr = Array.isArray(data) ? data : [];
  return arr.map(e => {
    const paper = e.paper || e;
    const id = paper.id || e.id || '';
    const votes = paper.upvotes ?? e.upvotes ?? paper.score ?? 0;
    const title = (paper.title || e.title || '').replace(/\s+/g, ' ').trim();
    return { id: `hf-${id}`, title, url: `https://huggingface.co/papers/${id}`, date: paper.publishedAt || e.publishedAt || '', score: votes };
  }).filter(x => x.title && x.id !== 'hf-' && x.score >= min)
    .sort((a, b) => b.score - a.score);
}
async function fetchHF(src) {
  const data = await curl(src.url, { json: true });
  return transformHF(data, src.rules?.minScore ?? 0);
}

async function fetchHN(src) {
  const cap = src.rules?.maxNew ?? 8;
  const ids = await curl('https://hacker-news.firebaseio.com/v0/topstories.json', { json: true });
  const pick = (ids || []).slice(0, Math.max(cap * 4, 30));   // 多取候选，去重后再截 maxNew
  const items = await mapPool(pick, async (id) => {
    try { return await curl(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { json: true }); }
    catch { return null; }
  }, 8);
  return items
    .filter(it => it && it.type === 'story' && it.title)
    .map(it => ({
      id: `hn-${it.id}`,
      title: it.title,
      url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      date: it.time ? new Date(it.time * 1000).toUTCString() : '',
      score: it.score || 0,
    }));
}

// Paul Graham 官网无 RSS：直接解析 articles.html 的随笔链接列表
export function parsePG(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([a-zA-Z0-9_-]+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const title = decodeEntities(m[2]);
    if (!title || href === 'index.html' || href === 'articles.html' || href === 'rss.html') continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const url = `https://paulgraham.com/${href}`;
    out.push({ id: fp(url), title, url, date: '' });
  }
  return out;   // articles.html 顶部即最新
}
async function fetchPG(src) {
  return parsePG(await curl(src.url));
}

async function fetchByType(src) {
  switch (src.type) {
    case 'json-hf': return fetchHF(src);
    case 'json-hn': return fetchHN(src);
    case 'scrape-pg': return fetchPG(src);
    case 'rss':
    default: return fetchRss(src);
  }
}

// ---------- state ----------
export function loadFeeds() {
  return JSON.parse(readFileSync(FEEDS_PATH, 'utf8'));
}
function loadState() {
  if (!existsSync(STATE_PATH)) return { version: 1, sources: {} };
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); }
  catch { return { version: 1, sources: {} }; }
}
export function persistState(state) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ---------- 主流程 ----------
// 返回 { newItems, report, state }；state 未持久化，由调用方决定何时落盘。
export async function collectNewItems({ only = null } = {}) {
  const cfg = loadFeeds();
  const state = loadState();
  const nowIso = new Date().toISOString();
  const sources = cfg.sources.filter(s => !only || s.id === only);

  const results = await mapPool(sources, async (src) => {
    const prevSeen = state.sources[src.id]?.seen || [];
    const seen = new Set(prevSeen);
    let candidates = [], error = null;
    try { candidates = await fetchByType(src); }
    catch (e) { error = (e.message || String(e)).slice(0, 200); }

    const maxNew = src.rules?.maxNew ?? DEFAULT_MAXNEW;
    const fresh = [];
    for (const it of candidates) {
      if (!it || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      fresh.push(it);
      if (fresh.length >= maxNew) break;
    }
    // 维护指纹窗口：保留仍在 feed 中的旧指纹 + 本次新增，末尾截断 500
    const keep = [];
    const stillHere = new Set(candidates.map(c => c && c.id).filter(Boolean));
    for (const id of prevSeen) if (stillHere.has(id)) keep.push(id);
    for (const it of fresh) keep.push(it.id);
    const nextSeen = keep.slice(-500);

    return { src, error, fetched: candidates.length, fresh, nextSeen };
  });

  const newItems = [];
  const report = [];
  for (const r of results) {
    state.sources[r.src.id] = { seen: r.nextSeen, lastRun: nowIso, lastError: r.error || null };
    report.push({ id: r.src.id, name: r.src.name, category: r.src.category, fetched: r.fetched, new: r.fresh.length, error: r.error || null });
    for (const it of r.fresh) {
      newItems.push({
        sourceId: r.src.id, source: r.src.name, source_zh: r.src.name_zh,
        category: r.src.category, cadence: r.src.cadence,
        title: it.title, url: it.url, date: it.date || '', score: it.score ?? null,
      });
    }
  }
  return { newItems, report, state, generatedAt: nowIso };
}

// ---------- CLI ----------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const only = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
  const commit = args.includes('--commit');
  collectNewItems({ only }).then(({ newItems, report, state, generatedAt }) => {
    if (commit) persistState(state);
    console.log(JSON.stringify({ generatedAt, committed: commit, count: newItems.length, report, newItems }, null, 2));
  }).catch(err => {
    console.error('FATAL', err);
    process.exit(1);
  });
}
