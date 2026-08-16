#!/usr/bin/env bash
# Mac 在线时，将今天和昨天的已清洗 Codex 对话增量同步到 VPS 私有目录。
set -euo pipefail

USER_HOME="${HOME:?}"
PROJECT="${KW_PROJECT_ROOT:-$USER_HOME/Documents/项目/knowledge-workbench}"
NODE_BIN="${KW_NODE_BIN:-/opt/homebrew/bin/node}"
SSH_TARGET="${KW_DIARY_SSH_TARGET:-vultr-paris}"
SESSIONS_ROOT="${CODEX_SESSIONS_ROOT:-$USER_HOME/.codex/sessions}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for DAY in "$(TZ=Europe/Paris date +%F)" "$(TZ=Europe/Paris date -v-1d +%F)"; do
  LOCAL_FILE="$TMP_DIR/$DAY.json"
  REMOTE_TMP="/tmp/codex-mac-$DAY-$$.json"
  "$NODE_BIN" "$PROJECT/backend/scripts/export-codex-conversations.mjs" \
    --sessions-root="$SESSIONS_ROOT" --date="$DAY" --output="$LOCAL_FILE"
  /usr/bin/scp -q "$LOCAL_FILE" "$SSH_TARGET:$REMOTE_TMP"
  /usr/bin/ssh "$SSH_TARGET" "install -d -o bot -g bot -m 700 /home/bot/.codex-import/mac && install -o bot -g bot -m 600 '$REMOTE_TMP' '/home/bot/.codex-import/mac/$DAY.json' && rm '$REMOTE_TMP'"
done

/usr/bin/ssh "$SSH_TARGET" "find /home/bot/.codex-import/mac -type f -name '*.json' -mtime +30 -delete"

echo "[$(date -Iseconds)] Mac Codex 对话上下文同步完成"
