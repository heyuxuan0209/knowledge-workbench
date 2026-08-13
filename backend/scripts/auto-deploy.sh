#!/usr/bin/env bash
# KW 自动部署（ADR-085）——VPS 上由 root cron 每天 07:00 调用。
#
# 为什么要它：以前 cron 只 git pull，不重启也不 build，等于"把家具运到楼下就不管了"。
# 后端改动不重启＝跑的还是旧进程；前端改动不 build＝页面还是旧包，而且**两种都不会报错**。
#
# 安全设计（用户选的方案 C：自动部署 + 出事自动回滚 + 飞书通知）：
#   1. 动手前记下当前 commit、备份当前 frontend/dist
#   2. 只在真有新代码时才动；只改了什么就做什么（前端才 build、后端才重启）
#   3. 部署后做健康自检（/health + / + 一个真接口）
#   4. 自检不过 → 自动回滚到上一个可用版本并重启 → 飞书通知"已回滚"
#      最坏结果因此是「停留在旧版本且我主动告诉你」，而不是「半夜挂了没人知道」
#
# 已知局限（诚实写在这里）：自检只能发现"起不来"这类硬故障。代码能跑但功能是坏的
# （按钮点了没反应之类），它检查不出来，坏版本仍会留在线上——只是不会挂。
#
# 手动跑：ssh vultr-paris 'bash /home/bot/projects/knowledge-workbench/backend/scripts/auto-deploy.sh'
set -uo pipefail   # 故意不用 -e：失败要走回滚分支，不能直接退出

REPO="${KW_REPO:-/home/bot/projects/knowledge-workbench}"
SVC_USER="${KW_USER:-bot}"
SERVICE="${KW_SERVICE:-kw-backend}"
LOG="${KW_DEPLOY_LOG:-/home/bot/kw-deploy.log}"
BASE_URL="http://127.0.0.1:3000"

# 自我复制再执行：本脚本自己会被它执行的 git pull 改写，而 bash 是**边读边执行**的，
# 文件中途变了会跳到错误的字节位置。所以先拷到 /tmp 跑副本。（真踩过这类坑的经典处）
if [ "${KW_DEPLOY_REEXEC:-}" != "1" ]; then
  TMP_SELF="/tmp/kw-auto-deploy.$$.sh"
  cp "$0" "$TMP_SELF" || exit 1
  KW_DEPLOY_REEXEC=1 exec bash "$TMP_SELF" "$@"
fi
trap 'rm -f "$0"' EXIT   # 副本用完删掉

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
asbot() { sudo -u "$SVC_USER" -H bash -lc "$1"; }

# ── 飞书通知（复用 backend/.env 里笔记机器人的凭据；缺配置就只写日志，不让通知失败拖垮部署）──
notify() {
  local text="$1" env_file="$REPO/backend/.env"
  local id secret chat
  # 演练标记：做验收时消息和真告警长得一模一样，已经真的骗到人一次（2026-08-13）。
  [ "${KW_DEPLOY_DRILL:-}" = "1" ] && text="【演练 · 不是真事，不用管】
$text"
  id=$(grep -m1 '^FEISHU_BOT_APP_ID=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'')
  secret=$(grep -m1 '^FEISHU_BOT_APP_SECRET=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'')
  chat=$(grep -m1 '^DEPLOY_NOTIFY_CHAT_ID=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'')
  if [ -z "$id" ] || [ -z "$secret" ] || [ -z "$chat" ]; then
    log "（跳过飞书通知：.env 缺 FEISHU_BOT_APP_ID/SECRET 或 DEPLOY_NOTIFY_CHAT_ID）"; return 0
  fi
  local tok
  tok=$(curl -s -m 15 -X POST 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
        -H 'Content-Type: application/json' \
        -d "{\"app_id\":\"$id\",\"app_secret\":\"$secret\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tenant_access_token",""))' 2>/dev/null)
  [ -z "$tok" ] && { log "（飞书鉴权失败，通知未送达）"; return 0; }
  local body
  body=$(python3 -c 'import json,sys;print(json.dumps({"receive_id":sys.argv[1],"msg_type":"text","content":json.dumps({"text":sys.argv[2]},ensure_ascii=False)},ensure_ascii=False))' "$chat" "$text")
  curl -s -m 15 -o /dev/null -X POST 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id' \
    -H 'Content-Type: application/json; charset=utf-8' -H "Authorization: Bearer $tok" -d "$body"
}

# ── 健康自检：三条一起过才算活（首页=前端在、/health=进程在、真接口=后端逻辑通）──
healthy() {
  local i
  for i in $(seq 1 12); do
    if curl -sf -m 8 -o /dev/null "$BASE_URL/health" \
       && curl -sf -m 8 -o /dev/null "$BASE_URL/" \
       && curl -sf -m 15 -o /dev/null "$BASE_URL/api/studio/series-presets"; then
      return 0
    fi
    sleep 3
  done
  return 1
}

log "=== 自动部署开始 ==="

BEFORE=$(asbot "git -C '$REPO' rev-parse HEAD" 2>/dev/null)
[ -z "$BEFORE" ] && { log "拿不到当前 commit，放弃"; exit 1; }

# ⚠️ 这里必须先看 pull 的退出码，不能只比对 HEAD 变没变：
# 拉取失败时 HEAD 同样不变，会被"无新代码"那条分支吃掉，日志写一句风平浪静的
# 「无新代码，什么都不做」然后 exit 0 —— 失败和空跑长得一模一样，翻日志也看不出来。
# 决策 C（2026-08-13）：不给 VPS 推送凭据，那"没驮成"这件事就必须有人被告知。
PULL_OUT=$(asbot "git -C '$REPO' pull --ff-only 2>&1"); PULL_RC=$?
if [ "$PULL_RC" -ne 0 ]; then
  # 分叉还是网络？两者的处理方式完全不同，消息里必须能一眼分开。
  asbot "git -C '$REPO' fetch origin" >> "$LOG" 2>&1
  COUNTS=$(asbot "git -C '$REPO' rev-list --left-right --count HEAD...origin/main" 2>/dev/null)
  AHEAD=$(echo "$COUNTS" | awk '{print $1}'); BEHIND=$(echo "$COUNTS" | awk '{print $2}')
  log "❌ git pull --ff-only 失败（rc=$PULL_RC，本地领先 ${AHEAD:-?} / 落后 ${BEHIND:-?}）：$PULL_OUT"
  if [ -n "${AHEAD:-}" ] && [ "${AHEAD:-0}" -gt 0 ] && [ "${BEHIND:-0}" -gt 0 ]; then
    notify "⚠️ KW 自动部署没跑成：VPS 和 GitHub 分叉了（不是网络问题）。

VPS 上有 $AHEAD 个提交没推出去，GitHub 上有 $BEHIND 个提交没拉进来。
今天的自动部署跳过了，线上还是旧版本。

修法（在 Mac 上跑，保住 VPS 提交的原 SHA）：
git fetch ssh://vultr-paris/home/bot/projects/knowledge-workbench main
git rebase FETCH_HEAD
git push

或者直接跟 Claude 说一句「VPS 又分叉了，驮一趟」。"
  else
    notify "⚠️ KW 自动部署没跑成：拉取失败，但**不是分叉**（本地领先 ${AHEAD:-?} / 落后 ${BEHIND:-?}），
大概率是网络或 GitHub 那头的问题。今天的自动部署跳过了，线上还是旧版本。

git 原话：
$PULL_OUT

明早会自动再试一次。连着两天收到这条，跟 Claude 说「看下 /home/bot/kw-deploy.log」。"
  fi
  exit 1
fi

AFTER=$(asbot "git -C '$REPO' rev-parse HEAD" 2>/dev/null)
if [ "$BEFORE" = "$AFTER" ]; then
  log "无新代码，什么都不做。"; exit 0
fi

CHANGED=$(asbot "git -C '$REPO' diff --name-only $BEFORE $AFTER")
SUBJECTS=$(asbot "git -C '$REPO' log --oneline --no-decorate $BEFORE..$AFTER" | head -5)
N=$(echo "$SUBJECTS" | grep -c . )
log "拉到 $N 个新提交：$(echo "$SUBJECTS" | tr '\n' ' | ')"

# 备份当前可用的前端产物（回滚要用）
asbot "rm -rf '$REPO/frontend/dist.prev'; [ -d '$REPO/frontend/dist' ] && cp -a '$REPO/frontend/dist' '$REPO/frontend/dist.prev' || true"

FAILED=""

# 前端：改了才 build；依赖清单变了才重装（npm ci 慢且吃内存，不无脑跑）
if echo "$CHANGED" | grep -q '^frontend/'; then
  if echo "$CHANGED" | grep -qE '^frontend/package(-lock)?\.json$'; then
    log "前端依赖有变，npm ci…"
    asbot "cd '$REPO/frontend' && npm ci" >> "$LOG" 2>&1 || FAILED="前端 npm ci 失败"
  fi
  if [ -z "$FAILED" ]; then
    log "构建前端…"
    asbot "cd '$REPO/frontend' && npm run build" >> "$LOG" 2>&1 || FAILED="前端构建失败"
  fi
fi

# 后端：改了才重启；依赖清单变了才重装
if [ -z "$FAILED" ] && echo "$CHANGED" | grep -q '^backend/'; then
  if echo "$CHANGED" | grep -qE '^backend/package(-lock)?\.json$'; then
    log "后端依赖有变，npm ci…"
    asbot "cd '$REPO/backend' && npm ci" >> "$LOG" 2>&1 || FAILED="后端 npm ci 失败"
  fi
  if [ -z "$FAILED" ]; then
    log "重启 $SERVICE…"
    systemctl restart "$SERVICE" || FAILED="重启失败"
    RESTARTED=1
  fi
fi

# 自检
if [ -z "$FAILED" ]; then
  if healthy; then
    # 「重启了」≠「新代码在跑」（ADR-101）：08-12 那个孤儿进程霸着 3000，systemctl restart
    # 每次都"成功"、健康检查每次都 200，而端口上跑的是 22 小时前的代码。所以重启过就必须
    # 问一句：现在应答的这个进程，装的是哪个 commit？
    if [ "${RESTARTED:-}" = "1" ]; then
      SERVING=$(curl -sf -m 8 "$BASE_URL/health" 2>/dev/null \
        | python3 -c 'import sys,json;print(json.load(sys.stdin).get("commit") or "")' 2>/dev/null)
      if [ -n "$SERVING" ] && [ "$SERVING" != "$AFTER" ]; then
        # 不走回滚：代码本身没问题，问题是它压根没被加载。回滚只会让人以为是新代码的锅。
        log "❌ 重启没生效：3000 上跑的是 $SERVING，应该是 $AFTER"
        notify "⚠️ KW 部署了新代码，但**重启没生效**——3000 端口上跑的还是旧进程。

应该跑：${AFTER:0:7}
实际跑：${SERVING:0:7}

最常见的原因：有人手动 \`node src/server.js\` 起过一个进程霸着 3000（禁止这么干），
systemd 那个一直 EADDRINUSE 崩溃重启，而网站看着是好的。

修法（VPS 上跑）：
ss -tlnp | grep :3000        # 找出霸端口的 pid
kill <pid>                   # systemd 会在 5 秒内接管
或者跟 Claude 说一句「KW 又是孤儿进程霸端口，清一下」。"
        exit 1
      fi
      [ -z "$SERVING" ] && log "（/health 没返回 commit 字段，跳过重启生效性校验——旧版本后端？）"
    fi
    log "✅ 自检通过，部署完成（$AFTER）"
    notify "✅ KW 已自动部署 $N 个提交
$SUBJECTS

打不开的话双击桌面「KW-知识工作台.command」，它会告诉你卡在哪。"
    asbot "rm -rf '$REPO/frontend/dist.prev'"
    exit 0
  fi
  FAILED="部署后自检不通过（首页/health/接口 有一项打不通）"
fi

# ── 回滚 ────────────────────────────────────────────────
log "❌ $FAILED —— 开始回滚到 $BEFORE"
asbot "git -C '$REPO' reset --hard $BEFORE" >> "$LOG" 2>&1
# ⚠️ 只有确实存在备份时才动 dist——否则"先删后恢复"在没备份的情况下会把前端整个删掉，
# 变成回滚反而把站点搞挂（GET / 直接 404）。宁可留着新 dist，也不能删到没有。
asbot "if [ -d '$REPO/frontend/dist.prev' ]; then rm -rf '$REPO/frontend/dist'; mv '$REPO/frontend/dist.prev' '$REPO/frontend/dist'; fi"
systemctl restart "$SERVICE"
if healthy; then
  log "↩️ 已回滚到上一个可用版本，服务正常"
  notify "⚠️ KW 自动部署失败，已自动回滚，服务正常运行在上一个版本。

失败原因：$FAILED
新代码（未生效）：
$SUBJECTS

不影响你现在使用。方便时跟 Claude 说一句「自动部署失败了，看下 /home/bot/kw-deploy.log」。"
else
  log "🚨 回滚后仍然不健康——需要人工介入"
  notify "🚨 KW 自动部署失败，回滚后服务仍起不来，需要人工处理。

失败原因：$FAILED
现在 KW 打不开。跟 Claude 说：「KW 挂了，自动部署回滚也没救回来，看 /home/bot/kw-deploy.log」"
fi
exit 1
