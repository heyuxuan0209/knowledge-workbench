#!/usr/bin/env bash
# 测试门(Stop hook):agent 每次想收工时强制执行。
# 失败时 exit 2 —— Claude Code 会阻止收工,并把 stderr 反馈给 agent 继续修。
# 通过时 exit 0 —— 正常收工。

set -u

# ── 防死循环:如果本次 stop 已经是 hook 触发的续跑,直接放行 ──
INPUT="$(cat 2>/dev/null || true)"
if printf '%s' "$INPUT" | grep -q '"stop_hook_active":[[:space:]]*true'; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
FAILED=""

run_if_has_test_script() {
  local dir="$1"
  local label="$2"
  [ -f "$dir/package.json" ] || return 0
  # 有真实的 test script 才跑(排除 npm init 的默认占位)
  if grep -q '"test"' "$dir/package.json" && \
     ! grep -q 'Error: no test specified' "$dir/package.json"; then
    echo "── 测试门: 运行 $label 测试 ──" >&2
    if ! (cd "$dir" && npm test --silent 2>&1 | tail -30 >&2); then
      FAILED="$FAILED $label"
    fi
  fi
}

run_if_has_test_script "$PROJECT_DIR/backend"  "backend"
run_if_has_test_script "$PROJECT_DIR/frontend" "frontend"
run_if_has_test_script "$PROJECT_DIR"          "root"

if [ -n "$FAILED" ]; then
  echo "" >&2
  echo "❌ 测试门未通过:$FAILED 测试失败。按 dev-review 流程,测试全绿前不许收工。请修复后再完成。" >&2
  exit 2
fi

exit 0
