# 30 秒快速上下文

**看这一个文件就够了**

---

## 项目是什么？
个人 AI 资讯工作台，从信息到洞察的完整流程

## 当前版本
v0.1.0 - 基础信息浏览功能

## 核心竞争力
工作区对话 + LLM 分析（**未实现，是下一步重点**）

## 下一步
开发 v0.2.0 工作区对话功能（2 周）

## 技术栈
React 18 + Vite + Tailwind + Node.js 26 + SQLite

## 代码位置
```
/Users/USER/Documents/项目/knowledge-workbench/
├── backend/    # 后端
└── frontend/   # 前端
```

## 启动命令
```bash
# 后端
cd backend && node src/server.js

# 前端
cd frontend && npm run dev

# 访问
http://localhost:5173/
```

## 必读文档
1. `handoff/NEW-SESSION-HANDOFF.md` (本次交接)
2. `handoff/CONTEXT.md` (详细状态)
3. `explorations/design-options/comprehensive-comparison.md` (设计方案)

## 关键决策
- ✅ 保留浅色主题，不重构
- ✅ 优先工作区对话（核心）
- ✅ Deepseek 为主（成本低）
- ❌ 暂不需要向量数据库

## 已知问题
- 推荐理由和标签是 mock 数据
- 右侧面板功能未完善
- LLM 未集成

## Git 状态
```
git log --oneline
56ce20e docs: 添加两个设计方案的综合对比分析
5fcd185 docs: 修正文档中的所有路径引用
a83bb44 chore: 项目重组和文档规范化

git tag
v0.1.0
```

---

**开始开发 v0.2.0？看 `handoff/NEW-SESSION-HANDOFF.md`**
