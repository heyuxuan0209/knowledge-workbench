import express from 'express';
import db from '../db/db.js';

const router = express.Router();

/**
 * POST /api/feedback
 * 记录用户反馈
 */
router.post('/', (req, res) => {
  try {
    const { item_id, action } = req.body;

    if (!item_id || !action) {
      return res.status(400).json({
        success: false,
        error: 'Missing item_id or action'
      });
    }

    if (!['approve', 'save', 'skip', 'ignore'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be: approve, save, skip, or ignore'
      });
    }

    // 插入反馈记录
    db.feedbacks.insert(item_id, action);

    res.json({
      success: true,
      message: 'Feedback recorded'
    });
  } catch (error) {
    console.error('Error recording feedback:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/feedback/history
 * 获取反馈历史
 */
router.get('/history', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const feedbacks = db.feedbacks.getRecent(parseInt(limit));

    res.json({
      success: true,
      data: feedbacks
    });
  } catch (error) {
    console.error('Error fetching feedback history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
