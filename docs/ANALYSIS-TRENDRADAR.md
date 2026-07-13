# TrendRadar 项目深度分析与借鉴建议

**日期**: 2026-07-11  
**项目**: https://github.com/sansan0/TrendRadar  
**文档**: https://trendradar.sandev.cc/zh/docs/

---

## 1. TrendRadar 项目概览

### 定位
**AI 舆情监控与热点聚合推送工具**，定位与 Knowledge Workbench 高度相似，但聚焦于"推送通知"而非"知识沉淀"。

### 技术栈
- **语言**: Python（使用 `uv` 管理环境和依赖）
- **数据层**: SQLite + S3 兼容云存储（Cloudflare R2）
- **数据源**: NewsNow API（开源项目，支持 30+ 平台热榜）
- **AI**: 基于 LiteLLM 统一接口（支持 DeepSeek、OpenAI、Gemini、Ollama 等 100+ 模型）
- **部署**: GitHub Actions / Docker / 本地运行

### 开源协议
GPL-3.0（强传染性，意味着你的 Node.js 项目不能直接集成其代码，但可以借鉴思路）

---

## 2. TrendRadar 的数据源策略（核心借鉴点）

### 2.1 热榜数据来源：NewsNow API

**项目**: https://github.com/Busiyian/NewsNow  
**特点**:
- **30+ 主流平台热榜**：知乎、抖音、B站、微博、百度、今日头条、贴吧、华尔街见闻、财联社、澎湃新闻、凤凰网等
- **统一 API 格式**：每个平台返回标准化的 JSON（标题、链接、热度值）
- **免费、开源**（MIT 许可证）
- **自建或使用公共实例**：https://newsnow.busiyi.world/

**TrendRadar 默认启用的 11 个平台**:
1. 知乎
2. 抖音
3. bilibili 热搜
4. 华尔街见闻
5. 贴吧
6. 百度热搜
7. 财联社热门
8. 澎湃新闻
9. 凤凰网
10. 今日头条
11. 微博

### 2.2 RSS 订阅源（v4.5+）

- 支持 RSS/Atom 订阅源
- 统一筛选、合并推送
- 与热榜数据在同一个工作流中处理

---

## 3. TrendRadar 的核心能力（可借鉴的功能）

### 3.1 内容筛选系统

**关键词配置** (`config/frequency_words.txt`):
```
+AI        # 必须包含"AI"
!广告      # 必须不包含"广告"
/正则/     # 支持正则表达式
@10        # 限制推送数量
```

**AI 智能筛选** (`config/ai_interests.txt`):
- 自然语言描述兴趣（如"我关心前端框架的新特性"）
- AI 自动打分（0-100），过滤低相关度内容
- 节省用户手动过滤时间

### 3.2 推送模式

**3 种推送策略**:
1. **当日汇总**：每天固定时间推送全天热点
2. **当前榜单**：实时推送当前热榜 Top N
3. **增量监控**：只推送新增/变化的热点

### 3.3 AI 增强功能

**AI 分析推送**:
- 深度分析热点趋势
- 情感倾向分析
- 跨平台关联（同一话题在多个平台的讨论）
- 自定义提示词模板 (`config/ai_analysis_prompt.txt`)

**AI 多语言翻译**:
- 批量翻译节省 Token
- 支持任意语言

**MCP 对话分析**:
- 17 个分析工具
- 自然语言查询热点趋势
- 独立进程，只读查询数据

### 3.4 调度系统

**统一调度器** (`timeline.yaml`):
- 按时段编排采集/分析/推送
- 工作日与周末自动切换
- 灵活控制推送频率

---

## 4. TrendRadar 与 Knowledge Workbench 的对比

| 维度 | TrendRadar | Knowledge Workbench |
|------|-----------|---------------------|
| **定位** | 热点监控 + 推送通知 | 知识沉淀 + 研究工作台 |
| **核心实体** | 热榜条目（短生命周期） | Content / Source / Topic（长期演进） |
| **数据源** | 30+ 热榜平台（NewsNow API） | AI HOT + 多源聚合（待扩展） |
| **用户交互** | 被动接收推送 | 主动分析、对话、创作 |
| **AI 能力** | 分析推送 + MCP 对话 | Mode 1 即兴分析 + Topic 演进（规划中） |
| **技术栈** | Python + SQLite | Node.js + SQLite |
| **部署** | GitHub Actions / Docker | 本地开发中 |
| **开源协议** | GPL-3.0 | （未定） |

**关键差异**:
- TrendRadar 是"**消费导向**"（快速扫描热点）
- Knowledge Workbench 是"**沉淀导向**"（深度研究、知识积累）

---

## 5. 可直接借鉴的设计思路

### 5.1 数据源策略：NewsNow API（推荐接入）

**为什么推荐**:
- ✅ 覆盖 30+ 国内主流平台（知乎、B站、微博、抖音等）
- ✅ 免费、开源（MIT 许可证）
- ✅ 统一 API 格式，易于集成
- ✅ 与你的 AI HOT 互补（AI HOT 是全球 AI 资讯，NewsNow 是国内全领域热榜）

**接入方式**:
```javascript
// 使用公共实例
const response = await fetch('https://newsnow.busiyi.world/api/v1/sources/zhihu');
const data = await response.json();

// 或自建 NewsNow 服务（Node.js）
```

**对应你的需求**:
- 解决"AI HOT 只覆盖 AI 领域"的问题
- 提供实时热点（相比 AI HOT 的日更）
- 覆盖垂直领域（财经、科技、社交等）

### 5.2 内容筛选：关键词 + AI 智能筛选

**借鉴点**:
```javascript
// 关键词语法（可直接复用）
const filterRules = {
  mustInclude: ['+AI', '+前端'],           // 必须包含
  mustExclude: ['!广告', '!营销'],        // 必须排除
  regex: ['/React|Vue|Svelte/i'],       // 正则匹配
  limit: '@10'                           // 数量限制
};

// AI 智能筛选（可复用 Prompt 设计）
const aiFilter = async (content, userInterests) => {
  const prompt = `
用户兴趣：${userInterests}
文章标题：${content.title}
文章摘要：${content.summary}

请评分此文章与用户兴趣的相关度（0-100）：
- 90-100：强相关，必读
- 70-89：相关，推荐
- 50-69：弱相关，可选
- 0-49：不相关，过滤

只返回分数（整数）。
`;
  const score = await llmService.chat([{ role: 'user', content: prompt }]);
  return parseInt(score);
};
```

### 5.3 推送模式：适配不同使用场景

**借鉴点**:
- **当日汇总**：对应你的"每日 AI HOT 同步"
- **增量监控**：对应你的"实时更新需求"
- **当前榜单**：可用于"即兴分析模式"（用户手动查看最新热点）

**实现建议**:
```javascript
// config/push_modes.js
const PUSH_MODES = {
  DAILY_DIGEST: 'daily',     // 每日汇总（定时推送）
  REALTIME: 'realtime',       // 实时监控（增量推送）
  ON_DEMAND: 'on_demand'      // 按需查看（用户主动）
};

// 用户可在设置中选择模式
```

### 5.4 调度系统：时段化策略

**借鉴点**:
```yaml
# timeline.yaml（简化版）
schedule:
  weekday:
    - time: "08:00"
      action: "fetch"     # 早间抓取
    - time: "12:00"
      action: "push"      # 午间推送
    - time: "18:00"
      action: "fetch+push"
  weekend:
    - time: "10:00"
      action: "fetch+push"
```

**对应你的需求**:
- AI HOT 每日同步 → 改为"工作日早晚各一次"
- 热榜实时抓取 → 改为"高峰时段密集，夜间稀疏"

---

## 6. 不适合直接复用的部分

### 6.1 MCP 对话分析（过度设计）

**TrendRadar 的实现**:
- 独立 MCP Server 进程
- 17 个分析工具
- 需要 Claude Desktop 等客户端

**为什么不适合你**:
- ❌ 你已经有 Mode 1 即兴分析（基于 Deepseek 对话）
- ❌ MCP 是额外的技术栈（增加复杂度）
- ❌ 你的用户不需要"17 个分析工具"，需要的是"流畅的对话"

**建议**: 坚持 Mode 1 的设计（弹窗对话），不引入 MCP。

### 6.2 推送渠道（不是你的核心需求）

**TrendRadar 的实现**:
- 9 大推送渠道（企业微信、飞书、钉钉、Telegram、邮件等）
- 用于"被动接收"通知

**为什么不适合你**:
- ❌ 你的产品是"工作台"，用户主动使用
- ❌ 推送渠道是额外维护成本
- ❌ 你的核心是"知识沉淀"，不是"消息推送"

**建议**: Phase 1 不做推送，专注于 Feed 流展示和即兴分析。

### 6.3 GitHub Actions 部署（不适合长期运行）

**TrendRadar 的实现**:
- 完全基于 GitHub Actions（免费但有限制）
- 每 7 天需要手动"签到"防止工作流暂停

**为什么不适合你**:
- ❌ 你的产品需要长期运行（Feed 流实时更新）
- ❌ GitHub Actions 有执行时间限制（每月 2000 分钟免费）
- ❌ 本地开发中，Docker 部署更合适

**建议**: Phase 1 本地运行，Phase 2 考虑 Docker 部署。

---

## 7. 推荐的借鉴方案（优先级排序）

### P0（立即借鉴）

**1. 接入 NewsNow API**
- **理由**: 一次接入覆盖 30+ 平台，解决数据源单一问题
- **工作量**: 1 天
- **实现**:
  ```javascript
  // backend/src/services/newsnow.js
  class NewsNowService {
    async fetchPlatform(platformId) {
      const url = `https://newsnow.busiyi.world/api/v1/sources/${platformId}`;
      const response = await fetch(url);
      return response.json();
    }
    
    async fetchMultiple(platformIds) {
      return Promise.all(platformIds.map(id => this.fetchPlatform(id)));
    }
  }
  ```

**2. 关键词筛选语法**
- **理由**: 简单、实用、用户可控
- **工作量**: 半天
- **实现**: 参考上文 §5.2 的代码

### P1（本周内完成）

**3. AI 智能筛选**
- **理由**: 减少信息过载，个性化推荐
- **工作量**: 1 天
- **实现**: 用 Deepseek 评分内容相关度

**4. 推送模式切换**
- **理由**: 适配不同使用场景
- **工作量**: 半天
- **实现**: 前端增加"模式切换"开关

### P2（Phase 2 考虑）

**5. 调度系统**
- **理由**: 优化抓取频率，节省资源
- **工作量**: 2 天
- **实现**: 参考 TrendRadar 的 `timeline.yaml` 设计

**6. 跨平台关联分析**
- **理由**: 发现同一话题在多平台的讨论
- **工作量**: 3 天
- **实现**: Embedding 相似度 + LLM 判断

---

## 8. 技术栈差异的适配建议

### TrendRadar（Python）→ Knowledge Workbench（Node.js）

| TrendRadar 组件 | Knowledge Workbench 等价方案 |
|----------------|------------------------------|
| NewsNow API (Python 客户端) | 直接调用 HTTP API（fetch） |
| SQLite + S3 (Python) | node:sqlite + 可选云存储 |
| LiteLLM (Python) | 直接调用 OpenAI SDK（Deepseek 兼容） |
| uv (Python 环境管理) | Node.js 26 原生 |
| MCP Server (Python) | 不需要（已有 Mode 1 对话） |

**关键点**: TrendRadar 的核心逻辑（数据源选择、筛选策略、AI 分析）与语言无关，可以用 Node.js 重新实现。

---

## 9. 实施路线图（基于 TrendRadar 借鉴）

### Week 1: NewsNow API 接入
```
Day 1: 接入 NewsNow API，支持知乎/B站/微博等 5 个平台
Day 2: 实现统一 Content 模型（NewsNow + AI HOT）
Day 3: 前端展示多源混排 Feed
```

### Week 2: 内容筛选
```
Day 1: 关键词筛选（+必须词、!过滤词、/正则/）
Day 2: AI 智能筛选（用户兴趣画像 + 评分）
Day 3: 前端筛选器 UI
```

### Week 3: 推送模式与调度
```
Day 1-2: 推送模式切换（当日汇总/实时/按需）
Day 3-4: 调度系统（时段化策略）
Day 5: 测试与优化
```

---

## 10. 成本对比

### TrendRadar（GitHub Actions 免费方案）
- **运行成本**: $0（完全免费）
- **限制**: 每月 2000 分钟，每 7 天需手动签到
- **适用场景**: 个人轻量使用

### Knowledge Workbench（自建方案）
- **运行成本**: $4-10/月（服务器 + API）
  - NewsNow API: $0（免费）
  - RSSHub: $4/月（服务器）
  - Deepseek API: $2-5/月（低频使用）
- **优势**: 无限制，长期稳定
- **适用场景**: 个人/团队深度使用

---

## 11. 最终建议

### 立即行动（本周）

**1. 接入 NewsNow API**（优先级最高）
- 一次接入覆盖 30+ 平台
- 解决"AI HOT 单一数据源"问题
- 与 Hacker News、RSSHub 形成三大支柱

**2. 实现关键词筛选**
- 简单、实用、用户可控
- 立即缓解"信息过载"问题

**3. 保持现有架构**
- 不引入 MCP（过度设计）
- 不做推送渠道（非核心需求）
- 专注于 Mode 1 即兴分析

### 技术验证（今天内完成）

```bash
# 测试 NewsNow API
curl https://newsnow.busiyi.world/api/v1/sources/zhihu | jq '.data[:3]'

# 测试关键词筛选逻辑（伪代码）
node -e "
const title = 'AI 大模型新突破';
const rules = { mustInclude: ['+AI'], mustExclude: ['!广告'] };
console.log(title.includes('AI') && !title.includes('广告'));
"
```

---

## 附录：TrendRadar 支持的全部平台（参考）

**综合资讯**（11 个）:
- 知乎、抖音、bilibili、微博、百度热搜、今日头条、贴吧、澎湃新闻、凤凰网、腾讯新闻、网易新闻

**财经**（5 个）:
- 华尔街见闻、财联社、东方财富、雪球、36氪

**科技**（4 个）:
- IT之家、少数派、V2EX、掘金

**社交**（3 个）:
- 小红书、豆瓣、贴吧

**视频**（2 个）:
- 抖音、快手

**其他**（5+ 个）:
- GitHub Trending、ProductHunt、HelloGitHub 等

**总计**: 30+ 平台（持续更新中）

---

## 参考链接

- TrendRadar GitHub: https://github.com/sansan0/TrendRadar
- TrendRadar 文档: https://trendradar.sandev.cc/zh/docs/
- NewsNow 项目: https://github.com/Busiyian/NewsNow
- NewsNow 在线预览: https://newsnow.busiyi.world/
- 社区平台清单: https://github.com/sansan0/TrendRadar/issues/95
