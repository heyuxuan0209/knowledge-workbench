#!/usr/bin/env bash
# Codex 月报影子运行：只读取数并生成本地 Markdown，不写飞书、不发群、不替换旧 cron。
set -euo pipefail

export HOME="${HOME:-/home/bot}"
PROJECT="${KW_PROJECT_ROOT:-/home/bot/projects/knowledge-workbench}"
OUT_DIR="${KW_MONTHLY_SHADOW_DIR:-/home/bot/loops/monthly-shadow}"
MONTH="${1:-$(TZ=Asia/Shanghai date +%Y-%m)}"
NODE_BIN="${KW_NODE_BIN:-$(command -v node)}"
CODEX_BIN="${KW_CODEX_BIN:-$(command -v codex)}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

DATA="$OUT_DIR/content-briefing-$MONTH.data.json"
REPORT="$OUT_DIR/content-briefing-$MONTH.shadow.md"
LOG="$OUT_DIR/content-briefing-$MONTH.codex.log"
PROMPT="$PROJECT/backend/scripts/monthly-briefing-prompt.md"

cd "$PROJECT/backend"
"$NODE_BIN" scripts/monthly-briefing-data.mjs --month="$MONTH" --output="$DATA"

cd "$PROJECT"
"$CODEX_BIN" exec \
  --ephemeral \
  --sandbox read-only \
  --model gpt-5.6-sol \
  --output-last-message "$REPORT" \
  "$(cat "$PROMPT")" < "$DATA" > "$LOG" 2>&1

chmod 600 "$DATA" "$REPORT" "$LOG"
echo "Codex 月报影子产物：$REPORT"
