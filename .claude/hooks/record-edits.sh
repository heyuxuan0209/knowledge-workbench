#!/bin/bash
# PostToolUse(Write|Edit|NotebookEdit) 记录器：把本会话改过的文件路径记到 /tmp
# 供 Stop 钩子（liuhen-stop-check.sh）判断"改过文件但没留痕"
in=$(cat)
sid=$(echo "$in" | jq -r '.session_id // "unknown"')
fp=$(echo "$in" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -n "$fp" ] && echo "$fp" >> "/tmp/claude-kw-edits-$sid"
exit 0
