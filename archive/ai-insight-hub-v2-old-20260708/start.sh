#!/bin/bash

# AI Insight Hub v2 - 快速启动脚本

echo "🚀 启动 AI Insight Hub v2..."

# 检查是否在正确的目录
if [ ! -f "backend/package.json" ]; then
    echo "❌ 错误：请在 ai-insight-hub-v2 目录下运行此脚本"
    exit 1
fi

# 启动后端
echo "📡 启动后端服务..."
cd backend
node src/server.js > /tmp/ai-insight-backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# 等待后端启动
sleep 2

# 检查后端是否启动成功
if curl -s http://localhost:3000/health > /dev/null; then
    echo "✅ 后端服务已启动 (PID: $BACKEND_PID)"
    echo "   地址: http://localhost:3000"
else
    echo "❌ 后端服务启动失败"
    exit 1
fi

# 启动前端
echo "🎨 启动前端服务..."
cd frontend
npm run dev > /tmp/ai-insight-frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

# 等待前端启动
sleep 3

echo ""
echo "✅ 所有服务已启动！"
echo ""
echo "📊 后端 API: http://localhost:3000"
echo "🌐 前端界面: http://localhost:5173"
echo ""
echo "📝 日志文件:"
echo "   后端: /tmp/ai-insight-backend.log"
echo "   前端: /tmp/ai-insight-frontend.log"
echo ""
echo "🛑 停止服务: kill $BACKEND_PID $FRONTEND_PID"
echo ""
echo "进程 ID 已保存到 .pids 文件"
echo "$BACKEND_PID" > .pids
echo "$FRONTEND_PID" >> .pids
