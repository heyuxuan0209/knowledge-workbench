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
RAW="$OUT_DIR/work-diary-$DAY.raw.md"
HANDOFF="$OUT_DIR/handoff-delta-$DAY.shadow.md"
MEMORY="$OUT_DIR/memory-evolution-$DAY.shadow.md"
LOG="$OUT_DIR/work-diary-$DAY.codex.log"
PROMPT="$PROJECT/backend/scripts/daily-diary-prompt.md"

cd "$PROJECT/backend"
PRIOR_DAY="$(TZ=Europe/Paris date -d "$DAY -1 day" +%F)"
PRIOR="$OUT_DIR/work-diary-$PRIOR_DAY.shadow.md"
"$NODE_BIN" scripts/daily-diary-data.mjs --date="$DAY" --project="$PROJECT" \
  --prior-diary="$PRIOR" --diary-dir="$OUT_DIR" \
  --memory-roots="/home/bot/.claude/projects,/home/bot/.claude/memory" --output="$DATA"

cd "$PROJECT"
timeout 240 "$CODEX_BIN" exec --ephemeral --sandbox read-only --model gpt-5.6-sol \
  --output-last-message "$RAW" "$(cat "$PROMPT")" < "$DATA" > "$LOG" 2>&1

"$NODE_BIN" "$PROJECT/backend/scripts/split-daily-diary-output.mjs" "$RAW" "$REPORT" "$HANDOFF" "$MEMORY"

chmod 600 "$DATA" "$RAW" "$REPORT" "$HANDOFF" "$MEMORY" "$LOG"
echo "Codex 日记影子产物：$REPORT"
echo "Agent 接手增量影子产物：$HANDOFF"
echo "长期记忆演化影子产物：$MEMORY"
