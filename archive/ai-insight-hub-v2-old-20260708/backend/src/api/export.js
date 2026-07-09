import express from 'express';
import db from '../db/db.js';
import { exportToObsidian } from '../core/exporter.js';
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
 * POST /api/export
 * 导出到 Obsidian
 */
router.post('/', async (req, res) => {
  try {
    const { item_id } = req.body;

    if (!item_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing item_id'
      });
    }

    // 获取内容
    const item = db.items.findById(item_id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }

    // 导出到 Obsidian
    const filePath = await exportToObsidian(item, config);

    // 记录导出
    db.exports.insert(item_id, filePath);

    res.json({
      success: true,
      data: {
        file_path: filePath
      }
    });
  } catch (error) {
    console.error('Error exporting to Obsidian:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/export/history
 * 获取导出历史
 */
router.get('/history', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const exports = db.exports.getRecent(parseInt(limit));

    res.json({
      success: true,
      data: exports
    });
  } catch (error) {
    console.error('Error fetching export history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
