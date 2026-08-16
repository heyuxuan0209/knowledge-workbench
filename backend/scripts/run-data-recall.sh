#!/usr/bin/env bash
# 用 Codex 飞书 App 身份运行确定性数据催收；只借 App 凭据发消息，不调用任何模型。
set -euo pipefail

export HOME="${HOME:-/home/bot}"
CODEX_ENV="${KW_CODEX_BRIDGE_ENV:-$HOME/.codex-im/.env}"
if [[ ! -r "$CODEX_ENV" ]]; then
  echo "缺 Codex 飞书桥配置：$CODEX_ENV" >&2
  exit 1
fi

# 单独映射 Codex App 的通知凭据；查 bitable 仍使用 backend/.env 的主应用权限。
set -a
# shellcheck disable=SC1090
source "$CODEX_ENV"
KW_NOTIFY_FEISHU_APP_ID="$FEISHU_APP_ID"
KW_NOTIFY_FEISHU_APP_SECRET="$FEISHU_APP_SECRET"
export KW_NOTIFY_FEISHU_APP_ID KW_NOTIFY_FEISHU_APP_SECRET
unset FEISHU_APP_ID FEISHU_APP_SECRET
set +a

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
exec /usr/bin/node scripts/data-recall.mjs "$@"
