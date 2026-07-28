#!/bin/bash
# Stop 钩子：留痕自查提醒（每会话最多一次）
# 触发条件：本会话改过文件（record-edits.sh 有记录）且没动过 DECISIONS.md / process-log.md
# 行为：注入一次自查提醒给 agent（不是给用户）；agent 自判"值得记→按格式记 / 不值得→声明无需留痕"
in=$(cat)
sid=$(echo "$in" | jq -r '.session_id // "unknown"')
edits="/tmp/claude-kw-edits-$sid"
mark="/tmp/claude-kw-reminded-$sid"

# 本会话没改过任何文件（纯问答/纯阅读）→ 不提醒
[ -s "$edits" ] || exit 0
# 本会话已提醒过一次 → 不再唠叨
[ -f "$mark" ] && exit 0
# 本会话已经动过留痕文件 → 说明留痕发生了，不提醒
grep -qE 'DECISIONS\.md|process-log\.md' "$edits" && exit 0

touch "$mark"
cat <<'EOF'
{"decision":"block","reason":"【留痕自查·本会话仅此一次提醒】结束前自查：本轮是否发生了【决策＝做了取舍、有被放弃的备选方案】或【踩坑＝改了主意/付出了代价/发现反直觉的事】？\n- 有决策 → docs/DECISIONS.md 末尾追加 ADR：查末尾最新号+1；只记取舍/思考逻辑/踩坑，不记改动清单；只用 Edit 追加，禁止整体重写。\n- 有踩坑 → docs/process-log.md：Edit 锚定标题行插入其下，带会话标记（如 [feed]），带数字和真实情绪，填「能长出的选题」栏。\n- 都没有 → 直接结束。『本轮无需留痕』是完全合法的答案，禁止为了通过本检查硬凑条目。\n最后在收尾汇报里加一行：『本轮留痕：ADR-xxx / process-log x 条 / 无』。"}
EOF
