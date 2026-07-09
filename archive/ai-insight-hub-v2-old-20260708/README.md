# AI Insight Hub v2

个人化 AI 信息工作台 - MVP 版本

## 功能特性

- ✅ 从 AI HOT 获取 100 条内容
- ✅ 筛选到 20 条相关内容
- ✅ Web 界面浏览
- ✅ 反馈收集（有用/保存/跳过）
- ✅ 导出到 Obsidian

## 技术栈

**后端**:
- Node.js + Express.js
- SQLite (better-sqlite3)
- AI HOT API

**前端**:
- React + Vite
- Tailwind CSS
- Zustand (状态管理)

## 快速开始

### 1. 安装依赖

```bash
# 后端
cd backend
npm install

# 前端
cd ../frontend
npm install
```

### 2. 启动服务

```bash
# 启动后端 (终端 1)
cd backend
npm run dev

# 启动前端 (终端 2)
cd frontend
npm run dev
```

### 3. 访问应用

打开浏览器访问: http://localhost:5173

## 项目结构

```
ai-insight-hub-v2/
├── backend/              # 后端服务
│   ├── src/
│   │   ├── api/         # API 路由
│   │   ├── core/        # 核心业务逻辑
│   │   ├── adapters/    # 数据源适配器
│   │   ├── db/          # 数据库
│   │   └── server.js    # 服务器入口
│   ├── data/
│   │   ├── config.json  # 配置文件
│   │   └── app.db       # SQLite 数据库
│   └── package.json
│
├── frontend/            # 前端应用
│   ├── src/
│   │   ├── components/  # React 组件
│   │   ├── pages/       # 页面
│   │   ├── services/    # API 调用
│   │   ├── store/       # 状态管理
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
│
└── README.md
```

## 配置说明

编辑 `backend/data/config.json` 调整偏好设置:

```json
{
  "preferences": {
    "keywords": {
      "include": ["agent", "product", "startup"],
      "exclude": ["paper", "research"]
    },
    "categories": ["ai-products", "tip", "industry"],
    "min_score": 60,
    "max_items": 20
  },
  "obsidian": {
    "vault_path": "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/LLM Wiki",
    "folder_pattern": "AI-Insights/{year}-{month}"
  }
}
```

## API 端点

- `GET /api/items` - 获取推荐内容
- `POST /api/feedback` - 提交反馈
- `POST /api/export` - 导出到 Obsidian
- `GET /api/items/stats` - 获取统计信息

## 开发说明

### 后端开发

```bash
cd backend
npm run dev  # 使用 --watch 模式启动
```

### 前端开发

```bash
cd frontend
npm run dev  # Vite 开发服务器
```

## 验证清单

- [ ] 能成功获取 AI HOT 数据
- [ ] 能看到筛选后的推荐内容
- [ ] 能点击"有用"/"跳过"记录反馈
- [ ] 能点击"保存"导出到 Obsidian
- [ ] Obsidian 文件格式正确
- [ ] 推荐准确率 >70%

## 下一步计划

Phase 2 功能（完成 MVP 验证后）:
- 偏好学习（从反馈中学习）
- LLM 分析（产品启发）
- 主题聚合（相关内容分组）

## 许可证

MIT
