#!/usr/bin/env bash
# 每日上下文胶囊影子运行：读取完整账本，生成结构化胶囊，不改变正式外脑日记输入。
set -euo pipefail

export HOME="${HOME:-/home/bot}"
PROJECT="${KW_PROJECT_ROOT:-/home/bot/projects/knowledge-workbench}"
OUT_DIR="${KW_DAILY_CAPSULE_SHADOW_DIR:-/home/bot/loops/daily-capsule-shadow}"
DAY="${1:-$(TZ=Europe/Paris date -d yesterday +%F)}"
NODE_BIN="${KW_NODE_BIN:-$(command -v node)}"
CODEX_BIN="${KW_CODEX_BIN:-$(command -v codex)}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

LEDGER="$OUT_DIR/context-capsule-$DAY.ledger.json"
CAPSULE="$OUT_DIR/context-capsule-$DAY.json"
REPORT="$OUT_DIR/context-capsule-$DAY.md"
LOG="$OUT_DIR/context-capsule-$DAY.codex.log"

cd "$PROJECT/backend"
"$NODE_BIN" scripts/daily-diary-data.mjs --date="$DAY" --project="$PROJECT" --minimal-context \
  --conversation-imports="/home/bot/.codex-import" --output="$LEDGER"

cd "$PROJECT"
timeout 240 "$CODEX_BIN" exec --ephemeral --sandbox read-only --model gpt-5.6-sol \
  --output-schema "$PROJECT/backend/scripts/daily-capsule-schema.json" \
  --output-last-message "$CAPSULE" "$(cat "$PROJECT/backend/scripts/daily-capsule-prompt.md")" \
  < "$LEDGER" > "$LOG" 2>&1

"$NODE_BIN" "$PROJECT/backend/scripts/validate-daily-capsule.mjs" "$LEDGER" "$CAPSULE" "$REPORT"
chmod 600 "$LEDGER" "$CAPSULE" "$REPORT" "$LOG"
echo "每日上下文胶囊影子产物：$REPORT"
