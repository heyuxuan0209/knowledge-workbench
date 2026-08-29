#!/bin/bash
# KW 知识工作台 · 桌面入口（ADR-094 起改为「先隧道后 tailnet」）
#
# 为什么要探测而不是写死一个地址：
#   一键发布走 MultiPost 浏览器扩展，而它的 host_permissions 只放行
#   https://*、http://localhost/*、http://127.0.0.1/*。
#   日常入口 http://kw-vps:3000 是 http + 自定义 hostname，**不在白名单里**——
#   content script 注入不进去，发布按钮点了毫无反应（实测过，而且不报错）。
#   所以优先用走常驻 ssh 隧道的 http://localhost:3000（在白名单里、同一个后端同一份数据）；
#   隧道断了才退回 tailnet 的 kw-vps:3000——那时发布用不了，但至少产品能打开。
#
# 本文件是权威副本，桌面那份是拷贝。改这里，然后重新安装到桌面：
#   cp backend/scripts/KW-知识工作台.command ~/Desktop/ && chmod +x ~/Desktop/KW-知识工作台.command

TUNNEL="http://localhost:3000"
TAILNET="http://kw-vps:3000"

# 探一个真实接口而不是 /——/ 走 express.static 托管的前端，前端没 build 时它也可能有响应，
# 探不出"后端活着"。/api/studio/platforms 是纯后端路由（实测 200）。
#
# --noproxy '*' 不能省：本机 shell 里有 http_proxy=127.0.0.1:7897，而 no_proxy 只放了
# localhost/127.0.0.1。不绕过的话 curl 会把 kw-vps 也送进代理，代理连不上 tailnet 就回 502，
# 于是隧道一断脚本就误报「两条都不通」——实测踩过，tailnet 其实好好的。
probe () { curl -s -o /dev/null -m 3 --noproxy '*' -w '%{http_code}' "$1/api/studio/platforms" 2>/dev/null; }

echo "正在检查 KW 后端…"

CODE=$(probe "$TUNNEL")
if [ "$CODE" = "200" ]; then
  echo "✅ 走本地隧道：${TUNNEL}（一键发布可用）"
  open "$TUNNEL"
  exit 0
fi
echo "· 隧道不通（${TUNNEL} 返回 ${CODE:-无响应}），自动重启…"

# Tailscale 经 DERP 中继偶尔会出现「ssh 进程和本地监听都还在，但转发请求一直挂住」。
# launchd 的 KeepAlive 看不出这种半死状态；桌面入口在真实接口探测失败后主动 kickstart，
# 最多等 10 秒恢复。这样浏览器扩展仍能坚持使用 localhost，不会静默退到不能发布的地址。
TUNNEL_LABEL="gui/$(id -u)/com.knowledge-workbench.tunnel"
if launchctl print "$TUNNEL_LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "$TUNNEL_LABEL" >/dev/null 2>&1
  for _ in 1 2 3 4 5; do
    sleep 2
    CODE=$(probe "$TUNNEL")
    if [ "$CODE" = "200" ]; then
      echo "✅ 隧道已自动恢复：${TUNNEL}（一键发布可用）"
      open "$TUNNEL"
      exit 0
    fi
  done
fi

echo "· 自动恢复失败，改走 tailnet…"

CODE=$(probe "$TAILNET")
if [ "$CODE" = "200" ]; then
  echo "✅ 走 tailnet：$TAILNET"
  echo "⚠️  注意：这个地址下**一键发布用不了**（浏览器扩展只放行 https / localhost / 127.0.0.1）。"
  echo "   要发布的话，先把隧道弄通：launchctl kickstart -k gui/501/com.knowledge-workbench.tunnel"
  open "$TAILNET"
  exit 0
fi

# 两条都不通＝后端真的有问题，把能帮上忙的信息一次给全，别让用户只看到「打不开」
echo ""
echo "❌ 两条路都不通，后端可能挂了。把下面这段念给 Claude："
echo "───────────────────────────────"
echo "隧道 ${TUNNEL} → ${CODE:-无响应}"
echo "tailnet ${TAILNET} → $(probe "$TAILNET" || echo 无响应)"
echo "隧道服务状态：$(launchctl list 2>/dev/null | grep knowledge-workbench.tunnel || echo '未加载')"
echo "Tailscale：$(tailscale status 2>/dev/null | head -1 || echo '未安装或未运行')"
echo "───────────────────────────────"
echo ""
read -p "按回车关闭…"
