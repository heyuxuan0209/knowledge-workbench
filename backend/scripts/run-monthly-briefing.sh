#!/usr/bin/env bash
# 每月正式任务：取上一个完整自然月 → Codex 只读分析 → 幂等建档 → Codex 身份通知。
set -euo pipefail

export HOME="${HOME:-/home/bot}"
PROJECT="${KW_PROJECT_ROOT:-/home/bot/projects/knowledge-workbench}"
OUT_DIR="${KW_MONTHLY_OUT_DIR:-/home/bot/loops/monthly-briefing}"
NODE_BIN="${KW_NODE_BIN:-$(command -v node)}"
CODEX_BIN="${KW_CODEX_BIN:-$(command -v codex)}"
MONTH="${1:-$($NODE_BIN -e "const d=new Date(); const p=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)); console.log(p.toISOString().slice(0,7))")}" 
CODEX_ENV="${KW_CODEX_BRIDGE_ENV:-$HOME/.codex-im/.env}"

if [[ ! -r "$CODEX_ENV" ]]; then
  echo "缺 Codex 飞书桥配置：$CODEX_ENV" >&2
  exit 1
fi
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

DATA="$OUT_DIR/content-briefing-$MONTH.data.json"
REPORT="$OUT_DIR/content-briefing-$MONTH.md"
LOG="$OUT_DIR/content-briefing-$MONTH.codex.log"
PROMPT="$PROJECT/backend/scripts/monthly-briefing-prompt.md"

cd "$PROJECT/backend"
"$NODE_BIN" scripts/monthly-briefing-data.mjs --month="$MONTH" --output="$DATA"

cd "$PROJECT"
"$CODEX_BIN" exec --ephemeral --sandbox read-only --model gpt-5.6-sol \
  --output-last-message "$REPORT" "$(cat "$PROMPT")" < "$DATA" > "$LOG" 2>&1

set -a
# shellcheck disable=SC1090
source "$CODEX_ENV"
KW_NOTIFY_FEISHU_APP_ID="$FEISHU_APP_ID"
KW_NOTIFY_FEISHU_APP_SECRET="$FEISHU_APP_SECRET"
export KW_NOTIFY_FEISHU_APP_ID KW_NOTIFY_FEISHU_APP_SECRET
unset FEISHU_APP_ID FEISHU_APP_SECRET
set +a

cd "$PROJECT/backend"
"$NODE_BIN" scripts/monthly-briefing-publish.mjs --month="$MONTH" --report="$REPORT"
chmod 600 "$DATA" "$REPORT" "$LOG"
