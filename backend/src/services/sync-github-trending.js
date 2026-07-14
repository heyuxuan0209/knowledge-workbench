import dotenv from 'dotenv';
dotenv.config();

import { fetchTrendingRepos, transformTrendingRepo } from './github-trending.js';
import { chat } from './llm.js';
import { upsertContents } from '../db/contents.js';
import { getDatabase } from '../db/init.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// GitHub Trending 同步（2026-07-14 用户决策升级版）：
// - 筛选：AI 相关 且「日增星 + 总星」双高；agent/skills/mcp 类项目加权优先
// - LLM 一次调用批量产出：人话中文标题 + 一句话摘要（这项目是做什么的）+ 当日趋势总结
// - 趋势总结存 app_meta（key=github_trend），Feed 页"热门 AI 项目"区块展示
// 手动：node src/services/sync-github-trending.js [daily|weekly]

const SKILL_KEYWORDS = /skill|mcp|agent|claude|copilot|plugin|assistant|workflow/i;

function rankScore(r) {
  const skillBoost = SKILL_KEYWORDS.test(`${r.fullName} ${r.description || ''}`) ? 400 : 0;
  return (r.starsToday || 0) + (r.starsTotal || 0) / 200 + skillBoost;
}

export async function syncGitHubTrending(since = 'daily', limit = 8) {
  console.log(`🔄 Syncing GitHub Trending (${since})...`);

  const all = await fetchTrendingRepos({ since });
  // 双高门槛：日增星 >= 50 或总星 >= 2000，再按综合分取 top N（skills 类加权）
  const repos = all
    .filter(r => (r.starsToday || 0) >= 50 || (r.starsTotal || 0) >= 2000)
    .sort((a, b) => rankScore(b) - rankScore(a))
    .slice(0, limit);

  if (repos.length === 0) {
    console.log('⚠️  No qualified trending repos');
    return { success: false, count: 0 };
  }
  console.log(`📥 ${repos.length}/${all.length} repos qualified (skills 优先加权)`);

  // 一次 LLM 调用：人话标题 + 摘要 + 趋势总结
  const list = repos.map((r, i) =>
    `${i}. ${r.fullName}（${r.language || '?'}，总星 ${r.starsTotal}，今日 +${r.starsToday}）\n   描述：${r.description || '（无）'}`
  ).join('\n');
  const result = await chat([{
    role: 'user',
    content: `以下是今天 GitHub Trending 上的 AI 相关项目。请输出 JSON（不要代码块）：
{
  "items": [{ "title": "人话中文标题（格式：项目名：一句大白话说它是什么，如 airi：开源的 AI 虚拟伴侣框架）", "summary": "40-70字中文摘要：做什么、解决什么问题、为什么热" }],
  "trend": "一句话总结今天 trending 的整体趋势（哪类项目在集中上榜、说明什么风向，60字内）"
}
items 与序号一一对应。

${list}`,
  }]);

  let parsed = { items: [], trend: null };
  if (result.success) {
    try {
      parsed = JSON.parse(result.content.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim());
    } catch { console.warn('⚠️ LLM 输出解析失败，退回机翻描述'); }
  }

  const items = repos.map((repo, i) => {
    const { content, sourceInfo } = transformTrendingRepo(repo);
    const gen = parsed.items?.[i];
    content.zh_title = gen?.title || repo.fullName;
    content.zh_summary = gen?.summary || repo.description || null;
    content.has_translation = gen ? 1 : 0;
    return { content, sourceInfo };
  });

  const saved = upsertContents(items);

  // 趋势总结入 app_meta
  if (parsed.trend) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO app_meta (key, value, updated_at) VALUES ('github_trend', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify({ trend: parsed.trend, date: new Date().toISOString().slice(0, 10) }));
    db.close();
    console.log(`📈 趋势: ${parsed.trend}`);
  }

  console.log('✅ GitHub Trending sync completed');
  return { success: true, count: saved, trend: parsed.trend, repos: repos.map(r => `${r.fullName}(+${r.starsToday})`) };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const since = ['daily', 'weekly', 'monthly'].includes(process.argv[2]) ? process.argv[2] : 'daily';
  syncGitHubTrending(since).then(result => {
    console.log('Sync result:', result.success ? `${result.count} repos saved` : 'failed');
    if (result.repos) console.log(result.repos.join(', '));
    process.exit(result.success ? 0 : 1);
  });
}
