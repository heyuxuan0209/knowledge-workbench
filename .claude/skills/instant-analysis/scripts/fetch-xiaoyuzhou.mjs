#!/usr/bin/env node
// 小宇宙播客单集抓取（零 npm 依赖，Node 18+ / 系统 curl）。
// 单集页是 SSR，__NEXT_DATA__ 里有完整元数据 + m4a 音频直链，免登录。
// 网络层用 curl（读代理环境变量；Node fetch 不读，见 fetch-article.mjs 注释）。
//
// 用法: node fetch-xiaoyuzhou.mjs <episode_url>
// 输出: JSON { ok, title, author, publishedAt, durationMin, audioUrl, shownotes, error }

import { execFile } from 'child_process';
import { promisify } from 'util';

const pexec = promisify(execFile);

const url = process.argv[2];
if (!url || !url.includes('xiaoyuzhoufm.com')) {
  console.log(JSON.stringify({ ok: false, error: '用法: node fetch-xiaoyuzhou.mjs <小宇宙单集链接>' }));
  process.exit(1);
}

try {
  const { stdout: html } = await pexec('curl', [
    '-sS', '-L', '--max-time', '15',
    '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    url.trim(),
  ], { maxBuffer: 16 * 1024 * 1024 });

  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if (!m) throw new Error('小宇宙页面结构变化，未找到数据块（__NEXT_DATA__）');

  const ep = JSON.parse(m[1])?.props?.pageProps?.episode;
  if (!ep?.title) throw new Error('数据块里没有单集信息（可能是会员专享或已下架）');

  const shownotes = (ep.shownotes || ep.description || '')
    .replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  console.log(JSON.stringify({
    ok: true,
    title: ep.title,
    author: [ep.podcast?.title, ep.podcast?.author].filter(Boolean).join(' · ') || null,
    publishedAt: ep.pubDate?.slice(0, 10) || null,
    durationMin: ep.duration ? Math.round(ep.duration / 60) : null,
    audioUrl: ep.enclosure?.url || ep.media?.source?.url || null,
    shownotes,
  }));
} catch (err) {
  const reason = (err.stderr || err.message || '').toString().trim().slice(0, 300);
  console.log(JSON.stringify({ ok: false, error: `小宇宙页面抓取失败：${reason}` }));
  process.exit(1);
}
