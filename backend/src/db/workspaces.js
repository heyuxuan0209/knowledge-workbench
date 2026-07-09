import { getDatabase } from './init.js';
import { randomBytes } from 'crypto';

// 生成唯一 ID
function generateId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

// 创建工作区
export function createWorkspace(name, description = '') {
  const db = getDatabase();
  const id = generateId('ws');

  const stmt = db.prepare(`
    INSERT INTO workspaces (id, name, description)
    VALUES (?, ?, ?)
  `);

  stmt.run(id, name, description);

  const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
  db.close();

  return workspace;
}

// 获取所有工作区
export function getWorkspaces() {
  const db = getDatabase();
  const workspaces = db.prepare(`
    SELECT w.*,
           COUNT(DISTINCT c.id) as conversation_count
    FROM workspaces w
    LEFT JOIN conversations c ON w.id = c.workspace_id
    GROUP BY w.id
    ORDER BY w.created_at DESC
  `).all();

  db.close();
  return workspaces;
}

// 获取单个工作区
export function getWorkspaceById(id) {
  const db = getDatabase();
  const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);

  if (workspace) {
    const conversations = db.prepare(`
      SELECT c.*,
             COUNT(DISTINCT m.id) as message_count,
             SUM(m.tokens_used) as total_tokens,
             SUM(m.cost_yuan) as total_cost
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      WHERE c.workspace_id = ?
      GROUP BY c.id
      ORDER BY c.updated_at DESC
    `).all(id);

    workspace.conversations = conversations;
  }

  db.close();
  return workspace;
}

// 更新工作区
export function updateWorkspace(id, name, description) {
  const db = getDatabase();

  const stmt = db.prepare(`
    UPDATE workspaces
    SET name = ?, description = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const result = stmt.run(name, description, id);
  db.close();

  return result.changes > 0;
}

// 删除工作区
export function deleteWorkspace(id) {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM workspaces WHERE id = ?');
  const result = stmt.run(id);
  db.close();

  return result.changes > 0;
}

// 创建对话
export function createConversation(workspaceId, title, llmProvider = 'deepseek') {
  const db = getDatabase();
  const id = generateId('conv');

  const stmt = db.prepare(`
    INSERT INTO conversations (id, workspace_id, title, llm_provider)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(id, workspaceId, title, llmProvider);

  // 更新工作区的 updated_at
  db.prepare(`
    UPDATE workspaces SET updated_at = datetime('now') WHERE id = ?
  `).run(workspaceId);

  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  db.close();

  return conversation;
}

// 获取对话详情
export function getConversationById(id) {
  const db = getDatabase();
  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

  if (conversation) {
    // 获取消息
    conversation.messages = db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(id);

    // 获取材料
    conversation.materials = db.prepare(`
      SELECT cm.*, i.title, i.url, i.summary
      FROM conversation_materials cm
      JOIN items i ON cm.item_id = i.id
      WHERE cm.conversation_id = ?
      ORDER BY cm.added_at DESC
    `).all(id);

    // 统计
    const stats = db.prepare(`
      SELECT
        COUNT(*) as message_count,
        SUM(tokens_used) as total_tokens,
        SUM(cost_yuan) as total_cost
      FROM messages
      WHERE conversation_id = ?
    `).get(id);

    conversation.stats = stats;
  }

  db.close();
  return conversation;
}

// 添加消息
export function addMessage(conversationId, role, content, tokensUsed = 0, costYuan = 0) {
  const db = getDatabase();
  const id = generateId('msg');

  const stmt = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, tokens_used, cost_yuan)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, conversationId, role, content, tokensUsed, costYuan);

  // 更新对话的 updated_at
  db.prepare(`
    UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
  `).run(conversationId);

  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  db.close();

  return message;
}

// 添加材料到对话
export function addMaterialToConversation(conversationId, itemId) {
  const db = getDatabase();

  try {
    const stmt = db.prepare(`
      INSERT INTO conversation_materials (conversation_id, item_id)
      VALUES (?, ?)
    `);

    stmt.run(conversationId, itemId);
    db.close();
    return true;
  } catch (error) {
    db.close();
    if (error.message.includes('UNIQUE constraint')) {
      return false; // 已存在
    }
    throw error;
  }
}

// 获取对话的消息列表
export function getMessagesByConversation(conversationId) {
  const db = getDatabase();
  const messages = db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(conversationId);

  db.close();
  return messages;
}

// 删除对话
export function deleteConversation(id) {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM conversations WHERE id = ?');
  const result = stmt.run(id);
  db.close();

  return result.changes > 0;
}
