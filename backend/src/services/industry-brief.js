import { getDatabase } from '../db/init.js';

// 行业面（VISION-V4 阶段2）：报告/简报里的"行业全貌"——不重新生成，直接复用已同步的 AI HOT
// 热门内容（source_app='aihot'，AI HOT 已替我们策展）。按分数取窗口内前 N 条作提要，
// 每条链到它的全文解读页，另给一键跳转 AI HOT 站点看完整日/周/月榜。零 LLM 成本。
// 用户拍板"提要+跳转，不重复造轮子"。

const AIHOT_SITE = process.env.AIHOT_SITE_URL || 'https://aihot.virxact.com';
// 窗口略放宽，容错同步偶尔缺一天
const WINDOW_DAYS = { daily: 2, weekly: 8, monthly: 31 };
const LIMITS = { daily: 6, weekly: 10, monthly: 12 };

export function getIndustryBrief(period = 'daily') {
  const days = WINDOW_DAYS[period] || 2;
  const limit = LIMITS[period] || 6;

  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, zh_title AS title, zh_summary AS summary, url, permalink,
           external_score AS score, tags,
           COALESCE(published_at, created_at) AS published_at
    FROM contents
    WHERE source_app = 'aihot'
      AND datetime(COALESCE(published_at, created_at)) > datetime('now', '-' || ? || ' days')
    ORDER BY external_score DESC, datetime(COALESCE(published_at, created_at)) DESC
    LIMIT ?
  `).all(days, limit);
  db.close();

  const items = rows.map(r => {
    let selected = false;
    try { selected = JSON.parse(r.tags || '[]').includes('精选'); } catch { /* noop */ }
    return {
      id: r.id,
      title: r.title,
      summary: (r.summary || '').slice(0, 120),
      link: r.permalink || r.url,  // 优先 AI HOT 全文解读页
      score: r.score,
      selected,
      publishedAt: r.published_at,
    };
  });

  // 跳 AI HOT 对应周期的完整榜页（用户 2026-07-18 指正：站点是 /daily /weekly /monthly）
  return { period, items, jumpUrl: `${AIHOT_SITE}/${period}`, source: 'AI HOT' };
}
