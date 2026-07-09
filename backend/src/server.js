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

// 文章相关 API
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

// ========== v0.2.0 工作区对话 API ==========

// 工作区管理
app.post('/api/workspaces', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'name is required'
      });
    }

    const { createWorkspace } = await import('./db/workspaces.js');
    const workspace = createWorkspace(name, description);

    res.json({
      success: true,
      data: workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/workspaces', async (req, res) => {
  try {
    const { getWorkspaces } = await import('./db/workspaces.js');
    const workspaces = getWorkspaces();

    res.json({
      success: true,
      data: workspaces
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/workspaces/:id', async (req, res) => {
  try {
    const { getWorkspaceById } = await import('./db/workspaces.js');
    const workspace = getWorkspaceById(req.params.id);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        error: 'Workspace not found'
      });
    }

    res.json({
      success: true,
      data: workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.put('/api/workspaces/:id', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'name is required'
      });
    }

    const { updateWorkspace } = await import('./db/workspaces.js');
    const updated = updateWorkspace(req.params.id, name, description);

    res.json({
      success: updated,
      message: updated ? 'Workspace updated' : 'Workspace not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.delete('/api/workspaces/:id', async (req, res) => {
  try {
    const { deleteWorkspace } = await import('./db/workspaces.js');
    const deleted = deleteWorkspace(req.params.id);

    res.json({
      success: deleted,
      message: deleted ? 'Workspace deleted' : 'Workspace not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 对话管理
app.post('/api/conversations', async (req, res) => {
  try {
    const { workspaceId, title, llmProvider } = req.body;

    if (!workspaceId || !title) {
      return res.status(400).json({
        success: false,
        error: 'workspaceId and title are required'
      });
    }

    const { createConversation } = await import('./db/workspaces.js');
    const conversation = createConversation(workspaceId, title, llmProvider);

    res.json({
      success: true,
      data: conversation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const { getConversationById } = await import('./db/workspaces.js');
    const conversation = getConversationById(req.params.id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      data: conversation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const { deleteConversation } = await import('./db/workspaces.js');
    const deleted = deleteConversation(req.params.id);

    res.json({
      success: deleted,
      message: deleted ? 'Conversation deleted' : 'Conversation not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 消息管理
app.post('/api/conversations/:id/messages', async (req, res) => {
  try {
    const { role, content } = req.body;
    const conversationId = req.params.id;

    if (!role || !content) {
      return res.status(400).json({
        success: false,
        error: 'role and content are required'
      });
    }

    const { addMessage } = await import('./db/workspaces.js');
    const message = addMessage(conversationId, role, content, 0, 0);

    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const { getMessagesByConversation } = await import('./db/workspaces.js');
    const messages = getMessagesByConversation(req.params.id);

    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 添加材料到对话
app.post('/api/conversations/:id/materials', async (req, res) => {
  try {
    const { itemId } = req.body;
    const conversationId = req.params.id;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: 'itemId is required'
      });
    }

    const { addMaterialToConversation } = await import('./db/workspaces.js');
    const added = addMaterialToConversation(conversationId, itemId);

    res.json({
      success: added,
      message: added ? 'Material added' : 'Material already exists'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// LLM 流式聊天（SSE）
app.post('/api/llm/chat', async (req, res) => {
  try {
    const { conversationId, message, provider = 'deepseek' } = req.body;

    if (!conversationId || !message) {
      return res.status(400).json({
        success: false,
        error: 'conversationId and message are required'
      });
    }

    // 获取对话历史
    const { getMessagesByConversation, addMessage } = await import('./db/workspaces.js');
    const history = getMessagesByConversation(conversationId);

    // 保存用户消息
    const userMessage = addMessage(conversationId, 'user', message);

    // 构建消息上下文
    const messages = [
      ...history.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: message }
    ];

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { streamChat } = await import('./services/llm.js');

    let fullResponse = '';
    let totalTokens = 0;
    let totalCost = 0;

    for await (const chunk of streamChat(messages, provider)) {
      if (chunk.type === 'content') {
        fullResponse += chunk.content;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
      } else if (chunk.type === 'done') {
        totalTokens = chunk.tokens;
        totalCost = chunk.cost;

        // 保存助手消息
        addMessage(conversationId, 'assistant', fullResponse, totalTokens, totalCost);

        res.write(`data: ${JSON.stringify({
          type: 'done',
          tokens: totalTokens,
          cost: totalCost
        })}\n\n`);
      } else if (chunk.type === 'error') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
      }
    }

    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// 成本统计
app.get('/api/stats/cost', async (req, res) => {
  try {
    const { getCostStats } = await import('./services/stats.js');
    const stats = getCostStats();

    res.json({
      success: true,
      data: stats
    });
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
  console.log(`✨ v0.2.0 - Workspace Chat APIs enabled`);
});
