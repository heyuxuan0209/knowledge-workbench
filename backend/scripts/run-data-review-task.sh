#!/usr/bin/env bash
# 为数据复盘定时任务注入 Codex 通知身份；数据读写仍使用 backend/.env 的原 App。
set -euo pipefail

export HOME="${HOME:-/home/bot}"
CODEX_ENV="${KW_CODEX_BRIDGE_ENV:-$HOME/.codex-im/.env}"
if [[ ! -r "$CODEX_ENV" ]]; then
  echo "缺 Codex 飞书桥配置：$CODEX_ENV" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$CODEX_ENV"
KW_NOTIFY_FEISHU_APP_ID="$FEISHU_APP_ID"
KW_NOTIFY_FEISHU_APP_SECRET="$FEISHU_APP_SECRET"
export KW_NOTIFY_FEISHU_APP_ID KW_NOTIFY_FEISHU_APP_SECRET
unset FEISHU_APP_ID FEISHU_APP_SECRET
set +a

TASK="${1:-}"
shift || true
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

case "$TASK" in
  recall) exec /usr/bin/node scripts/data-recall.mjs "$@" ;;
  backfill) exec /usr/bin/node scripts/backfill-from-exports.mjs "$@" ;;
  audit) exec /usr/bin/node scripts/publish-record-audit.mjs "$@" ;;
  *) echo "用法：$0 {recall|backfill|audit} [参数...]" >&2; exit 2 ;;
esac
