#!/usr/bin/env bash
# Codex 每日外脑：巴黎 06:30 运行，复盘上一个巴黎自然日。
set -euo pipefail

export HOME="${HOME:-/home/bot}"
PROJECT="${KW_PROJECT_ROOT:-/home/bot/projects/knowledge-workbench}"
OUT_DIR="${KW_DAILY_DIARY_DIR:-/home/bot/loops/daily-diary}"
DAY="${1:-$(TZ=Europe/Paris date -d yesterday +%F)}"
NODE_BIN="${KW_NODE_BIN:-$(command -v node)}"
CODEX_BIN="${KW_CODEX_BIN:-$(command -v codex)}"
PROMPT="$PROJECT/backend/scripts/daily-diary-prompt.md"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
RUN_DIR="$(mktemp -d "$OUT_DIR/.run-$DAY.XXXXXX")"

DATA="$RUN_DIR/ledger.json"
RAW="$RUN_DIR/raw.md"
DIARY="$RUN_DIR/diary.md"
HANDOFF="$RUN_DIR/handoff.md"
MEMORY="$RUN_DIR/memory.md"
LOG="$RUN_DIR/codex.log"
PRIOR_DAY="$(TZ=Europe/Paris date -d "$DAY -1 day" +%F)"
PRIOR="$OUT_DIR/work-diary-$PRIOR_DAY.md"

cd "$PROJECT/backend"
"$NODE_BIN" scripts/daily-diary-data.mjs --date="$DAY" --project="$PROJECT" \
  --prior-diary="$PRIOR" --diary-dir="$OUT_DIR" \
  --memory-roots="/home/bot/.claude/projects,/home/bot/.claude/memory" \
  --conversation-imports="/home/bot/.codex-import" --output="$DATA"

cd "$PROJECT"
timeout 240 "$CODEX_BIN" exec --ephemeral --sandbox read-only --model gpt-5.6-sol \
  --output-last-message "$RAW" "$(cat "$PROMPT")" < "$DATA" > "$LOG" 2>&1

"$NODE_BIN" "$PROJECT/backend/scripts/split-daily-diary-output.mjs" \
  "$RAW" "$DIARY" "$HANDOFF" "$MEMORY"

chmod 600 "$DATA" "$RAW" "$DIARY" "$HANDOFF" "$MEMORY" "$LOG"
mv "$DATA" "$OUT_DIR/daily-ledger-$DAY.json"
mv "$RAW" "$OUT_DIR/work-diary-$DAY.raw.md"
mv "$DIARY" "$OUT_DIR/work-diary-$DAY.md"
mv "$HANDOFF" "$OUT_DIR/handoff-delta-$DAY.md"
mv "$MEMORY" "$OUT_DIR/memory-instructions-$DAY.md"
mv "$LOG" "$OUT_DIR/work-diary-$DAY.codex.log"
rmdir "$RUN_DIR"

echo "[$(date -Iseconds)] Codex 外脑手记完成：$OUT_DIR/work-diary-$DAY.md"
