#!/usr/bin/env bash
# 头图/排版渲染环境 provisioning（ADR-080）——在 Linux 服务器上以 root 执行，幂等可重跑。
#
# 为什么需要它：后端迁到 VPS 后（ADR-074），backend/series/cover_render.py 是在 Linux 上跑的，
# 而它依赖 playwright + Pillow + Chromium，且模板里写的是 macOS 字体名（Songti SC / PingFang SC）。
# 缺 python 包 → 报 ModuleNotFoundError；缺中文字体 → 接口 200 但出图全是豆腐块（"成功的失败"）。
# 服务器重建后跑这一个脚本即可恢复，不要再靠人肉记忆。
# 不含：swap（内存紧的机器另外手动加，见 ADR-080——Chromium 峰值 ~300MB，可用内存 <1G 时建议 +2G swap）。
#
#   ssh <server> 'bash -s' < backend/scripts/provision-render-env.sh
#
set -euo pipefail

REPO="${KW_REPO:-/home/bot/projects/knowledge-workbench}"
SVC_USER="${KW_USER:-bot}"
SERVICE="${KW_SERVICE:-kw-backend}"

[[ $EUID -eq 0 ]] || { echo "需要 root（要 apt 装字体和 Chromium 运行库）"; exit 1; }
[[ -d "$REPO" ]] || { echo "找不到仓库 $REPO（可用 KW_REPO= 覆盖）"; exit 1; }

echo "==> 1/5 apt：中文字体 + fontconfig + venv"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y fonts-noto-cjk fontconfig python3-venv

echo "==> 2/5 fontconfig 别名：macOS 字体名 → Noto CJK（资产模板不改，平台差异由系统层吸收）"
cat > /etc/fonts/local.conf <<'FONTCONF'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<!-- knowledge-workbench 头图渲染（ADR-080）：把模板里的 macOS 中文字体名映射到服务器上的 Noto CJK，
     这样 reference/series-template 的资产模板不用改也能在 Linux 上出正确中文。 -->
<fontconfig>
  <match target="pattern">
    <test name="family"><string>Songti SC</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Noto Serif CJK SC</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>STSong</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Noto Serif CJK SC</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>Noto Serif SC</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Noto Serif CJK SC</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>PingFang SC</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Noto Sans CJK SC</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>Microsoft YaHei</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Noto Sans CJK SC</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>Noto Sans SC</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Noto Sans CJK SC</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>serif</string></test>
    <edit name="family" mode="append" binding="weak"><string>Noto Serif CJK SC</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>sans-serif</string></test>
    <edit name="family" mode="append" binding="weak"><string>Noto Sans CJK SC</string></edit>
  </match>
</fontconfig>
FONTCONF
fc-cache -f >/dev/null
fc-match "Songti SC" | grep -q "Noto Serif CJK" || { echo "字体别名没生效"; exit 1; }

echo "==> 3/5 venv：playwright + Pillow（Python 3.12+ 是 PEP 668 托管，不能装系统级）"
sudo -u "$SVC_USER" -H bash -lc "cd '$REPO' && { [ -x .venv/bin/python ] || python3 -m venv .venv; } && .venv/bin/pip -q install --upgrade pip && .venv/bin/pip -q install playwright pillow"

echo "==> 4/5 Chromium（运行库以 root 装，浏览器本体装到服务账号的 ~/.cache）"
"$REPO/.venv/bin/python" -m playwright install-deps chromium
sudo -u "$SVC_USER" -H bash -lc "'$REPO/.venv/bin/python' -m playwright install chromium"

echo "==> 5/5 systemd：把 .venv/bin 顶到 PATH 最前（cover.js/typeset.js spawn 的是裸 python3，代码不改）"
mkdir -p "/etc/systemd/system/${SERVICE}.service.d"
cat > "/etc/systemd/system/${SERVICE}.service.d/python.conf" <<EOF
[Service]
# 头图/排版校验会 spawn 裸 python3（backend/src/services/cover.js、typeset.js）。
# 系统 python3 是 PEP 668 托管装不了 playwright/Pillow，所以把仓内 .venv 顶到 PATH 最前（ADR-080）。
Environment=PATH=$REPO/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=VIRTUAL_ENV=$REPO/.venv
EOF
systemctl daemon-reload
systemctl restart "$SERVICE"

echo
echo "==> 自检：真出一张图（只看 HTTP 码不够——字体缺失时接口照样 ok、图全是豆腐块，务必肉眼看图）"
SELFTEST=$(mktemp)
sudo -u "$SVC_USER" -H bash -lc "echo '{\"skin\":\"olive-journal\",\"content\":{\"name\":\"AI 踩坑手记\",\"title_html\":\"中文渲染自检\",\"tag\":\"自检\"}}' | '$REPO/.venv/bin/python' '$REPO/backend/series/cover_render.py'" > "$SELFTEST"
head -c 80 "$SELFTEST"; echo
grep -q '"ok": true' "$SELFTEST" || { echo "❌ 出图失败，见上方输出"; rm -f "$SELFTEST"; exit 1; }
rm -f "$SELFTEST"
echo "✅ 完成。建议再把 combined 的 base64 拉回本地解成 PNG 用眼睛确认没有方框。"
