#!/usr/bin/env python3
"""AI 观察手记 · 系列头图生成引擎。

设计原则：骨架固定（opt1 内刊报头，系列共识特色）+ 配色皮肤可换 + 内容参数化。
将来接入创作台时：STYLES 作为风格预设、content dict 由创作台填充，调用 render() 即出 PNG。

用法：
    python3 render_cover.py            # 渲染内置样例（4 皮肤 + 1 泛化 demo）
    # 或在代码里： render(STYLES["moyu-green"], content, "out.png")

依赖：playwright（已装）。输出 900×383 @2x = 1800×766，公众号标准头图。
"""
from playwright.sync_api import sync_playwright
import os

SERIF = "'Songti SC','STSong','Noto Serif SC',serif"
SANS = "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"

# ── 配色皮肤（共识骨架不变，仅换这层 token）───────────────────────────
STYLES = {
    "moyu-green": {  # 摸鱼绿 · 轻快犀利
        "bg": "linear-gradient(135deg,#F0FDF4 0%,#ffffff 60%,#ECFDF5 100%)",
        "ink": "#111827", "name_ink": "#111827", "sub": "#374151",
        "accent": "#059669", "accent_text": "#ffffff", "uline": "#A7F3D0",
        "rule": "3px double #059669", "title_font": SERIF,
        "foot_border": "#BBF7D0", "tag_bg": "#059669", "tag_text": "#ffffff",
    },
    "olive-journal": {  # 橄榄手记 · 沉稳深度
        "bg": "#fdfdf8",
        "ink": "#23251d", "name_ink": "#1e1f23", "sub": "#4d4f46",
        "accent": "#ed7b2f", "accent_text": "#ffffff", "uline": "#f6c9a0",
        "rule": "3px double #1e1f23", "title_font": SERIF,
        "foot_border": "#bfc1b7", "tag_bg": "#1e1f23", "tag_text": "#ffffff",
    },
    "graphite": {  # 石墨冷静 · 理性克制
        "bg": "linear-gradient(135deg,#FAFAFA,#ffffff)",
        "ink": "#18181B", "name_ink": "#18181B", "sub": "#52525B",
        "accent": "#52525B", "accent_text": "#ffffff", "uline": "#D4D4D8",
        "rule": "2px solid #18181B", "title_font": SANS,
        "foot_border": "#E4E4E7", "tag_bg": "#18181B", "tag_text": "#ffffff",
    },
    "red-white": {  # 红白力量 · 观点鲜明
        "bg": "#ffffff",
        "ink": "#1C1917", "name_ink": "#1C1917", "sub": "#374151",
        "accent": "#DC2626", "accent_text": "#ffffff", "uline": "#FECACA",
        "rule": "3px double #DC2626", "title_font": SERIF,
        "foot_border": "#FEE2E2", "tag_bg": "#DC2626", "tag_text": "#ffffff",
    },
}

# ── 骨架模板 A：2.35:1 消息列表大图（900×383）─────────────────────────
TEMPLATE_WIDE = """<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:900px;height:383px}
.cover{width:900px;height:383px;overflow:hidden;background:__BG__;
  font-family:__SANS__;padding:34px 54px 30px;display:flex;flex-direction:column;position:relative}
.mono{font-family:'SF Mono',Consolas,Menlo,monospace}
.mh{display:flex;justify-content:space-between;align-items:flex-end;
  border-bottom:__RULE__;padding-bottom:12px}
.name{font-size:32px;font-weight:900;color:__NAME_INK__;letter-spacing:4px;font-family:__TITLE_FONT__}
.name .en{font-size:13px;font-weight:700;color:__ACCENT__;letter-spacing:5px;margin-left:10px;font-family:Georgia,serif}
.mh-r{font-size:13px;color:__SUB__;letter-spacing:1.5px;text-align:right;line-height:1.5}
.body{flex:1;display:flex;flex-direction:column;justify-content:center;padding:4px 0}
.kicker{font-size:14px;color:__ACCENT__;font-weight:700;letter-spacing:1px;margin-bottom:12px;
  display:flex;align-items:center;gap:10px}
.badge{background:__ACCENT__;color:__ACCENT_TEXT__;font-size:12px;font-weight:700;
  padding:3px 11px;border-radius:999px;letter-spacing:1px}
h1{font-size:44px;line-height:1.3;font-weight:900;color:__INK__;letter-spacing:.5px;font-family:__TITLE_FONT__}
.ul{border-bottom:6px solid __ULINE__;padding-bottom:2px}
.foot{display:flex;justify-content:space-between;align-items:center;
  border-top:1px solid __FOOT_BORDER__;padding-top:12px}
.src{font-size:14px;color:__SUB__;letter-spacing:.3px}
.src b{color:__ACCENT__;font-weight:700}
.tag{font-size:12px;color:__TAG_TEXT__;background:__TAG_BG__;padding:4px 12px;border-radius:5px;letter-spacing:1px}
</style></head><body>
<div class="cover">
  <div class="mh">
    <div class="name">__NAME__<span class="en">JOURNAL</span></div>
    <div class="mh-r">__ISSUE_EVENT__</div>
  </div>
  <div class="body">
    <div class="kicker"><span class="badge">__BADGE__</span>__KICKER__</div>
    <h1>__TITLE_HTML__</h1>
  </div>
  <div class="foot">
    <div class="src">__AUTHOR_HTML__</div>
    <div class="tag">__TAG__</div>
  </div>
</div>
</body></html>"""

# ── 骨架模板 B：1:1 转发卡片/主页方图（1000×1000，全居中重排，非裁切）──────
# 下段详规（用户 2026-07-27）：全部居中；双线左右留白；大标题放大拆两行；标题下浅橙下划线；
# 底部居中署名；**不放右下角标签**；所有元素落在方版安全区内。
TEMPLATE_SQUARE = """<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1000px;height:1000px}
.cover{width:1000px;height:1000px;overflow:hidden;background:__BG__;
  font-family:__SANS__;padding:70px 64px;display:flex;flex-direction:column;position:relative;text-align:center}
.mono{font-family:'SF Mono',Consolas,Menlo,monospace}
.mh{border-bottom:__RULE__;padding-bottom:20px;margin:0 44px}
.name{font-size:48px;font-weight:900;color:__NAME_INK__;letter-spacing:5px;font-family:__TITLE_FONT__}
.name .en{font-size:16px;font-weight:700;color:__ACCENT__;letter-spacing:6px;margin-left:12px;font-family:Georgia,serif}
.mh-r{font-size:17px;color:__SUB__;letter-spacing:1.5px;line-height:1.6;margin-top:12px}
.body{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:8px 0}
.kicker{font-size:20px;color:__ACCENT__;font-weight:700;letter-spacing:1px;margin-bottom:30px;
  display:flex;align-items:center;justify-content:center;gap:14px}
.badge{background:__ACCENT__;color:__ACCENT_TEXT__;font-size:16px;font-weight:700;
  padding:5px 16px;border-radius:999px;letter-spacing:1px}
h1{font-size:118px;line-height:1.28;font-weight:900;color:__INK__;letter-spacing:1px;font-family:__TITLE_FONT__}
.ul{border-bottom:10px solid __ULINE__;padding-bottom:3px}
.foot{border-top:1px solid __FOOT_BORDER__;padding-top:22px;
  display:flex;justify-content:center;align-items:center;margin:0 44px}
.src{font-size:19px;color:__SUB__;letter-spacing:.3px}
.src b{color:__ACCENT__;font-weight:700}
</style></head><body>
<div class="cover">
  <div class="mh">
    <div class="name">__NAME__<span class="en">JOURNAL</span></div>
    <div class="mh-r">__ISSUE_EVENT__</div>
  </div>
  <div class="body">
    <div class="kicker"><span class="badge">__BADGE__</span>__KICKER__</div>
    <h1>__TITLE_HTML__</h1>
  </div>
  <div class="foot">
    <div class="src">__AUTHOR_HTML__</div>
  </div>
</div>
</body></html>"""

SHAPES = {"wide": (TEMPLATE_WIDE, 900, 383), "square": (TEMPLATE_SQUARE, 1000, 1000)}


def build_html(template, style, content):
    html = template.replace("__SANS__", SANS)
    for k, v in style.items():
        html = html.replace(f"__{k.upper()}__", v)
    # 来源徽章可选：badge 留空则整枚移除（kicker 只剩副标）
    if not content.get("badge"):
        html = html.replace('<span class="badge">__BADGE__</span>', '')
    for k, v in content.items():
        html = html.replace(f"__{k.upper()}__", v)
    return html


def render(style, content, out_png, previews_dir, shape="wide"):
    template, w, h = SHAPES[shape]
    os.makedirs(previews_dir, exist_ok=True)
    html_path = os.path.join(previews_dir, "_tmp_cover.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(build_html(template, style, content))
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
        pg.goto(f"file://{html_path}")
        pg.wait_for_timeout(300)
        pg.screenshot(path=out_png, clip={"x": 0, "y": 0, "width": w, "height": h})
        b.close()
    os.remove(html_path)
    print("✓", out_png)


# ── 内置样例 ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    covers = os.path.join(here, "covers")

    claire = {
        "name": "AI 观察手记", "issue_event": "NO.01 · 视频演讲精读<br>Compile 26 · Cursor 社区",
        "badge": "", "kicker": "AI 时代产品人的新工作说明书",
        "title_html": '当<span class="ul">“造东西”</span>不再稀缺，<br>产品人还剩下什么？',
        "author_html": 'Claire Vo　<b>ChatPRD 创始人</b> · 二十年产品与创业老兵',
        "tag": "深度精读",
    }
    # 系列启用的两套皮肤（去来源徽章）；graphite/red-white 留在 STYLES 里作备选
    ACTIVE = ["moyu-green", "olive-journal"]
    for key in ACTIVE:
        for shape in ("wide", "square"):
            render(STYLES[key], claire,
                   os.path.join(covers, f"style-{key}-{shape}.png"), covers, shape)
