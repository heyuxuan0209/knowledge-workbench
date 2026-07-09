#!/bin/bash

# AI Insight Hub v2 - 停止脚本

echo "🛑 停止 AI Insight Hub v2..."

if [ -f ".pids" ]; then
    while read pid; do
        if kill -0 $pid 2>/dev/null; then
            kill $pid
            echo "✅ 已停止进程 $pid"
        fi
    done < .pids
    rm .pids
    echo "✅ 所有服务已停止"
else
    echo "⚠️  未找到 .pids 文件，尝试通过进程名停止..."
    pkill -f "node src/server.js"
    pkill -f "vite"
    echo "✅ 已尝试停止所有相关进程"
fi
