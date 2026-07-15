import dotenv from 'dotenv';
dotenv.config();

import { getDatabase } from '../db/init.js';
import { upsertContents } from '../db/contents.js';
import { translateText } from './translation.js';
import { CHANNEL_ADAPTERS } from './active-query-channels.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// active-query 执行器（ADR-014）：遍历登记源里 track_mode='active-query' 的平台身份，
// 逐源调渠道适配器拉最新内容 → 翻译新条目 → upsert 入 Feed。
// 设计约束：
// - 按源隔离失败：一个源/渠道挂了（上游接口失效、网络）不阻塞其余，结果里如实列出
// - 只翻译"库里还没有"的新条目（B站中文内容零 LLM 成本；YouTube 标题/GitHub 简介才翻）
// - 轻量低频：每源每次只拉最新 N 条，适合每日 1-2 次 crontab，不做高频轮询
//
// 手动：cd backend && node src/services/sync-active-query.js
// 定时（可选）：0 8,20 * * * cd <backend目录> && /usr/local/bin/node src/services/sync-active-query.js

const PER_SOURCE_LIMIT = 5;

function loadActiveQuerySources() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT sp.platform, sp.handle, s.display_name, s.id AS source_id
    FROM source_platforms sp
    JOIN sources s ON sp.source_id = s.id
    WHERE sp.track_mode = 'active-query'
      AND s.registered_by_user = 1
      AND s.status = 'active'
  `).all();
  db.close();
  return rows;
}

// 分拣（幂等重跑不重复花钱，upsert 的 COALESCE 保证补上的字段不被后续空值抹掉）：
// - newItems：首次入库
// - toTranslate：库里缺 zh_title 的（含上次翻译失败留白的，自动重试）
// - toEnrich：YouTube 条目库里缺 published_at 的 —— flat 列表拿不到简介/发布时间，
//   逐个补取详情。published_at 兼作"已增强"标记（详情必有），真没简介的视频不会反复重取
function partitionItems(items) {
  if (items.length === 0) return { newItems: [], toTranslate: [], toEnrich: [] };
  const db = getDatabase();
  const placeholders = items.map(() => '?').join(',');
  const existing = new Map(
    db.prepare(`SELECT id, zh_title, published_at FROM contents WHERE id IN (${placeholders})`)
      .all(...items.map(i => i.content.id)).map(r => [r.id, r])
  );
  db.close();
  const newItems = items.filter(i => !existing.has(i.content.id));
  const toTranslate = items.filter(i => {
    const row = existing.get(i.content.id);
    return !row || (!row.zh_title && i.content.en_title);
  });
  const toEnrich = items.filter(i => {
    const row = existing.get(i.content.id);
    return i.content.id.startsWith('yt-') && (!row || !row.published_at);
  });
  return { newItems, toTranslate, toEnrich };
}

async function translateNewItems(newItems) {
  for (const { content } of newItems) {
    try {
      if (content.en_title && !content.zh_title) {
        content.zh_title = await translateText(content.en_title);
        content.has_translation = 1;
      }
      if (content.en_summary && !content.zh_summary) {
        content.zh_summary = await translateText(content.en_summary);
      }
    } catch (err) {
      // 翻译失败不阻塞入库：en_title 仍可展示；下次同步会作为"待补翻译"重试
      console.error(`  ⚠️ translate failed for ${content.id}: ${err.message}`);
    }
  }
}

export async function syncActiveQuery({ limit = PER_SOURCE_LIMIT } = {}) {
  const sources = loadActiveQuerySources();
  if (sources.length === 0) {
    console.log('ℹ️  没有 active-query 登记源（在信源页登记 B站 UP 主 / YouTube 频道 / GitHub 用户后再跑）');
    return { success: true, sources: 0, fetched: 0, inserted: 0, skipped: [], failed: [] };
  }

  console.log(`🔄 active-query: ${sources.length} 个登记源`);
  const allItems = [];
  const skipped = [];
  const failed = [];

  for (const src of sources) {
    const adapter = CHANNEL_ADAPTERS[src.platform];
    if (!adapter) {
      // 登录态渠道（X 等）第一期不接：如实记录跳过原因，不静默（ADR-014 范围声明）
      skipped.push({ source: src.display_name, platform: src.platform, reason: '登录态渠道未解锁（需用户授权后接入）' });
      continue;
    }
    try {
      const items = await adapter({ handle: src.handle, displayName: src.display_name }, limit);
      console.log(`  ✓ ${src.platform}/${src.display_name}: ${items.length} 条`);
      allItems.push(...items);
    } catch (err) {
      console.error(`  ✗ ${src.platform}/${src.display_name}: ${err.message}`);
      failed.push({ source: src.display_name, platform: src.platform, error: err.message.slice(0, 200) });
    }
  }

  const { newItems, toTranslate, toEnrich } = partitionItems(allItems);

  // YouTube 详情增强（简介 + 发布时间），每轮上限 8 个防积压拖长；失败静默、下轮重试
  const { fetchYoutubeDetail } = await import('./active-query-channels.js');
  for (const item of toEnrich.slice(0, 8)) {
    const detail = await fetchYoutubeDetail(item.content.id.slice(3));
    if (detail) {
      item.content.en_summary = item.content.en_summary || detail.description;
      item.content.published_at = item.content.published_at || detail.publishedAt;
    }
  }

  // 翻译集合 = 缺标题的 + 刚增强出简介的（translateNewItems 内部按字段判空，不重复翻）
  const translateSet = [...new Set([...toTranslate, ...toEnrich])];
  await translateNewItems(translateSet);

  // upsert 全量（旧条目按 ON CONFLICT 更新 external_score 等，新条目插入）
  const upserted = allItems.length ? upsertContents(allItems) : 0;

  const result = {
    success: failed.length < sources.length, // 全军覆没才算失败
    sources: sources.length,
    fetched: allItems.length,
    inserted: newItems.length,
    upserted,
    skipped,
    failed,
  };
  console.log(`✅ active-query done: ${result.fetched} fetched / ${result.inserted} new${skipped.length ? ` / ${skipped.length} 源跳过` : ''}${failed.length ? ` / ${failed.length} 源失败` : ''}`);
  return result;
}

// 路径含中文目录，不能用 import.meta.url === `file://${argv[1]}` 判断入口（百分号编码问题）
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  syncActiveQuery().then(result => {
    for (const s of result.skipped) console.log(`  ⏭ 跳过 ${s.platform}/${s.source}：${s.reason}`);
    for (const f of result.failed) console.log(`  ❌ ${f.platform}/${f.source}：${f.error}`);
    process.exit(result.success ? 0 : 1);
  });
}
