import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import { resolveSourceFromInput } from '../services/source-resolver.js';

const router = express.Router();
const DB_PATH = process.env.DB_PATH || './data/app.db';

// 获取信息源列表
router.get('/', (req, res) => {
  const db = new DatabaseSync(DB_PATH);
  try {
    const { track_mode } = req.query;

    let query = `
      SELECT s.id, s.source_type, s.display_name, s.created_at,
             sp.platform, sp.handle, sp.track_mode, sp.platform_metadata
      FROM sources s
      JOIN source_platforms sp ON s.id = sp.source_id
    `;

    if (track_mode) {
      query += ` WHERE sp.track_mode = ?`;
    }

    query += ` ORDER BY s.created_at DESC`;

    const stmt = db.prepare(query);
    const sources = track_mode ? stmt.all(track_mode) : stmt.all();

    res.json({ success: true, data: sources });
  } catch (error) {
    console.error('获取信息源失败:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    db.close();
  }
});

// 智能添加信息源（从用户输入识别）
router.post('/add-by-input', async (req, res) => {
  const { input } = req.body;

  if (!input || typeof input !== 'string') {
    return res.status(400).json({ success: false, error: '缺少 input 参数' });
  }

  try {
    // 调用智能识别
    const resolved = await resolveSourceFromInput(input);

    if (resolved.error) {
      return res.status(400).json({ success: false, error: resolved.error });
    }

    const db = new DatabaseSync(DB_PATH);
    try {
      db.exec('BEGIN TRANSACTION');

      // 检查是否已存在（相同 platform + handle）
      const existing = db.prepare(
        'SELECT s.id FROM sources s JOIN source_platforms sp ON s.id = sp.source_id WHERE sp.platform = ? AND sp.handle = ?'
      ).get(resolved.type, resolved.handle);

      if (existing) {
        db.exec('ROLLBACK');
        return res.status(409).json({ success: false, error: '该信息源已存在' });
      }

      // 插入 source
      const sourceId = randomUUID();

      // 根据平台类型推断 source_type
      const sourceTypeMap = {
        'GitHub': 'GitHubUser',
        'RSS': 'Blog',
        'WeChat': 'Newsletter',
        'Reddit': 'Media'
      };
      const sourceType = sourceTypeMap[resolved.type] || 'Blog';

      db.prepare(`
        INSERT INTO sources (id, source_type, display_name)
        VALUES (?, ?, ?)
      `).run(sourceId, sourceType, resolved.display_name);

      // 插入 source_platform
      db.prepare(`
        INSERT INTO source_platforms (source_id, platform, handle, track_mode, platform_metadata)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        sourceId,
        resolved.type,
        resolved.handle,
        'active',
        JSON.stringify(resolved.platform_metadata || {})
      );

      db.exec('COMMIT');

      res.json({
        success: true,
        data: {
          id: sourceId,
          platform: resolved.type,
          display_name: resolved.display_name,
          handle: resolved.handle
        }
      });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.close();
    }
  } catch (error) {
    console.error('添加信息源失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除信息源
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const db = new DatabaseSync(DB_PATH);

  try {
    const result = db.prepare('DELETE FROM sources WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '信息源不存在' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('删除信息源失败:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    db.close();
  }
});

export default router;
