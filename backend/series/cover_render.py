#!/usr/bin/env python3
"""ADR-052 P1 头图渲染 wrapper（产品代码，非资产）。

薄封装：把 reference/series-template 挂上 sys.path、import 头图引擎 render_cover（资产层，只读不改），
读 stdin 的 {skin, content} → 一个 Playwright 会话内渲染 wide+square 两张 PNG → base64 回 stdout。

契约：INTEGRATION-SPEC.md §2。引擎皮肤/模板/字体栈全在 render_cover.py（资产），本文件不复制、不改。
用法：echo '{"skin":"moyu-green","content":{...}}' | python3 cover_render.py
"""
import sys, os, json, base64, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SERIES = os.path.abspath(os.path.join(HERE, "../../reference/series-template"))
sys.path.insert(0, SERIES)
import render_cover as rc  # noqa: E402  资产层引擎，只 import

# 头图 7 字段兜底（缺字段填空串，避免 __TOKEN__ 漏进图；badge 空=引擎整枚移除）
FIELDS = ["name", "issue_event", "badge", "kicker", "title_html", "author_html", "tag"]


def main():
    req = json.load(sys.stdin)
    skin = req.get("skin")
    if skin not in rc.STYLES:
        raise ValueError(f"未知头图皮肤「{skin}」（可用：{'/'.join(rc.STYLES)}）")
    style = rc.STYLES[skin]
    content = {k: str((req.get("content") or {}).get(k, "") or "") for k in FIELDS}

    from playwright.sync_api import sync_playwright
    out = {}
    with tempfile.TemporaryDirectory() as td:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for shape in ("wide", "square"):
                template, w, h = rc.SHAPES[shape]
                html = rc.build_html(template, style, content)
                html_path = os.path.join(td, f"{shape}.html")
                with open(html_path, "w", encoding="utf-8") as f:
                    f.write(html)
                pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
                pg.goto(f"file://{html_path}")
                pg.wait_for_timeout(300)
                png_path = os.path.join(td, f"{shape}.png")
                pg.screenshot(path=png_path, clip={"x": 0, "y": 0, "width": w, "height": h})
                pg.close()
                with open(png_path, "rb") as f:
                    out[shape] = {
                        "base64": "data:image/png;base64," + base64.b64encode(f.read()).decode(),
                        "w": w * 2, "h": h * 2,
                    }
            b.close()
    json.dump({"ok": True, "skin": skin, "shapes": out}, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001  子进程边界，错误以 JSON 回传给 Node
        json.dump({"ok": False, "error": str(e)}, sys.stdout)
