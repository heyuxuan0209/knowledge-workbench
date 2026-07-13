-- Knowledge Workbench v3 Schema
-- 取代 schema-v2.sql 的 workspace 模型，核心实体改为 Content / Source / Topic / Story
-- 依据: docs/SYNTHESIZED-ARCHITECTURE.md §3.5 §4 §5.2, docs/WIREFRAMES.md, docs/TECH-SURVEY-PHASE1.md
--
-- 旧表处理策略：
-- - items / workspaces / conversations / conversation_materials: 保留不动，只是不再写入。
-- - topics / topic_items / research_workspaces / research_items / user_preferences: 这是
--   v0.1 遗留的死表（HANDOFF-TO-NEW-ARCHITECTURE.md §3 已确认代码零引用、零数据），其中
--   topics 与本文件的新 Topic 实体重名但结构完全不同（INTEGER PK vs TEXT PK），必须先删除
--   旧空表才能建新表，故在此显式 DROP（迁移脚本 migrate-v3.js 执行前已核实这些表为空）。
--
-- 迁移脚本见 migrate-v3.js（先 DROP 旧死表，再建新表，最后把 items 历史数据搬进 contents）。

DROP TABLE IF EXISTS topic_items;
DROP TABLE IF EXISTS research_items;
DROP TABLE IF EXISTS research_workspaces;
DROP TABLE IF EXISTS topics;
DROP TABLE IF EXISTS user_preferences;

-- ============================================================
-- 1. Sources — 轻量身份标记层（不是抓取系统，ADR-006）
-- ============================================================

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL
        CHECK (source_type IN ('Person', 'YouTubeChannel', 'GitHubUser', 'Newsletter', 'Blog', 'Media')),
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT,

    -- 可信度标签（用于 Feed 排序信号和卡片标记，不是过滤条件，见 WIREFRAMES.md 第1节）
    authority_level TEXT DEFAULT 'unrated'
        CHECK (authority_level IN ('high', 'medium', 'low', 'unrated')),

    followed_since TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'archived')),
    tags TEXT DEFAULT '[]',                 -- JSON array

    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);
CREATE INDEX IF NOT EXISTS idx_sources_authority ON sources(authority_level);
CREATE INDEX IF NOT EXISTS idx_sources_followed_since ON sources(followed_since DESC);

-- ============================================================
-- 2. Source Platforms — 一个 Source 多个平台账号
--    track_mode 由平台类型决定，不是用户随意配置（ADR-007 成本分层硬约束）
-- ============================================================

CREATE TABLE IF NOT EXISTS source_platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    platform TEXT NOT NULL
        CHECK (platform IN ('X', 'YouTube', 'WeChat', 'GitHub', 'Blog', 'Newsletter', 'Reddit', 'RSS', 'HackerNews')),
    handle TEXT,                            -- @username / channelId / 公众号名称 / feed URL
    track_mode TEXT NOT NULL
        CHECK (track_mode IN ('passive', 'active', 'link-only')),
    platform_metadata TEXT DEFAULT '{}',    -- JSON: 平台特定信息（如 follower 数）

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    UNIQUE(source_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_source_platforms_source_id ON source_platforms(source_id);
CREATE INDEX IF NOT EXISTS idx_source_platforms_track_mode ON source_platforms(track_mode);

-- ============================================================
-- 3. Topics — 研究主题（Mode 2 主战场）
--    列表排序按"最近活跃"，不按演进阶段分组（WIREFRAMES.md 第2节）
-- ============================================================

CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,

    status TEXT DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'archived')),
    -- draft: 搜索模糊主题命中的临时视图，未经用户"转为常驻"确认前的状态（WIREFRAMES.md 第3节）
    -- active: 常驻追踪中
    -- archived: 用户手动归档

    -- 演进阶段：只作卡片标签展示，不作为列表分组维度（回答用户"为什么不按阶段分组"的问题）
    evolution_phase TEXT DEFAULT 'emerging'
        CHECK (evolution_phase IN ('emerging', 'active', 'mature', 'archived')),

    -- 主题的中心向量，用于新内容归类时计算相似度（轻量聚类，见 §6 stories 表说明）
    centroid_embedding TEXT,                -- JSON array of floats

    created_by TEXT DEFAULT 'user'
        CHECK (created_by IN ('user', 'ai_suggested')),

    last_active_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_last_active ON topics(last_active_at DESC);

-- ============================================================
-- 4. Contents — 统一内容模型（核心实体）
-- ============================================================

CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY,
    source_id TEXT,                         -- 可为空 = 一次性链接/纯文本粘贴，无法识别作者

    content_type TEXT NOT NULL
        CHECK (content_type IN ('article', 'video', 'tweet', 'paper', 'repo', 'text')),
    url TEXT,                               -- 纯文本粘贴时可为空
    published_at TEXT,

    -- 原始内容（按类型存在其一）
    raw_full_text TEXT,                     -- article / paper / text
    raw_transcript TEXT,                    -- video，JSON: [{offset, duration, text}]
    raw_readme TEXT,                        -- repo

    -- 多语言（一等公民，架构文档 §8）
    original_lang TEXT NOT NULL DEFAULT 'unknown',
    has_translation INTEGER DEFAULT 0,

    zh_title TEXT,
    zh_summary TEXT,
    zh_chapters TEXT DEFAULT '[]',          -- JSON: [{title, startTime, endTime, content}]
    zh_body TEXT,                           -- 全文翻译（可选，成本分级）

    en_title TEXT,
    en_summary TEXT,
    en_body TEXT,                           -- 原文始终保留，供精读对照

    -- AI 分析结果
    ai_topics TEXT DEFAULT '[]',            -- JSON: [topicId, ...]（归入哪些 Topic）
    ai_perspectives TEXT DEFAULT '[]',      -- JSON: [{sourceRef, stance, points: []}]
    embedding TEXT,                         -- JSON array，用于 Topic/Story 相似度匹配

    -- 摄入方式与状态（本轮调研新增字段）
    input_method TEXT NOT NULL DEFAULT 'feed'
        CHECK (input_method IN ('feed', 'url_auto', 'url_manual', 'text_paste', 'file_upload')),
    source_app TEXT DEFAULT 'unknown'
        CHECK (source_app IN ('aihot', 'hackernews', 'reddit', 'github_trending', 'rss', 'feishu', 'obsidian', 'manual', 'unknown')),
    fetch_status TEXT DEFAULT 'success'
        CHECK (fetch_status IN ('pending', 'success', 'failed', 'manual')),
    fetch_error TEXT,

    -- 外部平台的原生分数（如 AI HOT 的 score、HN 的 points），不同来源量纲不同，仅供参考
    external_score REAL,

    -- 用户交互
    user_read_status TEXT DEFAULT 'unread'
        CHECK (user_read_status IN ('unread', 'read', 'archived')),
    user_annotations TEXT DEFAULT '[]',     -- JSON: [{type, content, position}]
    user_saved_to_topics TEXT DEFAULT '[]', -- JSON: [topicId, ...]（用户主动"加入研究 Topic"）

    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_contents_source_id ON contents(source_id);
CREATE INDEX IF NOT EXISTS idx_contents_content_type ON contents(content_type);
CREATE INDEX IF NOT EXISTS idx_contents_published_at ON contents(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_contents_read_status ON contents(user_read_status);
CREATE INDEX IF NOT EXISTS idx_contents_created_at ON contents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contents_source_app ON contents(source_app);
CREATE INDEX IF NOT EXISTS idx_contents_input_method ON contents(input_method);

-- ============================================================
-- 5. Content-Topic 关联（多对多）
-- ============================================================

CREATE TABLE IF NOT EXISTS content_topics (
    content_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    relevance_score REAL DEFAULT 1.0,       -- Embedding 相似度或 AI 判断的相关度（0-1）
    added_by TEXT DEFAULT 'ai'
        CHECK (added_by IN ('ai', 'user')),
    added_at TEXT DEFAULT (datetime('now')),

    PRIMARY KEY (content_id, topic_id),
    FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_topics_topic_id ON content_topics(topic_id);

-- ============================================================
-- 6. Stories — 事件聚类（轻量版，驱动"近期焦点"模块）
--    范围声明：只做粗粒度分组供排序展示用，不追求精确的事件级去重。
--    决策依据：本轮讨论已确认 AI HOT 不提供聚类信息，需自建；且决定 Phase 1 做轻量版。
-- ============================================================

CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    topic_id TEXT,                          -- 可为空：全局焦点不一定归属某个常驻 Topic
    headline TEXT NOT NULL,                 -- AI 生成的事件标题，如"GPT-5.6 删除创业者硬盘事件"

    centroid_embedding TEXT,                -- JSON array，用于新内容判断是否归入此 Story

    heat_score REAL DEFAULT 0,              -- 综合热度：源数量 + 时间新鲜度衰减
    source_count INTEGER DEFAULT 1,         -- 关联的独立 content 数量

    first_seen_at TEXT DEFAULT (datetime('now')),
    last_updated_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_stories_topic_id ON stories(topic_id);
CREATE INDEX IF NOT EXISTS idx_stories_heat_score ON stories(heat_score DESC);
CREATE INDEX IF NOT EXISTS idx_stories_last_updated ON stories(last_updated_at DESC);

CREATE TABLE IF NOT EXISTS story_contents (
    story_id TEXT NOT NULL,
    content_id TEXT NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),

    PRIMARY KEY (story_id, content_id),
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_story_contents_content_id ON story_contents(content_id);

-- ============================================================
-- 7. Ephemeral Sessions — Mode 1 即兴分析会话
--    无状态设计：默认不持久化，仅用户点"保存"时落库（对话内容可能很大，不建议默认全存）
-- ============================================================

CREATE TABLE IF NOT EXISTS ephemeral_sessions (
    id TEXT PRIMARY KEY,
    content_ids TEXT NOT NULL DEFAULT '[]', -- JSON: [contentId, ...]，选中 Feed 内容时填充
    ad_hoc_input TEXT,                      -- 用户直接粘贴的链接/文本（未必对应已存在的 content 记录）

    messages TEXT NOT NULL DEFAULT '[]',    -- JSON: [{role, content, timestamp}]
    total_tokens INTEGER DEFAULT 0,
    total_cost_yuan REAL DEFAULT 0.0,

    saved_to_topic_id TEXT,                 -- 用户点"保存"时记录目标 Topic

    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,                        -- 建议 7 天后清理未保存的会话

    FOREIGN KEY (saved_to_topic_id) REFERENCES topics(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ephemeral_expires ON ephemeral_sessions(expires_at);

-- ============================================================
-- 8. Data Source Configs — 用户手动添加的信源配置
--    对应 WIREFRAMES.md 第5/6/7节的三种添加方式（单账号 / 信源池 / 批量导入）
-- ============================================================

CREATE TABLE IF NOT EXISTS source_pools (
    id TEXT PRIMARY KEY,
    pool_type TEXT NOT NULL
        CHECK (pool_type IN ('reddit_subreddit', 'github_trending_lang', 'rss_feed', 'hackernews')),
    identifier TEXT NOT NULL,               -- 如 "MachineLearning" / "javascript" / RSS URL
    display_name TEXT,

    filter_config TEXT DEFAULT '{}',        -- JSON: { minUpvotes: 100 } 等过滤规则
    sync_frequency TEXT DEFAULT 'hourly'
        CHECK (sync_frequency IN ('hourly', 'every_6h', 'daily')),

    status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'paused')),
    last_synced_at TEXT,

    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pool_type, identifier)
);

CREATE INDEX IF NOT EXISTS idx_source_pools_status ON source_pools(status);
