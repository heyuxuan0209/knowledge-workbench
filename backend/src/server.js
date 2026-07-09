import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/items', async (req, res) => {
  try {
    const { getItems } = await import('./db/db.js');
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const items = getItems(limit, offset);
    
    res.json({
      success: true,
      data: items,
      count: items.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/items/:id', async (req, res) => {
  try {
    const { getItemById } = await import('./db/db.js');
    const item = getItemById(req.params.id);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }
    
    res.json({
      success: true,
      data: item
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const { itemId, action } = req.body;
    
    if (!itemId || !action) {
      return res.status(400).json({
        success: false,
        error: 'itemId and action are required'
      });
    }
    
    const { updateUserAction } = await import('./db/db.js');
    const updated = updateUserAction(itemId, action);
    
    res.json({
      success: updated,
      message: updated ? 'Feedback recorded' : 'Item not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    const { syncAIHotData } = await import('./services/sync-aihot.js');
    const result = await syncAIHotData();
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 AI Insight Hub backend running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
