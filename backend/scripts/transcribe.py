#!/usr/bin/env python3
"""本地 ASR 转写（M5 最小版前移，ADR-015）。

faster-whisper（CTranslate2 int8，CPU 可用）把音频转成带时间戳的文本，
输出 JSON 到 stdout，供 Node 侧 asr.js 以子进程消费。
- 模型默认 small（~460MB，首次运行自动下载到 ~/.cache/huggingface）；
  中文质量不满意可用 WHISPER_MODEL=medium 覆盖（~1.5GB，速度约慢 2-3 倍）
- --max-seconds 截断：长视频只转前 N 秒（与解读管道 20k 字符截断同理，
  前段足够支撑解读，成本可控）
- 依赖 PyAV 解码，m4a/webm/mp3 直接喂，无需 ffmpeg

用法: python3 transcribe.py <audio_file> [--max-seconds 1800]
"""
import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", help="音频文件路径（m4a/webm/mp3/wav）")
    parser.add_argument("--max-seconds", type=int, default=1800)
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small"))
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        args.audio,
        vad_filter=True,  # 跳过静音段，B站片头/BGM 场景显著提速
        # 引导中文输出简体（whisper 对中文默认时常吐繁体）+ 标点（否则大段无标点难读）；
        # 对英文音频无副作用
        initial_prompt="以下是简体中文普通话的内容，使用规范的标点符号。",
    )

    texts = []
    seg_list = []
    for seg in segments:
        if seg.start > args.max_seconds:
            break
        texts.append(seg.text.strip())
        seg_list.append({"start": round(seg.start, 1), "text": seg.text.strip()})

    json.dump(
        {
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 1),
            "truncated": info.duration > args.max_seconds,
            "text": " ".join(texts),
            "segments": seg_list,
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
