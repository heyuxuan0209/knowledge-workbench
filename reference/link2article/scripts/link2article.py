#!/usr/bin/env python3
"""
link2article — 丢一个链接进来,产出"可供 LLM 总结的中文素材文件"。

支持来源(按域名自动分流):
  - YouTube        → 优先抓官方/自动字幕(免转写);无字幕则下载音频交给 ASR
  - 小宇宙          → 解析页面拿音频直链,下载后交给 ASR(部分节目有官方 shownotes 一并带上)
  - 抖音            → 尝试 yt-dlp 解析;失败则提示用去水印工具先拿到音频/视频文件再喂 --file
  - 播客 RSS/音频直链 → 下载音频交给 ASR
  - 博客/任意网页    → trafilatura 提取正文(不需要转写)

输出:output/<slug>.material.md
  一个自包含的素材文件:元数据 + 原文/转写稿(+时间戳字幕)。
  之后由 Claude 按 SKILL.md 的模板翻译成中文并总结为结构化文章。

用法:
  python3 link2article.py <url>
  python3 link2article.py <url> --whisper-model small   # ASR 模型(默认 base)
  python3 link2article.py --file /path/to/audio.mp3     # 直接转写本地音/视频文件
  python3 link2article.py <url> --no-asr                # 只取字幕/正文,拿不到就停,不跑 ASR
"""

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

BASE = Path(__file__).resolve().parent.parent
OUT = BASE / "output"
TMP = BASE / ".tmp"


# ---------------------------------------------------------------- utilities

def slugify(text: str, maxlen: int = 60) -> str:
    text = unicodedata.normalize("NFKC", text or "untitled")
    text = re.sub(r"[^\w一-鿿-]+", "-", text).strip("-")
    return (text[:maxlen] or "untitled").rstrip("-")


def run(cmd: list, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def write_material(kind: str, url: str, title: str, meta: dict,
                   body: str, transcript_srt: str | None = None,
                   language_hint: str = "unknown") -> Path:
    OUT.mkdir(exist_ok=True)
    slug = slugify(title)
    path = OUT / f"{slug}.material.md"
    lines = [
        "---",
        f"source_type: {kind}",
        f"source_url: {url}",
        f"title: {json.dumps(title, ensure_ascii=False)}",
        f"language_hint: {language_hint}",
        f"fetched_at: {datetime.now(timezone.utc).isoformat()}",
    ]
    for k, v in meta.items():
        if v:
            lines.append(f"{k}: {json.dumps(str(v), ensure_ascii=False)}")
    lines += ["---", "", "# 原始素材(未加工)", "", body.strip(), ""]
    if transcript_srt:
        lines += ["", "# 带时间戳字幕(SRT)", "", "```srt", transcript_srt.strip(), "```", ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


# ---------------------------------------------------------------- router

def route(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if any(h in host for h in ("youtube.com", "youtu.be")):
        return "youtube"
    if "xiaoyuzhoufm.com" in host or "xiaoyuzhou.fm" in host:
        return "xiaoyuzhou"
    if "douyin.com" in host or "iesdouyin.com" in host:
        return "douyin"
    if re.search(r"\.(mp3|m4a|wav|aac|ogg|flac)(\?|$)", url, re.I):
        return "audio"
    return "web"


# ---------------------------------------------------------------- handlers

def handle_web(url: str) -> Path:
    import trafilatura
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        sys.exit(f"[web] 抓取失败: {url}\n提示: 反爬硬站可改用 Jina Reader: https://r.jina.ai/{url}")
    text = trafilatura.extract(downloaded, include_comments=False,
                               include_tables=True, favor_recall=True)
    meta_obj = trafilatura.extract_metadata(downloaded)
    title = (meta_obj.title if meta_obj else None) or url
    if not text:
        sys.exit("[web] 正文提取为空,可能是 JS 渲染页,试试 Jina Reader / Firecrawl")
    zh = len(re.findall(r"[一-鿿]", text))
    lang = "zh" if zh > max(40, len(text) * 0.05) else "non-zh(需翻译)"
    meta = {"author": getattr(meta_obj, "author", None),
            "date": getattr(meta_obj, "date", None),
            "sitename": getattr(meta_obj, "sitename", None)}
    return write_material("web_article", url, title, meta, text, language_hint=lang)


def ytdlp_json(url: str) -> dict:
    p = run(["yt-dlp", "--dump-json", "--no-download", url])
    if p.returncode != 0:
        sys.exit(f"[yt-dlp] 解析失败:\n{p.stderr[-800:]}")
    return json.loads(p.stdout.splitlines()[-1])


def vtt_to_text_and_srt(vtt_path: Path) -> tuple[str, str]:
    """粗转:VTT → 纯文本 + 简化SRT(去重叠行)。"""
    raw = vtt_path.read_text(encoding="utf-8", errors="ignore")
    blocks, seen, srt_lines, idx = [], set(), [], 1
    ts = None
    for line in raw.splitlines():
        m = re.match(r"(\d\d:\d\d:\d\d\.\d\d\d) --> (\d\d:\d\d:\d\d\.\d\d\d)", line)
        if m:
            ts = (m.group(1).replace(".", ","), m.group(2).replace(".", ","))
            continue
        line_clean = re.sub(r"<[^>]+>", "", line).strip()
        if not line_clean or line_clean.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            continue
        if line_clean in seen:
            continue
        seen.add(line_clean)
        blocks.append(line_clean)
        if ts:
            srt_lines += [str(idx), f"{ts[0]} --> {ts[1]}", line_clean, ""]
            idx += 1
            ts = None
    return "\n".join(blocks), "\n".join(srt_lines)


def handle_youtube(url: str, no_asr: bool, model: str) -> Path:
    info = ytdlp_json(url)
    title = info.get("title", url)
    meta = {"channel": info.get("channel"), "upload_date": info.get("upload_date"),
            "duration_s": info.get("duration")}
    lang = info.get("language") or "unknown"
    TMP.mkdir(exist_ok=True)
    # 1) 先试字幕(人工字幕优先,再自动字幕;中文优先,再原语种/英文)
    prefs = ["zh-Hans", "zh-CN", "zh", "zh-Hant", lang, "en"]
    sub_langs = ",".join(dict.fromkeys([l for l in prefs if l and l != "unknown"]))
    p = run(["yt-dlp", "--skip-download", "--write-subs", "--write-auto-subs",
             "--sub-langs", sub_langs, "--sub-format", "vtt",
             "-o", str(TMP / "yt_sub.%(ext)s"), url])
    vtts = sorted(TMP.glob("yt_sub*.vtt"))
    if vtts:
        text, srt = vtt_to_text_and_srt(vtts[0])
        for f in vtts:
            f.unlink()
        used = vtts[0].name.split(".")[-2]
        hint = "zh" if used.startswith("zh") else f"{used}(需翻译)"
        if len(text) > 50:
            return write_material("youtube", url, title, meta, text, srt, hint)
    # 2) 无字幕 → 下载音频跑 ASR
    if no_asr:
        sys.exit("[youtube] 没有可用字幕,且 --no-asr 已指定,停止")
    audio = TMP / "yt_audio.m4a"
    p = run(["yt-dlp", "-f", "bestaudio[ext=m4a]/bestaudio", "-o", str(audio), url])
    if p.returncode != 0 or not audio.exists():
        sys.exit(f"[youtube] 音频下载失败:\n{p.stderr[-500:]}")
    text, srt, lang_detected = asr_transcribe(audio, model)
    audio.unlink(missing_ok=True)
    hint = "zh" if lang_detected.startswith("zh") else f"{lang_detected}(需翻译)"
    return write_material("youtube", url, title, meta, text, srt, hint)


def handle_xiaoyuzhou(url: str, no_asr: bool, model: str) -> Path:
    """解析小宇宙单集页:__NEXT_DATA__ / og:audio 里有音频直链和 shownotes。"""
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")

    title_m = re.search(r'<meta property="og:title" content="([^"]+)"', html)
    audio_m = re.search(r'<meta property="og:audio" content="([^"]+)"', html)
    title = title_m.group(1) if title_m else url
    audio_url = audio_m.group(1) if audio_m else None
    shownotes = ""
    nd = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if nd:
        try:
            data = json.loads(nd.group(1))
            ep = data["props"]["pageProps"]["episode"]
            audio_url = audio_url or ep.get("enclosure", {}).get("url") or ep.get("media", {}).get("source", {}).get("url")
            shownotes = re.sub(r"<[^>]+>", "\n", ep.get("shownotes", "") or "")
            shownotes = re.sub(r"\n{3,}", "\n\n", shownotes).strip()
            title = ep.get("title", title)
        except Exception:
            pass
    if not audio_url:
        sys.exit("[xiaoyuzhou] 未能解析出音频直链,页面结构可能已变——可用 xyz-dl 下载后 --file 喂入")
    if no_asr:
        body = f"(仅 shownotes,未转写)\n\n{shownotes or '无 shownotes'}\n\n音频直链: {audio_url}"
        return write_material("xiaoyuzhou_podcast", url, title, {}, body, language_hint="zh")
    TMP.mkdir(exist_ok=True)
    audio = TMP / "xyz_audio.m4a"
    print(f"[xiaoyuzhou] 下载音频: {audio_url[:80]}...")
    urllib.request.urlretrieve(audio_url, audio)
    text, srt, lang_detected = asr_transcribe(audio, model)
    audio.unlink(missing_ok=True)
    body = (f"## Shownotes(官方)\n\n{shownotes}\n\n## 转写稿\n\n{text}") if shownotes else text
    return write_material("xiaoyuzhou_podcast", url, title, {}, body, srt, "zh")


def handle_douyin(url: str, no_asr: bool, model: str) -> Path:
    """先试 yt-dlp;抖音反爬多变,失败就引导走本地文件路径。"""
    TMP.mkdir(exist_ok=True)
    audio = TMP / "dy_audio.mp3"
    p = run(["yt-dlp", "-x", "--audio-format", "mp3", "-o", str(audio.with_suffix(".%(ext)s")), url])
    got = list(TMP.glob("dy_audio.mp3"))
    if p.returncode != 0 or not got:
        sys.exit("[douyin] yt-dlp 解析失败(抖音反爬常态)。\n"
                 "替代路径: 用 douyin-mcp-server / Douyin_TikTok_Download_API 拿到无水印视频或音频文件,\n"
                 "然后: python3 link2article.py --file <文件路径>")
    info_title = "douyin-video"
    text, srt, lang_detected = asr_transcribe(got[0], model)
    got[0].unlink(missing_ok=True)
    return write_material("douyin", url, info_title, {}, text, srt, "zh")


def handle_audio_url(url: str, model: str) -> Path:
    import urllib.request
    TMP.mkdir(exist_ok=True)
    audio = TMP / ("dl_audio" + Path(urlparse(url).path).suffix)
    urllib.request.urlretrieve(url, audio)
    text, srt, lang_detected = asr_transcribe(audio, model)
    audio.unlink(missing_ok=True)
    hint = "zh" if lang_detected.startswith("zh") else f"{lang_detected}(需翻译)"
    return write_material("audio", url, Path(urlparse(url).path).stem, {}, text, srt, hint)


def handle_file(path: str, model: str) -> Path:
    f = Path(path)
    if not f.exists():
        sys.exit(f"文件不存在: {path}")
    text, srt, lang_detected = asr_transcribe(f, model)
    hint = "zh" if lang_detected.startswith("zh") else f"{lang_detected}(需翻译)"
    return write_material("local_file", str(f), f.stem, {}, text, srt, hint)


# ---------------------------------------------------------------- ASR

def asr_transcribe(audio_path: Path, model_size: str) -> tuple[str, str, str]:
    """faster-whisper 转写 → (纯文本, SRT, 检测语言)。首次运行会自动下载模型。"""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("缺少 faster-whisper: pip install faster-whisper --break-system-packages")
    print(f"[asr] 加载 whisper 模型 {model_size}(首次运行需下载)…")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(audio_path), vad_filter=True)
    texts, srt_lines = [], []
    for i, seg in enumerate(segments, 1):
        def fmt(t):
            h, rem = divmod(int(t), 3600)
            m, s = divmod(rem, 60)
            return f"{h:02d}:{m:02d}:{s:02d},{int((t % 1) * 1000):03d}"
        texts.append(seg.text.strip())
        srt_lines += [str(i), f"{fmt(seg.start)} --> {fmt(seg.end)}", seg.text.strip(), ""]
        if i % 20 == 0:
            print(f"[asr] …已转写 {i} 段")
    return " ".join(texts), "\n".join(srt_lines), info.language or "unknown"


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="link → 素材文件(转写/正文提取)")
    ap.add_argument("url", nargs="?", help="来源链接")
    ap.add_argument("--file", help="直接转写本地音/视频文件")
    ap.add_argument("--whisper-model", default="base",
                    help="faster-whisper 模型: tiny/base/small/medium/large-v3 (默认 base)")
    ap.add_argument("--no-asr", action="store_true", help="只取字幕/正文,不跑语音转写")
    args = ap.parse_args()

    if args.file:
        out = handle_file(args.file, args.whisper_model)
    elif args.url:
        kind = route(args.url)
        print(f"[route] {kind}")
        if kind == "web":
            out = handle_web(args.url)
        elif kind == "youtube":
            out = handle_youtube(args.url, args.no_asr, args.whisper_model)
        elif kind == "xiaoyuzhou":
            out = handle_xiaoyuzhou(args.url, args.no_asr, args.whisper_model)
        elif kind == "douyin":
            out = handle_douyin(args.url, args.no_asr, args.whisper_model)
        else:
            out = handle_audio_url(args.url, args.whisper_model)
    else:
        ap.error("需要 url 或 --file")

    print(f"\n✅ 素材已生成: {out}")
    print("下一步: 让 Claude 按 SKILL.md 的模板把该素材翻译/总结成结构化文章")


if __name__ == "__main__":
    main()
