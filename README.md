# Knowledge Workbench · 知识工作台

一个把「读到」变成「想明白」的个人知识管理系统。

它从信息洪流中筛出真正值得吸收的部分，沉淀加工成你自己的认知与产品灵感，再打磨成内容分发到多个平台；发布后的反馈回流进系统，让选题、信源与判断随每一次复盘持续进化。影响力不是目标本身，而是这条循环转起来之后的自然产物。

**里程碑**：M1 沉淀层 → M5 多模态接入 已全部完成（2026-07-16）。当前阶段：手动跑通「探讨 → 深稿 → 发布 → 复盘」完整环路。

---

## 🎯 它解决什么问题

信息过载时代，读得多不等于懂得多。这个系统把「信息 → 认知 → 内容 → 影响力」做成一条流水线：

```
多源信息流入（宽）
    ↓ 采集 + 筛选（AI 全自动：翻译、摘要、聚类、相关性过滤）
主题弹药库（收窄：素材自动归入长期研究主题）
    ↓ 探讨（人的主场：带着问题与 AI 对话，沉淀判断）
深稿（价值凝结点）
    ↓ 裂变（AI 全自动：长文 / X thread / 口播脚本）
中英多平台内容（放宽）
    ↓ 发布 + 复盘
回流进化（闭环：复盘结果反哺信源权重与主题方向）
```

分工原则：**AI 吃掉一切不产生理解的环节**（采集、去重、翻译、格式转换、平台适配）；**「决定写什么、核心论点、判断」留在人手上**。

---

## ✨ 核心功能（按流水线阶段）

### 📥 资讯 —— 多源采集
- **内置源**：AI HOT 精选、Hacker News、GitHub Trending（每日自动同步）
- **登记源**：X 账号（借道 AI HOT 热门转载）、博客/官网（RSS 自动探测，含 6 路径兜底）、小宇宙播客（免登录追更）、B站 UP 主、YouTube 频道、GitHub 用户、公众号（登记标注）
- **官方源包**：Anthropic / OpenAI / Google 系官方动态与研究，一键登记
- **万能收口**：任意链接粘进来即抓取 + 翻译 + 结构化精读（文章 / 视频字幕 / 播客转写）

### 📝 素材 —— 沉淀
- AI 对话中一键「保存到笔记」，自动起标题、自动匹配主题
- 关键词 / 来源 / 主题筛选搜索（SQL 层，支持多关键词模糊匹配）

### 📚 主题页 —— 知识加工（核心资产）
- 每个主题是一篇 **AI 持续维护的综述**：新素材自动并入，更新认知、标注观点冲突
- 匹配可解释：每条素材显示「因共享『xx』『yy』被匹配 + 相似度」，误并一键移出并修订综述
- changelog 时间线 = 认知演进史

### ✍️ 创作 —— 内容生产
- 主题页一键起稿（长文 / X thread / 口播脚本三平台规格）
- 段落级溯源（[素材N] 标记落库，导出时转参考来源列表）
- 去 AI 味审校（三遍法内化为一道工序）、标题候选、指令改写

### 📊 洞察 —— 日报 / 周报 / 月报
- 日报：热点聚类 + 焦点解读 + 选题建议
- 周报/月报：升温降温动向（本地统计，每条可展开命中文章验证）、主题演进汇总、涌现建议、深度选题——**全板块带溯源链接**
- 多模态：视频字幕→ASR 三级降级、播客转写、说话人分离（faster-whisper + pyannote）

---

## 🚀 快速开始

```bash
# 1. 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 2. 配置环境变量
cd ../backend
cp .env.example .env
# 填入 DEEPSEEK_API_KEY（https://platform.deepseek.com）
# 可选：HF_TOKEN（说话人分离用，Hugging Face token）

# 3. 初始化数据库（基准 schema 即最新结构）
mkdir -p data
sqlite3 data/app.db < src/db/schema-v3.sql

# 4. 拉取首批内容
node src/services/sync-aihot.js

# 5. 启动
node src/server.js                 # 后端 :3000（Terminal 1）
cd ../frontend && npm run dev      # 前端 :5173（Terminal 2）
```

访问 http://localhost:5173/

**定时化（可选）**：`sync-aihot / sync-hackernews / sync-rss / sync-github-trending / sync-active-query / sync-daily-report / sync-period-report` 均为独立可执行脚本，按需挂 crontab（早晚同步 + 每日简报 + 周一周报）。

---

## 📂 项目结构

```
knowledge-workbench/
├── backend/src/
│   ├── server.js                  # Express API（全部端点在此，模块间只经数据层/HTTP 通信）
│   ├── db/                        # node:sqlite · schema-v3.sql 为基准 · migrate-m*.js 幂等增量
│   └── services/                  # 业务服务
│       ├── sync-*.js              #   各数据源同步（独立可执行，crontab 友好）
│       ├── source-registry.js     #   信源识别→登记→能力分级（四档成本分层）
│       ├── active-query-channels.js #  B站/YouTube/GitHub/小宇宙 免登录适配器
│       ├── topic-pages.js / assimilation.js  # 主题页匹配与同化引擎
│       ├── period-report.js / report-generation.js  # 周报月报/日报（本地统计+LLM 归纳）
│       ├── draft-generation.js    #   起稿/去AI味/段落溯源
│       └── content-ingestion.js   #   万能收口（文章/视频/播客 → 结构化精读）
├── frontend/src/
│   ├── pages/WorkbenchPage.jsx    # 主壳：三栏工作台
│   └── components/wb/             # 资讯/素材/主题/创作/信源/报告 各视图
└── reference/prompts/             # 产品化 prompt（文件即行为，改文件即改产品）
```

> 设计蓝图、架构决策记录（ADR）、专项调研等文档在本地维护，暂未随仓库公开。

---

## 🛠 技术栈与成本原则

| 层 | 选型 |
|---|---|
| 后端 | Node.js 26 + Express + node:sqlite（零外部数据库） |
| 前端 | React 18 + Vite（手写 workbench.css 设计系统） |
| LLM | Deepseek（¥1/M tokens，OpenAI SDK 兼容），SSE 流式 |
| 多模态 | faster-whisper（本地转写）+ pyannote 3.1（说话人分离）+ yt-dlp / bili-cli / gh |
| 验证 | Playwright 驱动真实 UI 的端到端验证 |

**成本原则：本地零成本优先。** 主题匹配（TF 余弦）、热度统计、关键词动向全部本地计算不走 LLM；LLM 只用在翻译、摘要、同化、起稿等真正需要语言能力的环节，且批量合并调用。

---

**最后更新**: 2026-07-16
