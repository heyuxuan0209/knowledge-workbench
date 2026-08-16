#!/bin/zsh
# KW 改代码 —— 双击就能开始跟官方订阅 Codex 说需求（2026-08-16 切换）
#
# 它只做一件事：帮你 cd 到项目目录、把 Codex 起起来。
# 以前你得「开终端 → cd 一长串路径 → 敲 codex」，这三步现在是双击一下。
#
# 想同时干几件不相干的事？双击几次，开几个窗口，各聊各的（互不干扰）。
# 改完代码要上线：直接跟 Codex 说「部署一下」。

PROJ="/Users/heyuxuan/Documents/项目/knowledge-workbench"
cd "$PROJ" || { echo "找不到项目目录：$PROJ"; read -r "?回车退出…"; exit 1; }

echo "📁 $PROJ"
echo "💡 直接说你要改什么就行。改完让它「部署一下」，线上立刻生效。"
echo

exec /Users/heyuxuan/.npm-global/bin/codex
