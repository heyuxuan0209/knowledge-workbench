#!/usr/bin/env bash
# 一键安装:把 claude-workflows/ 下的配置装进本项目 .claude/
# 用法: cd 到项目根目录后执行 bash claude-workflows/install.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$(pwd)/.claude"

echo "安装工作流配置到 $DEST ..."

mkdir -p "$DEST/skills/kickoff-debate" "$DEST/skills/dev-review" "$DEST/agents" "$DEST/hooks"

cp "$SRC/skills/kickoff-debate/SKILL.md" "$DEST/skills/kickoff-debate/SKILL.md"
cp "$SRC/skills/dev-review/SKILL.md"     "$DEST/skills/dev-review/SKILL.md"
cp "$SRC/agents/challenger.md"           "$DEST/agents/challenger.md"
cp "$SRC/agents/reviewer.md"             "$DEST/agents/reviewer.md"
cp "$SRC/hooks/test-gate.sh"             "$DEST/hooks/test-gate.sh"
cp "$SRC/WORKFLOWS-README.md"            "$DEST/WORKFLOWS-README.md"
chmod +x "$DEST/hooks/test-gate.sh"

# settings.json:不存在则直接放入;已存在则提示手动合并,不覆盖
if [ -f "$DEST/settings.json" ]; then
  echo "⚠️  $DEST/settings.json 已存在,未覆盖。"
  echo "   请手动把以下 hooks 配置合并进去(见 $SRC/settings.json):"
  cat "$SRC/settings.json"
else
  cp "$SRC/settings.json" "$DEST/settings.json"
fi

echo ""
echo "✅ 安装完成。重启 Claude Code 会话后生效。"
echo "   用法示例:"
echo "   - 按 kickoff-debate 流程,和我讨论「素材卡片功能」"
echo "   - 按 dev-review 流程,实现 docs/designs/素材卡片.md"
echo ""
echo "   安装无误后可删除本目录: rm -rf $SRC"
