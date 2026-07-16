#!/usr/bin/env python3
"""whisperX 转写 + 说话人分离（M5 完整版，2026-07-16 用户拍板）。

访谈/对话类音频（播客为主）用这条管道：转写 → 对齐 → pyannote 说话人分离 →
输出带 SPEAKER 标签的分段 JSON。依赖 HF_TOKEN（pyannote 门禁模型，用户须在
HuggingFace 网页同意条款后创建 read token，配在 backend/.env）。

无 HF_TOKEN 或分离失败时：调用方（asr.js）自动回落到 transcribe.py 普通管道，
不阻塞解读——这是渐进增强，不是硬依赖。

用法: HF_TOKEN=hf_xxx python3 transcribe-diarize.py <audio> [--max-seconds 900]
输出: {language, duration, truncated, speakers: N,
       segments: [{start, speaker, text}], text: "【说话人A】…\n【说话人B】…"}
"""
import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--max-seconds", type=int, default=900)
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small"))
    args = parser.parse_args()

    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        json.dump({"error": "HF_TOKEN 未配置（pyannote 门禁模型需要）"}, sys.stdout, ensure_ascii=False)
        sys.exit(2)

    import warnings
    warnings.filterwarnings("ignore")
    import whisperx

    device = "cpu"
    audio = whisperx.load_audio(args.audio)
    # 截断到 max-seconds（16kHz 采样）
    max_samples = args.max_seconds * 16000
    truncated = len(audio) > max_samples
    duration = round(len(audio) / 16000, 1)
    if truncated:
        audio = audio[:max_samples]

    model = whisperx.load_model(args.model, device, compute_type="int8")
    result = model.transcribe(audio, batch_size=4)
    language = result["language"]

    # 词级对齐（分离标签按词归属更准；对齐模型公开无门禁，中英都有）
    try:
        align_model, align_meta = whisperx.load_align_model(language_code=language, device=device)
        result = whisperx.align(result["segments"], align_model, align_meta, audio, device)
    except Exception as e:
        print(f"[diarize] 对齐跳过: {e}", file=sys.stderr)

    from whisperx.diarize import DiarizationPipeline, assign_word_speakers
    diarizer = DiarizationPipeline(use_auth_token=hf_token, device=device)
    diarization = diarizer(audio)
    result = assign_word_speakers(diarization, result)

    # SPEAKER_00/01 → 说话人A/B；合并相邻同说话人分段，输出可读文本
    def label(sp):
        if not sp or not sp.startswith("SPEAKER_"):
            return "说话人?"
        return "说话人" + chr(ord("A") + int(sp.split("_")[1]))

    merged = []
    for seg in result["segments"]:
        sp = label(seg.get("speaker"))
        text = seg.get("text", "").strip()
        if not text:
            continue
        if merged and merged[-1]["speaker"] == sp:
            merged[-1]["text"] += " " + text
        else:
            merged.append({"start": round(seg.get("start", 0), 1), "speaker": sp, "text": text})

    speakers = sorted({m["speaker"] for m in merged})
    json.dump(
        {
            "language": language,
            "duration": duration,
            "truncated": truncated,
            "speakers": len(speakers),
            "segments": merged,
            "text": "\n".join(f"【{m['speaker']}】{m['text']}" for m in merged),
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
