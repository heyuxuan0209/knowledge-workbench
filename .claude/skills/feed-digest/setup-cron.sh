#!/bin/bash
# feed-digest 一键落地：装每日 launchd 定时 + 立即跑一次首跑。
# 在你 Mac 的终端里跑一次即可。可重复执行（幂等）。
set -euo pipefail

SKILL_DIR="$HOME/Documents/项目/knowledge-workbench/.claude/skills/feed-digest"
LABEL="com.kwb.feed-digest"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

cd "$SKILL_DIR" || { echo "❌ 找不到 skill 目录：$SKILL_DIR"; exit 1; }

# 1) node 绝对路径（launchd 的 PATH 很干净，必须写全路径）
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node; do [ -x "$c" ] && NODE="$c" && break; done
fi
[ -z "$NODE" ] && { echo "❌ 没找到 node，请先装 Node 18+"; exit 1; }
echo "✓ node: $NODE"

# 2) 探测本机代理（127.0.0.1:7897）。有就给首跑和 launchd 都带上。
PROXY=""
if command -v nc >/dev/null 2>&1 && nc -z -G2 127.0.0.1 7897 >/dev/null 2>&1; then
  PROXY="http://127.0.0.1:7897"
  echo "✓ 检测到本机代理 7897，首跑与定时都将走代理"
else
  echo "· 未检测到 7897 代理（若某些源需要翻墙，请开代理后重跑本脚本）"
fi

# 3) 生成 launchd plist（每天 08:00）
PROXY_XML=""
if [ -n "$PROXY" ]; then
  PROXY_XML="    <key>HTTPS_PROXY</key><string>$PROXY</string>
    <key>HTTP_PROXY</key><string>$PROXY</string>"
fi
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$SKILL_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>scripts/run.mjs</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
$PROXY_XML
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/feed-digest.log</string>
  <key>StandardErrorPath</key><string>/tmp/feed-digest.err</string>
</dict></plist>
EOF
echo "✓ 已写 plist: $PLIST"

# 4) 装载 launchd（改动后先 unload 再 load）
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "✓ launchd 已装载（每天 08:00 自动跑）"

# 5) 立即跑一次首跑（生成初始 digest.md）
echo ""
echo "===== 首跑开始（抓取→翻译→写 digest）====="
if [ -n "$PROXY" ]; then
  HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY" "$NODE" scripts/run.mjs
else
  "$NODE" scripts/run.mjs
fi
echo "===== 首跑结束 ====="
echo ""
echo "✅ 完成。成品在：$SKILL_DIR/data/digest.md"
echo "   查看：open \"$SKILL_DIR/data/digest.md\""
echo "   定时日志：/tmp/feed-digest.log  /tmp/feed-digest.err"
echo "   只跑一个源调试：\"$NODE\" scripts/run.mjs --source hf-papers"
