#!/usr/bin/env bash
# Codex 日记影子运行：只生成本地数据包和 Markdown，不写记忆、不发群、不替换旧 cron。
set -euo pipefail

export HOME="${HOME:-/home/bot}"
PROJECT="${KW_PROJECT_ROOT:-/home/bot/projects/knowledge-workbench}"
OUT_DIR="${KW_DAILY_DIARY_SHADOW_DIR:-/home/bot/loops/daily-diary-shadow}"
DAY="${1:-$(TZ=Europe/Paris date +%F)}"
NODE_BIN="${KW_NODE_BIN:-$(command -v node)}"
CODEX_BIN="${KW_CODEX_BIN:-$(command -v codex)}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

DATA="$OUT_DIR/work-diary-$DAY.data.json"
REPORT="$OUT_DIR/work-diary-$DAY.shadow.md"
LOG="$OUT_DIR/work-diary-$DAY.codex.log"
PROMPT="$PROJECT/backend/scripts/daily-diary-prompt.md"

cd "$PROJECT/backend"
"$NODE_BIN" scripts/daily-diary-data.mjs --date="$DAY" --output="$DATA"

cd "$PROJECT"
"$CODEX_BIN" exec --ephemeral --sandbox read-only --model gpt-5.6-sol \
  --output-last-message "$REPORT" "$(cat "$PROMPT")" < "$DATA" > "$LOG" 2>&1

chmod 600 "$DATA" "$REPORT" "$LOG"
echo "Codex 日记影子产物：$REPORT"
