#!/bin/bash
# knowledge-workbench 本地开发一键启动（2026-08-03 cutover 后用；2026-08-07 加隧道避让）
# 双击本文件即可：起后端(node --watch，改代码自动重载) + 前端(vite)，关窗口即全停。
#
# ⚠️ 这不是"用产品"的入口——日常用 KW 请双击「KW-知识工作台.command」（连的是 VPS 实时数据）。
# 本脚本用的是 Mac 上的 app.db（8/3 迁移那天的旧快照），只供写代码/离线调试。
#
# ⚠️ 跑着本脚本的时候，一键发布是半残的（2026-08-08 ADR-094 之后）：
#   隧道被停掉了，localhost:3000 变成本地后端，所以「送到公众号」依赖的排版/头图接口
#   打的是 8/3 旧快照的数据；而且这期间双击「KW-知识工作台」会探测到隧道不通、
#   退回 kw-vps:3000——那个地址浏览器扩展进不去，发布按钮点了没反应。
#   要发东西就先关掉本脚本（关窗口即自动恢复隧道）。
set -e
PROJ="/Users/heyuxuan/Documents/项目/knowledge-workbench"
TUNNEL_PLIST="$HOME/Library/LaunchAgents/com.knowledge-workbench.tunnel.plist"
TUNNEL_LABEL="gui/$(id -u)/com.knowledge-workbench.tunnel"
RESTORE_TUNNEL=0

# 3000 端口避让：常驻的 ssh 隧道占着 3000（ADR-081），本地后端会起不来。
# 这里临时停掉它，退出时自动恢复——否则你会看到一个莫名其妙的 EADDRINUSE。
if launchctl print "$TUNNEL_LABEL" >/dev/null 2>&1; then
  echo "⏸  先停掉常驻 ssh 隧道（它占着 3000），退出本脚本时会自动恢复…"
  launchctl bootout "$TUNNEL_LABEL" 2>/dev/null || true
  RESTORE_TUNNEL=1
  sleep 1
fi

# 还有别的东西占着 3000 就直说，别让人对着报错猜
HOLDER=$(lsof -nP -iTCP:3000 -sTCP:LISTEN -Fc 2>/dev/null | grep '^c' | head -1 | cut -c2-)
if [ -n "$HOLDER" ]; then
  echo "⚠️  3000 端口还被 [$HOLDER] 占着，本地后端起不来。先关掉它再试。"
  [ "$RESTORE_TUNNEL" = 1 ] && launchctl bootstrap "gui/$(id -u)" "$TUNNEL_PLIST" 2>/dev/null
  read -r -p "回车退出…"
  exit 1
fi

cleanup() {
  echo; echo "⏹ 关闭后端+前端…"
  kill "$BACKEND_PID" 2>/dev/null
  if [ "$RESTORE_TUNNEL" = 1 ]; then
    echo "▶ 恢复常驻 ssh 隧道…"
    launchctl bootstrap "gui/$(id -u)" "$TUNNEL_PLIST" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

cd "$PROJ/backend"
echo "▶ 启动后端(端口 3000)…"
node --watch src/server.js &
BACKEND_PID=$!
sleep 3
echo "▶ 启动前端(端口 5173)… 起好后浏览器开 http://localhost:5173"
cd "$PROJ/frontend"
npm run dev
