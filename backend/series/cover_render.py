#!/usr/bin/env python3
"""ADR-052 P1 头图渲染 wrapper（产品代码，非资产）。

薄封装：把 reference/series-template 挂上 sys.path、import 头图引擎 render_cover（资产层，只读不改），
读 stdin 的 {skin, content} → 一个 Playwright 会话渲染 wide + square 两段 →
**Pillow 合成为一张竖版母图 1800×1986**（上段 1800×766 公众号封面裁剪用 + 60px 间隔 +
下段 1160×1160 转发方图裁剪用，居中，四周/间隔露出 #EBE8E1 以便看清边界）→ base64 回 stdout。
同时保留上/下段单图，前端可各自下载。

契约：INTEGRATION-SPEC.md §2。引擎皮肤/模板/字体栈全在 render_cover.py（资产），本文件不复制、不改。
用法：echo '{"skin":"olive-journal","content":{...}}' | python3 cover_render.py
"""
import sys, os, json, base64, io, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SERIES = os.path.abspath(os.path.join(HERE, "../../reference/series-template"))
sys.path.insert(0, SERIES)
import render_cover as rc  # noqa: E402  资产层引擎，只 import

FIELDS = ["name", "issue_event", "badge", "kicker", "title_html", "author_html", "tag"]
CANVAS_BG = (235, 232, 225)   # #EBE8E1 稍深灰米，衬出方版边界
GAP = 60                      # 上下段间隔
SQ = 1160                     # 下段方图边长（转发卡片安全区）


def _b64(png_bytes):
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode()


def main():
    req = json.load(sys.stdin)
    skin = req.get("skin")
    if skin not in rc.STYLES:
        raise ValueError(f"未知头图皮肤「{skin}」（可用：{'/'.join(rc.STYLES)}）")
    style = rc.STYLES[skin]
    content = {k: str((req.get("content") or {}).get(k, "") or "") for k in FIELDS}

    from playwright.sync_api import sync_playwright
    from PIL import Image

    with tempfile.TemporaryDirectory() as td:
        with sync_playwright() as p:
            b = p.chromium.launch()

            def shot(shape):
                template, w, h = rc.SHAPES[shape]
                html = rc.build_html(template, style, content)
                hp = os.path.join(td, f"{shape}.html")
                with open(hp, "w", encoding="utf-8") as f:
                    f.write(html)
                pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
                pg.goto(f"file://{hp}")
                pg.wait_for_timeout(300)
                buf = pg.screenshot(clip={"x": 0, "y": 0, "width": w, "height": h})
                pg.close()
                return buf

            wide_png = shot("wide")      # 1800×766
            square_png = shot("square")  # 2000×2000
            b.close()

    # 合成母图：画布 1800×(766+60+1160)=1986，上段满宽、下段 1160 居中
    wide_img = Image.open(io.BytesIO(wide_png)).convert("RGB")            # 1800×766
    square_img = Image.open(io.BytesIO(square_png)).convert("RGB").resize((SQ, SQ), Image.LANCZOS)
    W, top_h = wide_img.width, wide_img.height                            # 1800, 766
    H = top_h + GAP + SQ                                                  # 1986
    canvas = Image.new("RGB", (W, H), CANVAS_BG)
    canvas.paste(wide_img, (0, 0))
    canvas.paste(square_img, ((W - SQ) // 2, top_h + GAP))                # x=320, y=826
    out = io.BytesIO()
    canvas.save(out, "PNG")
    combined_png = out.getvalue()

    json.dump({"ok": True, "skin": skin, "shapes": {
        "combined": {"base64": _b64(combined_png), "w": W, "h": H},
        "wide": {"base64": _b64(wide_png), "w": 1800, "h": 766},
        "square": {"base64": _b64(square_png), "w": 2000, "h": 2000},
    }}, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001  子进程边界，错误以 JSON 回传给 Node
        json.dump({"ok": False, "error": str(e)}, sys.stdout)
