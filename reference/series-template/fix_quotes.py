#!/usr/bin/env python3
"""公众号 HTML 直引号 → 全角弯引号（确定性后处理）。

用途：LLM 装配出的 HTML 里，中文正文常残留半角直引号 " '，会被合规校验
报 WARNING。本脚本自动把"含中文的文本节点"里的直引号转成全角弯引号，
不碰标签、属性、纯英文节点——是装配与校验之间的一道确定性兜底，agent 只需调用。

流水线位置：  LLM 装配  →  fix_quotes.py  →  validate_gzh_html.py（应 0/0）

用法：
    python3 fix_quotes.py <file.html>       # 原地修改
    python3 fix_quotes.py <file.html> --check  # 只报会改几处、不写盘

规则：
- 只处理标签之间的文本（正则 >([^<]*)<），不触碰 <...> 内的属性（style="…"、leaf="…" 等）。
- 只在含 CJK 的文本段里转换（纯英文段如 "Don't just write code" 原样保留）。
- 双引号按出现顺序交替 “ ”；单引号交替 ‘ ’。同一文本段内引号成对，交替即正确配对。
"""
import re
import sys

CJK = re.compile(r"[一-鿿㐀-䶿]")


def _convert(text):
    out, dq, sq = [], 0, 0
    for ch in text:
        if ch == '"':
            out.append("“" if dq % 2 == 0 else "”")
            dq += 1
        elif ch == "'":
            out.append("‘" if sq % 2 == 0 else "’")
            sq += 1
        else:
            out.append(ch)
    return "".join(out)


def fix(html):
    """返回 (新 html, 改动的文本段数)。"""
    count = [0]

    def repl(m):
        seg = m.group(1)
        if CJK.search(seg) and ('"' in seg or "'" in seg):
            count[0] += 1
            return ">" + _convert(seg) + "<"
        return m.group(0)

    new = re.sub(r">([^<]*)<", repl, html)
    return new, count[0]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    check = "--check" in sys.argv
    if not args:
        print("用法: python3 fix_quotes.py <file.html> [--check]", file=sys.stderr)
        sys.exit(2)
    path = args[0]
    html = open(path, encoding="utf-8").read()
    new, n = fix(html)
    if check:
        print(f"{path}: 将转换 {n} 处含中文的文本段")
        return
    if n:
        open(path, "w", encoding="utf-8").write(new)
    print(f"✓ {path}: 转换 {n} 处直引号 → 全角弯引号")


if __name__ == "__main__":
    main()
