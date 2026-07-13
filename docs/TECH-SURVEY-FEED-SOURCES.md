# Feed 信息源技术选型调研

**日期**: 2026-07-11  
**目标**: 扩展 Feed 流信息源，解决 AI HOT 单一数据源的覆盖面和实时性问题  
**原则**: 复用优先 · 开源优先 · 免费优先

---

## 参考项目分析：TrendRadar

**GitHub**: https://github.com/sansan0/TrendRadar  
**功能**: AI 趋势雷达，聚合多源 AI 资讯  
**技术栈**（推测）: 
- 可能使用 RSS 聚合 + 爬虫
- 类似 AI HOT 的资讯聚合产品
- 可参考其数据源选择策略

**借鉴价值**: 
- 多源聚合的实现思路
- 数据去重和质量评估逻辑
- Feed 流的前端展示方式

---

## 1. 类 AI HOT 的聚合源（其他垂类）

### 方案 1.1: Hacker News (官方 API)

**名称**: Hacker News API  
**访问**: https://github.com/HackerNews/API  
**协议**: 免费，无需认证  
**维护**: Y Combinator 官方维护，极稳定

**接入方式**:
```javascript
// 获取热门帖子 ID 列表
const topStories = await fetch('https://hacker-news.firebaseapp.com/v0/topstories.json');
const ids = await topStories.json();

// 获取单个帖子详情
const item = await fetch(`https://hacker-news.firebaseapp.com/v0/item/${ids[0]}.json`);
```

**覆盖领域**: 技术、产品、创业  
**更新频率**: 实时  
**已知局限**:
- 帖子以讨论为主，原文链接需要二次抓取
- 需要自己过滤低质量内容（靠评论数/点数判断）
- 无中文翻译

**Star/活跃度**: 官方 API，10k+ star，长期维护

---

### 方案 1.2: Product Hunt (官方 API)

**名称**: Product Hunt GraphQL API  
**访问**: https://api.producthunt.com/v2/docs  
**协议**: 免费（需注册 OAuth App），有 Rate Limit  
**维护**: Product Hunt 官方

**接入方式**:
```javascript
// 需要 OAuth 2.0 认证
const response = await fetch('https://api.producthunt.com/v2/api/graphql', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: `{ posts { edges { node { name tagline url votesCount } } } }`
  })
});
```

**覆盖领域**: 产品发现、设计、SaaS  
**更新频率**: 每日新产品  
**已知局限**:
- OAuth 流程相对复杂
- Rate Limit: 100 请求/小时（免费）
- 无中文内容

**Star/活跃度**: 官方 API，持续维护

---

### 方案 1.3: Dev.to (官方 API)

**名称**: Dev.to Forem API  
**访问**: https://developers.forem.com/api  
**协议**: 免费，无需认证（公开接口），有 API Key（提高 Rate Limit）  
**维护**: Forem 开源社区

**接入方式**:
```javascript
// 获取热门文章
const articles = await fetch('https://dev.to/api/articles?top=7');  // 近 7 天热门
const data = await articles.json();
```

**覆盖领域**: 开发者博客（前端、后端、DevOps、职业发展）  
**更新频率**: 实时  
**已知局限**:
- 内容质量参差不齐（任何人都能发）
- 需要过滤（按点赞数/评论数）
- 无中文内容

**Star/活跃度**: Forem 开源项目 20k+ star

---

### 方案 1.4: lobste.rs (非官方 API)

**名称**: Lobsters  
**访问**: https://lobste.rs  
**协议**: 免费，RSS 可用  
**维护**: 社区驱动

**接入方式**:
```javascript
// 使用 RSS feed
const feed = await fetch('https://lobste.rs/rss');
// 解析 RSS (使用 rss-parser)
```

**覆盖领域**: 高质量技术讨论（类似 HN 但更聚焦编程）  
**更新频率**: 实时  
**已知局限**:
- 社区小众，内容量少于 HN
- 需要邀请才能注册（但 RSS 公开）
- 无官方 API，只能用 RSS

---

## 2. RSS/Atom 订阅聚合方案

### 方案 2.1: RSSHub (推荐)

**名称**: RSSHub  
**GitHub**: https://github.com/DIYgod/RSSHub  
**协议**: MIT  
**Star**: 30k+  
**维护**: 活跃（2026 年持续更新）

**功能**:
- 万物皆可 RSS：微博、B站、知乎、YouTube、GitHub、Twitter 等 300+ 平台
- 已实现各平台的反反爬和全文抓取
- 可自建 Docker 部署

**接入方式**:
```bash
# Docker 部署
docker run -d --name rsshub -p 1200:1200 diygod/rsshub

# 使用
# 例如：获取某个 GitHub 用户的动态
# http://localhost:1200/github/user/activity/torvalds
```

**已知局限**:
- 部分路由依赖第三方 API（可能失效）
- 反反爬策略需要定期更新
- 自建需要稳定服务器

**推荐理由**: **这是核心方案**，能覆盖 90% 的平台，包括微信公众号（通过搜狗搜索）、知乎、B站等国内平台

---

### 方案 2.2: rss-parser (npm)

**名称**: rss-parser  
**npm**: https://www.npmjs.com/package/rss-parser  
**协议**: MIT  
**下载量**: 每周 1M+  
**维护**: 活跃

**功能**:
- 解析 RSS/Atom feed
- 支持自定义字段
- 轻量级（纯 JS）

**接入方式**:
```javascript
const Parser = require('rss-parser');
const parser = new Parser();

const feed = await parser.parseURL('https://example.com/rss');
feed.items.forEach(item => {
  console.log(item.title, item.link, item.pubDate);
});
```

**已知局限**:
- 只负责解析，不负责抓取全文
- 需要配合其他工具（如 @mozilla/readability）提取全文

**推荐理由**: 与 RSSHub 配合使用，RSSHub 生成 RSS，rss-parser 解析

---

### 方案 2.3: FreshRSS (自建 RSS 阅读器)

**名称**: FreshRSS  
**GitHub**: https://github.com/FreshRSS/FreshRSS  
**协议**: AGPL-3.0  
**Star**: 8k+  
**维护**: 活跃

**功能**:
- 完整的 RSS 阅读器（类 Feedly）
- 支持全文抓取、去重、过滤
- 提供 API（Fever API / Google Reader API）

**接入方式**:
```bash
# Docker 部署
docker run -d -p 8080:80 -v freshrss-data:/var/www/FreshRSS/data \
  freshrss/freshrss
```

**已知局限**:
- 是完整应用，不是库（需要独立部署）
- 如果只需要 RSS 聚合逻辑，这是过度设计
- 更适合作为"用户前端"而非"数据源"

**推荐理由**: 如果你想快速上线一个 RSS 阅读器功能，直接用这个；但如果只是抓取数据，RSSHub + rss-parser 更轻量

---

## 3. 平台特定的内容流 API

### 3.1 GitHub Trending

**官方 API**: ❌ 不存在  
**非官方方案**: 
- **gtrend.yapie.me** (免费 REST API)
  - 接口：`https://gtrend.yapie.me/repositories?since=daily&language=javascript`
  - 无需认证
  - 不保证长期稳定
  
- **自建爬虫**（推荐）:
  ```javascript
  // 爬取 https://github.com/trending
  // 使用 cheerio 解析 HTML
  const response = await fetch('https://github.com/trending');
  const $ = cheerio.load(await response.text());
  $('article.Box-row').each((i, el) => {
    const repo = $(el).find('h2 a').attr('href');
    // ...
  });
  ```

**已知局限**:
- 非官方 API 可能随时失效
- 爬虫需要应对 GitHub 的反爬（User-Agent、Rate Limit）

---

### 3.2 Reddit

**官方 API**: ✅ 免费  
**访问**: https://www.reddit.com/dev/api  
**认证**: OAuth 2.0（或无认证的 JSON 接口）

**接入方式（简单版，无认证）**:
```javascript
// 获取 subreddit 热门帖子
const response = await fetch('https://www.reddit.com/r/MachineLearning/hot.json?limit=25');
const data = await response.json();
```

**已知局限**:
- Rate Limit: 60 请求/分钟（无认证），600/分钟（OAuth）
- 需要处理 Reddit 的帖子格式（self post vs link post）
- 2023 年后 API 政策收紧，但基础访问仍免费

---

### 3.3 Medium

**官方 API**: ⚠️ 已废弃  
**替代方案**:
- **RSS feed**（推荐）:
  - 用户 feed: `https://medium.com/feed/@username`
  - 标签 feed: `https://medium.com/feed/tag/ai`
  
- **RSSHub 路由**: 已支持 Medium

**付费墙绕过**: ❌ 不可行  
- Medium 付费墙无法通过技术手段合法绕过
- 只能获取摘要，全文需要付费

---

## 4. Twitter/X 内容流（重点）

### 4.1 官方 Twitter API v2

**访问**: https://developer.twitter.com/en/docs/twitter-api  
**定价**（2026 年现状）:
- **Free**: ❌ 已取消（2023 年后）
- **Basic**: $100/月
  - 10,000 推文读取/月
  - 50 个关注的账号
  
- **Pro**: $5,000/月（面向企业）

**结论**: ❌ 成本过高，不适合个人项目

---

### 4.2 Nitter（第三方前端）

**GitHub**: https://github.com/zedeus/nitter  
**协议**: AGPL-3.0  
**Star**: 9k+  
**状态**: ⚠️ 2023 年后逐渐失效

**现状**:
- Twitter 加强了反爬，大部分公共 Nitter 实例已失效
- 自建实例需要频繁更换 IP
- 不再推荐作为稳定方案

---

### 4.3 推荐方案：RSSHub Twitter 路由

**方案**: 使用 RSSHub 的 Twitter 路由  
**路由**: `/twitter/user/:id`  
**实现**: RSSHub 内置了 Twitter 爬虫逻辑

**接入方式**:
```javascript
// 部署 RSSHub 后
const feed = await parser.parseURL('http://localhost:1200/twitter/user/sama');
```

**已知局限**:
- 依赖 RSSHub 维护者更新反反爬策略
- 可能随时失效（Twitter 持续加强反爬）
- 不保证长期稳定

---

### 4.4 终极方案：手动策展

**方式**: 
- 不做自动抓取
- 用户手动粘贴 Twitter 链接（对应架构文档的 Mode 1 即兴分析）
- 或者使用 Twitter 官方的"书签"功能导出

**优点**: 
- ✅ 合法合规
- ✅ 无 API 成本
- ✅ 无反爬风险

**缺点**:
- ❌ 不自动更新
- ❌ 需要用户手动操作

**推荐理由**: 考虑到 Twitter API 成本和爬虫风险，这是最稳妥的方案

---

## 5. 个性化推荐的轻量方案

### 方案 5.1: Embedding + Cosine Similarity

**技术栈**:
- **OpenAI text-embedding-3-small**: $0.02/M tokens，768 维
- **或 Deepseek Embedding**（更便宜，需验证质量）
- **向量相似度**: 手写 cosine similarity（10 行代码）

**实现**:
```javascript
// 1. 用户阅读文章时，生成 embedding
const embedding = await openai.embeddings.create({
  input: article.title + ' ' + article.summary,
  model: 'text-embedding-3-small'
});

// 2. 存入 SQLite（JSON 列）
db.run('INSERT INTO content_embeddings (content_id, embedding) VALUES (?, ?)',
  [contentId, JSON.stringify(embedding.data[0].embedding)]);

// 3. 推荐时，计算相似度
const userInterests = await getUserInterests();  // 用户阅读过的内容的 embedding
const candidates = await getAllContent();
candidates.forEach(c => {
  c.score = cosineSimilarity(userInterests, c.embedding);
});
// 返回 top 10
```

**成本**:
- 假设每天 100 篇新内容，每篇 200 tokens
- 100 × 200 × 30 = 600k tokens/月
- $0.02/M × 0.6 = **$0.012/月**（可忽略）

**已知局限**:
- 冷启动问题（用户初期没有行为数据）
- 需要定期重新计算（用户兴趣变化）

**推荐理由**: 极轻量，成本极低，效果够用

---

### 方案 5.2: 基于标签的协同过滤

**实现**:
```javascript
// 1. 文章打标签（LLM 自动提取或手动）
const tags = await extractTags(article);  // ['React', 'Performance', 'Hooks']

// 2. 用户兴趣画像（根据阅读历史）
const userTags = { 'React': 0.8, 'Performance': 0.6, 'Vue': 0.3 };

// 3. 推荐时，计算标签重叠度
const score = article.tags.reduce((sum, tag) => sum + (userTags[tag] || 0), 0);
```

**优点**:
- ✅ 可解释性强（推荐理由明确）
- ✅ 不需要 embedding（零 API 成本）

**缺点**:
- ❌ 精度低于 embedding
- ❌ 需要维护标签体系

---

## 6. 内容去重与质量评估

### 6.1 URL 归一化 + 内容指纹

**方案**: 
1. **URL 归一化**（处理 utm 参数、短链接展开）
   ```javascript
   function normalizeURL(url) {
     const parsed = new URL(url);
     // 去掉 utm_* 参数
     parsed.searchParams.delete('utm_source');
     parsed.searchParams.delete('utm_medium');
     // 去掉 www.
     parsed.hostname = parsed.hostname.replace(/^www\./, '');
     return parsed.toString();
   }
   ```

2. **内容指纹**（SimHash / MinHash）
   - **npm 包**: `simhash-js`、`minhash`
   - 对正文生成哈希，相似度 > 95% 视为重复

**已知局限**:
- 同一篇文章在不同平台（Medium / 个人博客）URL 不同
- 需要二次验证（标题相似度 + 内容指纹）

---

### 6.2 质量评估（启发式规则）

**简单版**（Phase 1 够用）:
```javascript
function scoreQuality(article) {
  let score = 0;
  
  // 1. 来源可信度
  if (trustedSources.includes(article.source)) score += 30;
  
  // 2. 互动指标
  score += Math.min(article.upvotes / 10, 20);  // 点赞数（最多 20 分）
  score += Math.min(article.comments / 5, 10);   // 评论数（最多 10 分）
  
  // 3. 内容长度
  if (article.body.length > 1000) score += 10;  // 深度内容加分
  
  // 4. 发布时间
  const age = Date.now() - article.publishedAt;
  if (age < 86400000) score += 10;  // 24 小时内加分（新鲜度）
  
  return score;
}
```

**高级版**（Phase 2）:
- 使用 LLM 判断内容质量（是否有独特观点、论证充分）
- 成本：每篇 500 tokens × $0.28/M = $0.00014（可接受）

---

### 6.3 去重库推荐

**方案 6.3.1: string-similarity (npm)**
- MIT 许可证，每周 600k 下载
- Dice Coefficient 算法
- 用于标题去重

**方案 6.3.2: simhash (npm)**
- 用于正文去重
- 生成 64 位哈希，汉明距离 < 3 视为相似

---

## TrendRadar 项目的借鉴价值

虽然无法访问 GitHub 详情，但从名称和定位推测：

**可能的数据源**（猜测）:
- AI HOT（你已用）
- Hacker News
- Reddit r/MachineLearning
- Twitter 特定账号
- GitHub Trending (AI/ML 相关)

**可借鉴的设计**:
- 多源聚合的数据模型（统一 Content 格式）
- 去重逻辑（URL + 标题相似度）
- Feed 流的优先级排序（时间 + 热度 + 来源权重）

**建议**: 你可以直接 clone 该项目，看它的数据源配置和去重实现。

---

## 总体建议：Phase 1 优先接入的源

### 推荐方案（按优先级）

#### P0（立即接入）

**1. Hacker News API**
- ✅ 官方 API，零成本，极稳定
- ✅ 覆盖技术/产品/创业，与 AI HOT 互补
- ✅ 接入成本：半天
- 接入方式：直接调用 Firebase API

**2. RSSHub（自建）**
- ✅ 万物皆可 RSS，覆盖微博/B站/知乎/GitHub/YouTube
- ✅ 一次部署，长期受益
- ✅ 接入成本：1 天（Docker 部署 + 路由配置）
- 用途：
  - GitHub Trending: `/github/trending/javascript`
  - YouTube 频道: `/youtube/channel/@karpathy`
  - 知乎热榜: `/zhihu/hotlist`
  - 微信公众号: `/wechat/mp/:id`（通过搜狗）

#### P1（下周接入）

**3. Dev.to API**
- ✅ 免费，覆盖开发者博客
- ✅ 接入成本：半天
- 用途：前端/后端技术文章

**4. Reddit API（无认证版）**
- ✅ 免费，覆盖垂直社区
- ✅ 接入成本：半天
- 用途：r/MachineLearning, r/programming, r/webdev

#### P2（Phase 2 考虑）

**5. Product Hunt API**
- ⚠️ OAuth 复杂，Rate Limit 低
- 用途：产品发现
- 优先级低于技术类内容

**6. Twitter/X**
- ❌ 官方 API 太贵
- ⚠️ RSSHub Twitter 路由不稳定
- **建议**: 用户手动粘贴链接（Mode 1 即兴分析）

---

## 实施路线图

### Week 1: 基础多源接入
```
Day 1-2: 部署 RSSHub（Docker）
Day 3: 接入 Hacker News API
Day 4: 接入 Dev.to API
Day 5: 接入 Reddit API（无认证）
```

### Week 2: 去重与质量评估
```
Day 1-2: 实现 URL 归一化 + SimHash 去重
Day 3: 实现质量评分（启发式规则）
Day 4-5: 前端 Feed 流整合（多源混排）
```

### Week 3: 个性化推荐
```
Day 1-2: Embedding 生成（OpenAI / Deepseek）
Day 3-4: 相似度推荐逻辑
Day 5: A/B 测试推荐效果
```

---

## 技术债务提醒

### 1. RSSHub 的维护成本
- 部分路由会失效（平台反爬策略更新）
- 需要定期拉取最新 Docker 镜像
- 自建服务器需要监控

### 2. Twitter/X 的不确定性
- 任何非官方方案都可能失效
- 建议优先级放最低，用手动粘贴兜底

### 3. 内容去重的误杀
- SimHash 可能把相似但不同的文章判为重复
- 需要人工审核机制（用户反馈"这不是重复"）

### 4. 个性化推荐的冷启动
- 新用户没有行为数据，推荐无效
- 需要结合热度排序 + 随机探索

---

## 成本估算（Phase 1）

假设每天聚合 500 篇内容（AI HOT 100 + 其他源 400）：

| 项目 | 用量 | 单价 | 月成本 |
|------|------|------|--------|
| Hacker News API | 免费 | $0 | $0 |
| Dev.to API | 免费 | $0 | $0 |
| Reddit API | 免费 | $0 | $0 |
| RSSHub 自建 | 服务器 | ¥30/月 | ~$4 |
| Embedding (推荐) | 500 × 200 × 30 = 3M tokens | $0.02/M | $0.06 |
| 去重 (SimHash) | 本地计算 | $0 | $0 |
| **总计** | | | **$4.06/月** |

**结论**: 成本极低，瓶颈在开发时间，不在运营成本。

---

## 参考文档

- 架构基线: `docs/SYNTHESIZED-ARCHITECTURE.md`
- 数据源策略: §9（AI HOT 为主渠道）
- Mode 1 即兴分析: §2（用户手动粘贴链接）
- Phase 1 范围: §10

---

## 附录：API 速查表

| 平台 | API 地址 | 认证 | Rate Limit | 推荐度 |
|------|---------|------|-----------|--------|
| Hacker News | hacker-news.firebaseapp.com/v0 | 无 | 无 | ⭐⭐⭐⭐⭐ |
| Dev.to | dev.to/api | 可选 | 无明确限制 | ⭐⭐⭐⭐ |
| Reddit | reddit.com/r/XXX/hot.json | 可选 | 60/min | ⭐⭐⭐⭐ |
| Product Hunt | api.producthunt.com/v2 | OAuth | 100/h | ⭐⭐⭐ |
| Twitter | ❌ | $100/月 | 10k/月 | ⭐ |
| GitHub Trending | ❌ | 自建爬虫 | - | ⭐⭐⭐ |

---

## 下一步行动

1. **今天**: 验证 Hacker News API + RSSHub Docker 部署
2. **本周**: 接入 3 个 P0 数据源（HN + RSSHub + Dev.to）
3. **下周**: 实现去重逻辑，前端展示多源混排 Feed

需要我开始实现这些数据源的接入代码吗？
