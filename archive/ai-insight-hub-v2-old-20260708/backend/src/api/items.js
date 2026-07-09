import express from 'express';
import db from '../db/db.js';
import { fetchAIHotItems } from '../adapters/aihot.js';
import { filterItems } from '../core/filter.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// 加载配置
const configPath = join(__dirname, '../../data/config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

/**
 * GET /api/items
 * 获取推荐内容
 */
router.get('/', async (req, res) => {
  try {
    const { date, limit = 20 } = req.query;

    // 1. 从数据库获取或从 API 获取
    let items;
    const today = new Date().toISOString().split('T')[0];
    const targetDate = date || today;

    // 检查是否有缓存数据
    const cached = db.items.findByDate(targetDate);

    if (cached.length > 0) {
      // 使用缓存数据
      items = cached;
      console.log(`Using ${cached.length} cached items from ${targetDate}`);
    } else {
      // 获取新数据
      console.log('Fetching fresh data from AI HOT...');
      const rawItems = await fetchAIHotItems(config.aihot);

      // 保存到数据库
      db.items.insertMany(rawItems);
      items = rawItems;
      console.log(`Fetched and saved ${rawItems.length} new items`);
    }

    // 2. 筛选内容
    const filtered = filterItems(items, config.preferences);

    // 3. 更新相关度分数
    filtered.forEach(item => {
      db.items.updateRelevanceScore(item.id, item.relevance_score);
    });

    res.json({
      success: true,
      data: {
        items: filtered,
        total: items.length,
        filtered: filtered.length,
        date: targetDate
      }
    });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/items/stats
 * 获取统计信息
 */
router.get('/stats', (req, res) => {
  try {
    const totalItems = db.items.count();
    const totalFeedbacks = db.feedbacks.count();
    const savedItems = db.feedbacks.countByAction('save');
    const approvedItems = db.feedbacks.countByAction('approve');

    const stats = {
      total_items: totalItems,
      total_feedbacks: totalFeedbacks,
      saved_items: savedItems,
      approved_items: approvedItems,
      approve_rate: totalFeedbacks > 0 ? (approvedItems + savedItems) / totalFeedbacks : 0
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
