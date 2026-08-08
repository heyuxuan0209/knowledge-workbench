#!/usr/bin/env python3
"""
html-ppt · 溢出探针
    python3 measure.py <file.html>   →  stdout 打印 JSON: [{"i":0,"overflowPx":-258}, ...]

为什么用 Python 而不是 Node：VPS 上装的是 **Python playwright**（仓内 .venv，供
backend/series/cover_render.py 出头图，见 backend/scripts/provision-render-env.sh 和 ADR-080）。
Node 版 playwright 只存在于 Mac 的 backend/node_modules（给 platform-export 用登录态）。
跟着仓里 cover.js / typeset.js「spawn 裸 python3，靠 systemd 把 .venv 顶到 PATH 最前」的既有做法走，
才是真的零新增依赖。
"""
import json
import sys

from playwright.sync_api import sync_playwright

# 逐页显示后量所有内容元素的最低点，和 slide 底边比。
# 不能用 scrollHeight/clientHeight —— 实测过 flex 容器会自己撑高，检测返回 false（静默失败）。
MEASURE = """() => {
  const stage = document.getElementById('stage');
  const k = 1920 / stage.getBoundingClientRect().width;
  const out = [];
  document.querySelectorAll('.slide').forEach((s, i) => {
    const wasOn = s.classList.contains('on');
    s.classList.add('on');
    const sr = s.getBoundingClientRect();
    let bottom = sr.top;
    s.querySelectorAll('table, .topic, .quote, h1, h2, p, .label, .linefull').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.height > 0) bottom = Math.max(bottom, r.bottom);
    });
    if (!wasOn) s.classList.remove('on');
    out.push({ i, overflowPx: Math.round((bottom - sr.bottom) * k) });
  });
  return out;
}"""


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: measure.py <file.html>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1600, "height": 900})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("file://" + path, wait_until="domcontentloaded")
        # 等中文字体到位——字体没加载完量出来的高度是假的
        page.wait_for_timeout(2500)
        try:
            page.wait_for_function("document.fonts.status === 'loaded'", timeout=8000)
        except Exception:
            print("[html-ppt] 字体未在 8s 内就绪，按当前状态测量", file=sys.stderr)
        result = page.evaluate(MEASURE)
        browser.close()
    if errors:
        print(json.dumps({"error": errors[0]}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
