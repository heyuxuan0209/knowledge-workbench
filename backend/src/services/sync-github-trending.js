import dotenv from 'dotenv';
dotenv.config();

import { fetchTrendingRepos, transformTrendingRepo } from './github-trending.js';
import { translateText } from './translation.js';
import { upsertContents } from '../db/contents.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// GitHub Trending 同步（对标 sync-hackernews.js 惯例）。
// 手动：node src/services/sync-github-trending.js [daily|weekly]
// 翻译仓库描述会调 Deepseek（每仓库一次，量小）。

export async function syncGitHubTrending(since = 'daily', limit = 15) {
  console.log(`🔄 Syncing GitHub Trending (${since})...`);

  const repos = (await fetchTrendingRepos({ since })).slice(0, limit);
  if (repos.length === 0) {
    console.log('⚠️  No AI-related trending repos found');
    return { success: false, count: 0 };
  }
  console.log(`📥 ${repos.length} AI-related repos on trending`);

  const items = await Promise.all(repos.map(async repo => {
    const { content, sourceInfo } = transformTrendingRepo(repo);
    if (repo.description) {
      const zhDesc = await translateText(repo.description);
      content.zh_title = `${repo.fullName}：${zhDesc}`;
      content.has_translation = 1;
    } else {
      content.zh_title = repo.fullName;
    }
    return { content, sourceInfo };
  }));

  const saved = upsertContents(items);
  console.log('✅ GitHub Trending sync completed');
  return { success: true, count: saved, repos: repos.map(r => `${r.fullName}(+${r.starsToday})`) };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const since = ['daily', 'weekly', 'monthly'].includes(process.argv[2]) ? process.argv[2] : 'daily';
  syncGitHubTrending(since).then(result => {
    console.log('Sync result:', result.success ? `${result.count} repos saved` : 'failed');
    if (result.repos) console.log(result.repos.join(', '));
    process.exit(result.success ? 0 : 1);
  });
}
