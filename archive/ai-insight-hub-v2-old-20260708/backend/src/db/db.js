import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = join(__dirname, '../../data');
const itemsFile = join(dataDir, 'items.json');
const feedbacksFile = join(dataDir, 'feedbacks.json');
const exportsFile = join(dataDir, 'exports.json');

// 确保数据目录存在
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// 初始化数据文件
function initFile(filePath) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '[]', 'utf-8');
  }
}

initFile(itemsFile);
initFile(feedbacksFile);
initFile(exportsFile);

// 读取数据
function readData(filePath) {
  try {
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
}

// 写入数据
function writeData(filePath, data) {
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
  }
}

// 数据库操作
const db = {
  items: {
    getAll() {
      return readData(itemsFile);
    },

    findById(id) {
      const items = readData(itemsFile);
      return items.find(item => item.id === id);
    },

    findByDate(date) {
      const items = readData(itemsFile);
      return items.filter(item => {
        const itemDate = new Date(item.created_at).toISOString().split('T')[0];
        return itemDate === date;
      });
    },

    insertMany(items) {
      const existing = readData(itemsFile);
      const existingIds = new Set(existing.map(item => item.id));

      items.forEach(item => {
        if (!existingIds.has(item.id)) {
          item.created_at = new Date().toISOString();
          existing.push(item);
        }
      });

      writeData(itemsFile, existing);
    },

    updateRelevanceScore(id, score) {
      const items = readData(itemsFile);
      const item = items.find(i => i.id === id);
      if (item) {
        item.relevance_score = score;
        writeData(itemsFile, items);
      }
    },

    count() {
      return readData(itemsFile).length;
    }
  },

  feedbacks: {
    getAll() {
      return readData(feedbacksFile);
    },

    insert(itemId, action) {
      const feedbacks = readData(feedbacksFile);
      feedbacks.push({
        id: feedbacks.length + 1,
        item_id: itemId,
        action: action,
        created_at: new Date().toISOString()
      });
      writeData(feedbacksFile, feedbacks);
    },

    count() {
      return readData(feedbacksFile).length;
    },

    countByAction(action) {
      const feedbacks = readData(feedbacksFile);
      return feedbacks.filter(f => f.action === action).length;
    },

    getRecent(limit = 50) {
      const feedbacks = readData(feedbacksFile);
      const items = readData(itemsFile);

      return feedbacks
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit)
        .map(f => {
          const item = items.find(i => i.id === f.item_id);
          return {
            ...f,
            title: item?.title,
            category: item?.category
          };
        });
    }
  },

  exports: {
    insert(itemId, exportPath) {
      const exports = readData(exportsFile);
      exports.push({
        id: exports.length + 1,
        item_id: itemId,
        export_path: exportPath,
        created_at: new Date().toISOString()
      });
      writeData(exportsFile, exports);
    },

    getRecent(limit = 50) {
      const exports = readData(exportsFile);
      const items = readData(itemsFile);

      return exports
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit)
        .map(e => {
          const item = items.find(i => i.id === e.item_id);
          return {
            ...e,
            title: item?.title,
            url: item?.url
          };
        });
    }
  }
};

export default db;
