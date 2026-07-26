#!/usr/bin/env python3
"""ADR-052 P2 排版校验兜底（产品代码）。

流水线固定顺序：LLM 装配 → fix_quotes.py → validate_gzh_html.py（应 0/0）。
本文件把后两步合成一次调用：读 stdin 的 HTML → 跑 fix_quotes（直引号转全角）→
跑 validate（平台红线 + span leaf + 半角标点）→ 结构化 JSON 回 stdout。

只 import/subprocess 资产脚本（reference/series-template/{fix_quotes.py,vendor/scripts/validate_gzh_html.py}），
不改它们。契约 INTEGRATION-SPEC.md §3.3/§3.4。
"""
import sys, os, json, tempfile, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SERIES = os.path.abspath(os.path.join(HERE, "../../reference/series-template"))
sys.path.insert(0, os.path.join(SERIES, "vendor", "scripts"))
import validate_gzh_html as V  # noqa: E402  资产校验器，只 import


def main():
    html = sys.stdin.read()
    # 1) fix_quotes：写临时文件、原地修、读回（fix_quotes 是文件级 CLI，subprocess 调，不改它）
    tf = tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8")
    tf.write(html)
    tf.close()
    try:
        subprocess.run([sys.executable, os.path.join(SERIES, "fix_quotes.py"), tf.name],
                       capture_output=True, timeout=30)
        fixed = open(tf.name, encoding="utf-8").read()
    finally:
        os.remove(tf.name)
    # 2) validate：确定性红线 + span leaf + 半角标点
    errors, warnings, leaf = V.validate(fixed)
    json.dump({"ok": True, "html": fixed, "errors": errors, "warnings": warnings, "leaf": leaf},
              sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        json.dump({"ok": False, "error": str(e)}, sys.stdout, ensure_ascii=False)
