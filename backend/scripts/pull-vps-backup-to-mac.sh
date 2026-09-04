#!/bin/bash
set -euo pipefail

# 将 VPS 已完成完整性校验的最新 SQLite 备份拉到 Mac，形成异机副本。
# 本脚本不接触生产数据库，只读取 /home/bot/backups/knowledge-workbench。

PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
REMOTE_HOST="${KW_BACKUP_SSH_HOST:-vultr-lax}"
REMOTE_DIR="/home/bot/backups/knowledge-workbench"
LOCAL_DIR="${KW_MAC_BACKUP_DIR:-$HOME/Backups/knowledge-workbench}"
RETAIN="${KW_MAC_BACKUP_RETAIN:-30}"
PART=""

notify_failure() {
  local rc=$?
  [ -n "$PART" ] && /bin/rm -f -- "$PART"
  /usr/bin/osascript -e 'display notification "异机数据库备份失败，请让 Codex 检查日志" with title "Knowledge Workbench"' >/dev/null 2>&1 || true
  exit "$rc"
}
trap notify_failure ERR

case "$RETAIN" in
  ''|*[!0-9]*) echo "KW_MAC_BACKUP_RETAIN 必须是正整数" >&2; exit 2 ;;
esac
[ "$RETAIN" -ge 1 ] || { echo "KW_MAC_BACKUP_RETAIN 必须至少为 1" >&2; exit 2; }

/bin/mkdir -p "$LOCAL_DIR"
/bin/chmod 700 "$LOCAL_DIR"

LATEST=$(/usr/bin/ssh -o BatchMode=yes "$REMOTE_HOST" \
  "find '$REMOTE_DIR' -maxdepth 1 -type f -name 'app-*.db' -printf '%f\\n' | sort | tail -1")

case "$LATEST" in
  app-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*.db) ;;
  *) echo "VPS 没有找到合法的数据库备份文件：$LATEST" >&2; exit 1 ;;
esac

DEST="$LOCAL_DIR/$LATEST"
PART="$DEST.part"

if [ ! -f "$DEST" ]; then
  /usr/bin/scp -q "$REMOTE_HOST:$REMOTE_DIR/$LATEST" "$PART"
  [ "$(/usr/bin/sqlite3 "$PART" 'PRAGMA integrity_check;')" = "ok" ]

  REMOTE_SHA=$(/usr/bin/ssh -o BatchMode=yes "$REMOTE_HOST" "sha256sum '$REMOTE_DIR/$LATEST' | cut -d' ' -f1")
  LOCAL_SHA=$(/usr/bin/shasum -a 256 "$PART" | /usr/bin/cut -d' ' -f1)
  [ "$REMOTE_SHA" = "$LOCAL_SHA" ]

  # 冷备份不参与任何服务运行，落盘后设为只读，降低被误改的风险。
  /bin/chmod 400 "$PART"
  /bin/mv "$PART" "$DEST"
  PART=""
fi

[ "$(/usr/bin/sqlite3 "$DEST" 'PRAGMA integrity_check;')" = "ok" ]

files=("$LOCAL_DIR"/app-*.db)
if [ -e "${files[0]}" ]; then
  while [ "${#files[@]}" -gt "$RETAIN" ]; do
    /bin/rm -f -- "${files[0]}"
    files=("${files[@]:1}")
  done
fi

echo "$(/bin/date '+%Y-%m-%dT%H:%M:%S%z') ok file=$DEST retained=${#files[@]}"
