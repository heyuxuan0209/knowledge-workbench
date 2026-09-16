#!/usr/bin/env bash
set -euo pipefail

# active-query 已由常驻 backend 的每日 08:10 sync-all 统一执行。
# 删除旧的独立 02:15 crontab，避免同一条后台链路每天跑两遍。幂等，可重复执行。
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

crontab -l 2>/dev/null | awk '!/scripts\/scheduled-task\.mjs active-query/' > "$tmp_file" || true
crontab "$tmp_file"

echo 'duplicate active-query cron retired'
