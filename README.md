# Knowledge Workbench

个人化 AI 信息工作台 - 帮助你从 AI 信息过载中解脱

## 🎯 项目定位

**不是**: AI 资讯聚合器（AI HOT 已经做了）  
**而是**: 个人化的 AI 信息工作台 + 知识炼金术

从信息过载 (100条) → 个性化推荐 (15-20条) → 知识沉淀 (Obsidian) → 内容创作

---

## 📚 核心文档

### 给开发者（Sonnet 5）

1. **[HANDOFF-SUMMARY.md](./HANDOFF-SUMMARY.md)** ⭐ 从这里开始
   - 5分钟快速理解交接内容
   - 已完成的工作
   - 下一步工作
   - 关键决策

2. **[MVP-HANDOFF.md](./MVP-HANDOFF.md)** 📖 开发指南
   - 可直接开始开发的详细文档
   - 技术栈、目录结构、数据库设计
   - API 设计、核心算法、代码模板
   - 开发步骤、验证清单、FAQ

3. **[ARCHITECTURE.md](./ARCHITECTURE.md)** 🏗️ 完整架构
   - 系统定位和核心价值
   - 分层架构设计
   - 核心模块详细设计
   - 分 4 个 Phase 的实施计划
   - 成本估算、风险应对

### 给产品负责人

1. **[brief.md](./brief.md)** - 项目背景和初衷
2. **[ARCHITECTURE.md](./ARCHITECTURE.md)** 第一、二章 - 了解系统定位和架构
3. **[ai-insight-hub/output/](./ai-insight-hub/output/)** - 查看现有系统的输出示例

---

## 🚀 快速开始

### 如果你是开发者（Sonnet 5）

```bash
# 1. 阅读交接文档（1小时）
cat HANDOFF-SUMMARY.md      # 5分钟
cat MVP-HANDOFF.md           # 30分钟
cat ARCHITECTURE.md          # 30分钟

# 2. 查看现有系统示例
open ai-insight-hub/output/daily-2026-07-08.html

# 3. 开始开发新系统
mkdir ai-insight-hub-v2
cd ai-insight-hub-v2
# 按照 MVP-HANDOFF.md 的步骤开始
```

### 如果你是产品负责人

```bash
# 了解项目背景
cat brief.md

# 了解系统设计
cat ARCHITECTURE.md | head -200

# 查看现有输出
open ai-insight-hub/output/daily-2026-07-08.html
```

---

## 📁 目录说明

```
knowledge-workbench/
│
├── 📄 核心文档（根目录）
│   ├── README.md                    # 本文档
│   ├── HANDOFF-SUMMARY.md          # ⭐ 交接总结（从这里开始）
│   ├── MVP-HANDOFF.md              # 📖 MVP 开发指南
│   ├── ARCHITECTURE.md             # 🏗️ 完整架构设计
│   ├── brief.md                    # 项目背景
│   └── CLEANUP-PLAN.md             # 清理方案说明
│
├── 📂 ai-insight-hub/              # 现有系统（v1，参考用）
│   ├── scripts/                    # 脚本
│   ├── data/                       # 数据
│   └── output/                     # HTML 输出
│
├── 📂 ai-insight-hub-v2/           # 新系统（待开发）
│   ├── backend/                    # 后端（Express + SQLite）
│   ├── frontend/                   # 前端（React + Tailwind）
│   └── docs/                       # 文档
│
└── 📂 archive/                     # 归档文档
    ├── 2026-07-06-initial-exploration/  # 初期探索文档
    └── history/                         # 历史记录
```

---

## 🗓️ 项目时间线

- **2026-07-05**: 项目启动，初步探索
- **2026-07-06**: 完成 v1 原型（ai-insight-hub）
- **2026-07-08**: 完成完整架构设计，交接给 Sonnet 5

---

## 🎯 MVP 目标

**Phase 1 (Week 1-2)**: 验证核心价值

只做 3 件事：
1. ✅ **筛选**: 从 AI HOT 100 条筛到 20 条
2. ✅ **展示**: Web 界面浏览
3. ✅ **保存**: 导出到 Obsidian

**验证标准**:
- 推荐准确率 >70%
- 用户连续使用 3 天
- 每天保存 >3 条

---

## 💡 核心原则

1. **不重复造轮子** - 直接使用 AI HOT 的摘要，不重新生成
2. **先验证价值** - MVP 只做筛选+展示+保存
3. **渐进式迭代** - Phase 1 → 2 → 3 → 4，每阶段独立验证
4. **成本可控** - Phase 1 不调用 LLM，预期 $0/月

---

## 📧 团队

- **产品负责人**: @heyuxuan
- **架构设计**: Opus 4.8
- **开发实施**: Sonnet 5

---

## 🔗 相关资源

- **AI HOT**: https://aihot.virxact.com
- **AI HOT API**: https://aihot.virxact.com/api/public/items

---

**最后更新**: 2026-07-08  
**文档版本**: v1.0

祝开发顺利！🚀
