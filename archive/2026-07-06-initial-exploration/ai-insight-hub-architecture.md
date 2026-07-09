# AI Insight Hub - 技术架构设计文档

**版本：** v1.0  
**创建时间：** 2026-07-06  
**设计目标：** 最小 MVP，1天内完成，低成本验证

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────┐
│                   数据源层                           │
│  AI HOT API (精选)  +  Follow Builders Feed         │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│                   获取层 (fetch-feed.js)            │
│  - 调用 AI HOT API                                  │
│  - 调用 Follow Builders feed                        │
│  - 筛选、去重、排序                                  │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│                 处理层 (process-content.js)         │
│  - 调用 Claude API 生成中文摘要                     │
│  - 标记可翻译内容                                    │
│  - 生成 Markdown 日报                               │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│                   输出层                             │
│  Markdown 日报 (终端输出)                           │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│                 按需翻译 (translate-article.js)     │
│  用户输入：/translate N                              │
│  系统调用 Claude API 翻译全文                        │
└─────────────────────────────────────────────────────┘
```

---

## 二、目录结构

```
~/.claude/skills/ai-insight-hub/
├── SKILL.md                      # Claude Code 技能定义
│
├── scripts/
│   ├── fetch-feed.js             # 获取内容（主脚本）
│   ├── process-content.js        # AI 处理摘要
│   ├── translate-article.js      # 按需翻译
│   └── utils.js                  # 工具函数
│
├── prompts/
│   ├── summarize.md              # 摘要 prompt
│   └── translate.md              # 翻译 prompt
│
├── data/
│   ├── daily-2026-07-06.json     # 每日原始数据
│   ├── cache/                    # 翻译缓存
│   │   └── translations.json
│   └── config.json               # 配置文件
│
└── package.json                  # Node.js 依赖
```

---

## 三、核心配置

### config.json
```json
{
  "sources": {
    "aihot": {
      "enabled": true,
      "endpoint": "https://aihot.virxact.com/api/public/items",
      "params": {
        "mode": "selected",
        "take": 20
      },
      "filters": {
        "keep_categories": ["ai-products", "industry", "ai-models", "tip"],
        "skip_categories": ["paper"]
      }
    },
    "followBuilders": {
      "enabled": true,
      "feedUrls": {
        "blogs": "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json",
        "podcasts": "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json",
        "x": "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json"
      },
      "filters": {
        "x_keywords": ["agent", "model", "product", "Claude", "OpenAI", "Anthropic", "Replit", "Vercel", "workflow", "pricing", "benchmark", "enterprise"],
        "x_priority_accounts": ["alexalbert__", "amasad", "rauchg", "levie", "sama"]
      }
    }
  },
  "output": {
    "max_items": 12,
    "priority_split": {
      "must_read": 5,
      "optional": 5,
      "supplement": 2
    }
  },
  "claude": {
    "model": "claude-opus-4",
    "max_tokens": 2000
  }
}
```

---

## 四、数据流程

### 4.1 获取内容 (fetch-feed.js)

**核心逻辑：**
```javascript
1. 调用 AI HOT API → 获取 20 条精选内容
2. 筛选：保留 products/industry/models/tip，跳过 paper
3. 调用 Follow Builders feeds → 获取 blogs/podcasts/x
4. 筛选 X 内容：关键词匹配 OR 优先账号
5. 合并所有内容
6. 按 URL 去重
7. 排序：官方博客 > AI HOT 高分 > 播客 > X
8. 限制 12 条
9. 保存 JSON 文件
```

### 4.2 处理内容 (process-content.js)

**核心逻辑：**
```javascript
1. 读取 fetch-feed.js 生成的 JSON
2. 对每条英文内容：
   - 调用 Claude API 生成中文摘要（150字）
   - 生成"为什么值得看"
   - 生成"对 AI 产品的启发"
3. 分组：必看5条 + 可略读5条 + 补充2条
4. 生成 Markdown 日报
5. 输出到终端
```

### 4.3 按需翻译 (translate-article.js)

**核心逻辑：**
```javascript
1. 接收文章编号（例如：1）
2. 读取处理后的 JSON
3. 查找对应文章
4. 检查翻译缓存
5. 如无缓存，调用 Claude API 翻译全文
6. 格式化输出 Markdown
7. 保存到缓存
```

---

## 五、Prompt 设计

### summarize.md
```markdown
你是 AI 产品经理的信息助手。将以下英文内容转化为中文摘要和产品启发。

输出 JSON 格式：
{
  "summary_zh": "150字中文摘要",
  "why_matters": "为什么值得看（1-2句）",
  "product_insight": "对 AI 产品的启发（1-2句）"
}

内容：
{content}
```

### translate.md
```markdown
将以下英文文章完整翻译成中文。

要求：
- 准确传达原意
- 技术术语保留英文（API、token等）
- 保持格式和段落结构

内容：
{content}
```

---

## 六、SKILL.md 定义

```markdown
---
name: ai-insight-hub
description: AI 产品人每日信息管道。获取 AI HOT + Follow Builders 精选内容，生成中文摘要，支持按需翻译。
---

## 触发词
- "今天的 AI 资讯"
- "/ai-insight"

## 执行
```bash
cd ${CLAUDE_SKILL_DIR}/scripts
node fetch-feed.js
node process-content.js
```

## 按需翻译
用户说 "/translate 1" 时：
```bash
cd ${CLAUDE_SKILL_DIR}/scripts
node translate-article.js 1
```
```

---

## 七、输出格式示例

### Markdown 日报
```markdown
# AI Insight Daily - 2026年7月6日

*今日精选 12 条*

---

## 🌟 今日必看 (5条)

### 1. OpenAI releases GPT-5.6
**来源**：OpenAI Blog  
**时间**：2小时前  
**分类**：🚀 产品发布

**中文摘要**：
GPT-5.6 在数学推理上取得重大突破，成功解决 IMO 级别问题...

**为什么值得看**：
数学推理能力的突破可能改变 AI 在教育、科研领域的应用...

**对 AI 产品的启发**：
可以考虑在产品中加入更复杂的推理场景...

**原文链接**：https://openai.com/blog/gpt-56

**📝 需要详细了解？**  
回复 `/translate 1` 获取完整中文翻译

---

### 2. [下一条内容]
...

## 📌 可略读 (5条)
...

## 🎧 Follow Builders 补充 (2条)
...

## 💬 使用说明
- 📖 查看原文：点击链接
- 🌐 翻译全文：回复 `/translate [编号]`
- 💾 保存笔记：复制到 Obsidian
```

---

## 八、实施步骤

### 给 Sonnet 4.5 的实施清单：

**Step 1: 创建目录结构**
```bash
mkdir -p ~/.claude/skills/ai-insight-hub/{scripts,prompts,data/cache}
cd ~/.claude/skills/ai-insight-hub
```

**Step 2: 创建配置文件**
- config.json（见上文）
- package.json
- .env（ANTHROPIC_API_KEY）

**Step 3: 编写核心脚本**
- fetch-feed.js（获取+筛选+去重+排序）
- process-content.js（AI摘要+Markdown生成）
- translate-article.js（按需翻译）
- utils.js（工具函数）

**Step 4: 编写 Prompt 文件**
- prompts/summarize.md
- prompts/translate.md

**Step 5: 编写 SKILL.md**

**Step 6: 测试**
```bash
# 测试获取
node scripts/fetch-feed.js

# 测试处理
node scripts/process-content.js

# 测试翻译
node scripts/translate-article.js 1
```

**Step 7: Claude Code 集成测试**
- 运行 /ai-insight
- 运行 /translate 1

---

## 九、成本与性能

**每日成本：** $0.10  
**处理时间：** 2-3 分钟  
**输出数量：** 10-12 条  

**第一周验证目标：**
- ✅ 连续 7 天稳定运行
- ✅ 每天至少 5 条有价值内容
- ✅ 信噪比 > 40%

---

## 十、交接说明

**Sonnet 4.5 需要完成：**
1. 根据此架构文档实现所有脚本
2. 测试端到端流程
3. 编写简单的 README
4. 提供测试结果

**需要的环境变量：**
- `ANTHROPIC_API_KEY`: Claude API 密钥

**预计完成时间：** 4-6 小时

---

**文档状态：** ✅ 架构设计完成，可交给 Sonnet 4.5 实施  
**下一步：** 切换到 Sonnet 4.5，运行命令开始实施

