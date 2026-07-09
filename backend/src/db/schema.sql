-- AI Insight Hub Database Schema
-- SQLite Database

-- 1. 内容表 (items)
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    title_en TEXT,
    url TEXT NOT NULL,
    summary TEXT,
    category TEXT,
    score INTEGER DEFAULT 0,
    pub_date TEXT,
    extracted_keywords TEXT,
    user_action TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_pub_date ON items(pub_date DESC);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_user_action ON items(user_action);
CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);

-- 2. 主题表 (topics)
CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    keywords TEXT,
    status TEXT DEFAULT 'active',
    total_items INTEGER DEFAULT 0,
    items_this_week INTEGER DEFAULT 0,
    items_this_month INTEGER DEFAULT 0,
    is_tracking INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_is_tracking ON topics(is_tracking);
CREATE INDEX IF NOT EXISTS idx_topics_created_at ON topics(created_at DESC);

-- 3. 主题-内容关联表 (topic_items)
CREATE TABLE IF NOT EXISTS topic_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    relevance REAL DEFAULT 0.0,
    is_confirmed INTEGER DEFAULT 0,
    added_method TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    UNIQUE(topic_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_items_topic_id ON topic_items(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_items_item_id ON topic_items(item_id);
CREATE INDEX IF NOT EXISTS idx_topic_items_relevance ON topic_items(relevance DESC);

-- 4. 用户偏好表 (user_preferences)
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    key TEXT NOT NULL,
    weight REAL DEFAULT 0.0,
    count INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(type, key)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_type ON user_preferences(type);
CREATE INDEX IF NOT EXISTS idx_user_preferences_weight ON user_preferences(weight DESC);

-- 5. 研究工作区表 (research_workspaces)
CREATE TABLE IF NOT EXISTS research_workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    ai_analysis TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_research_workspaces_topic_id ON research_workspaces(topic_id);
CREATE INDEX IF NOT EXISTS idx_research_workspaces_created_at ON research_workspaces(created_at DESC);

-- 6. 研究工作区内容表 (research_items)
CREATE TABLE IF NOT EXISTS research_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (workspace_id) REFERENCES research_workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    UNIQUE(workspace_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_research_items_workspace_id ON research_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_research_items_sort_order ON research_items(sort_order);

-- 7. 用户设置表 (user_settings)
CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 插入默认设置
INSERT OR IGNORE INTO user_settings (key, value) VALUES
    ('onboarding_completed', '0'),
    ('obsidian_vault_path', '/Users/USER/Documents/Obsidian/llm-wiki'),
    ('preferred_llm', 'chatgpt'),
    ('daily_content_limit', '20');
