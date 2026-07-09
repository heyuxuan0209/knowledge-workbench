import { getDatabase } from '../db/init.js';

// 获取成本统计
export function getCostStats() {
  const db = getDatabase();

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

  // 今日统计
  const todayStats = db.prepare(`
    SELECT
      COALESCE(SUM(tokens_used), 0) as tokens,
      COALESCE(SUM(cost_yuan), 0) as cost
    FROM messages
    WHERE DATE(created_at) = ?
  `).get(today);

  // 本月统计
  const monthStats = db.prepare(`
    SELECT
      COALESCE(SUM(tokens_used), 0) as tokens,
      COALESCE(SUM(cost_yuan), 0) as cost
    FROM messages
    WHERE DATE(created_at) >= ?
  `).get(monthStart);

  db.close();

  return {
    today: {
      tokens: todayStats.tokens,
      cost: todayStats.cost
    },
    month: {
      tokens: monthStats.tokens,
      cost: monthStats.cost,
      limit: 100 // ¥100/月预算
    }
  };
}

// 获取对话成本统计
export function getConversationCost(conversationId) {
  const db = getDatabase();

  const stats = db.prepare(`
    SELECT
      COALESCE(SUM(tokens_used), 0) as total_tokens,
      COALESCE(SUM(cost_yuan), 0) as total_cost,
      COUNT(*) as message_count
    FROM messages
    WHERE conversation_id = ?
  `).get(conversationId);

  db.close();

  return stats;
}
