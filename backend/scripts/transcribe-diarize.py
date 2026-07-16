#!/usr/bin/env python3
"""转写 + 说话人分离（M5 完整版，2026-07-16）。

技术路线（有意不走 whisperX 包装层——其 3.8 与 pyannote 3.3 API 互不兼容，实测两头堵）：
  faster-whisper 转写（带段级时间戳，与主管道同引擎） +
  pyannote/speaker-diarization-3.1 分离（内存 waveform 直喂，绕开其文件解码依赖） +
  按时间重叠把说话人归属到每个转写分段。

依赖 HF_TOKEN（pyannote 门禁模型，backend/.env）。无 token 时 exit 2，
调用方（asr.js）回落普通转写管道。

用法: HF_TOKEN=hf_xxx python3 transcribe-diarize.py <audio> [--max-seconds 900]
输出: {language, duration, truncated, speakers: N,
       segments: [{start, speaker, text}], text: "【说话人A】…"}
"""
import argparse
import json
import os
import sys


def load_audio_pyav(path, sr=16000):
    """PyAV 解码任意音频 → 16kHz 单声道 float32 numpy（免 ffmpeg/torchcodec）"""
    import av
    import numpy as np

    container = av.open(path)
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format="s16", layout="mono", rate=sr)
    chunks = []
    for frame in container.decode(stream):
        for rf in resampler.resample(frame):
            chunks.append(rf.to_ndarray().reshape(-1))
    container.close()
    if not chunks:
        raise RuntimeError("音频解码为空")
    pcm = np.concatenate(chunks).astype(np.float32) / 32768.0
    return pcm


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

    # 库会往 stdout 打印进度，污染 JSON 输出——工作期间指到 stderr，收尾换回
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    import warnings
    warnings.filterwarnings("ignore")

    # pyannote 3.x checkpoint 含 omegaconf 对象，torch>=2.6 的 weights_only=True
    # 会拒绝加载。只加载 HF 官方 pyannote 仓库权重（可信来源），本进程内放宽；
    # lightning 内部显式传 True，必须强制覆盖而非 setdefault
    import torch
    _orig_load = torch.load
    def _trusting_load(*a, **k):
        k["weights_only"] = False
        return _orig_load(*a, **k)
    torch.load = _trusting_load

    import numpy as np
    from faster_whisper import WhisperModel
    from pyannote.audio import Pipeline

    sr = 16000
    audio = load_audio_pyav(args.audio, sr)
    duration = round(len(audio) / sr, 1)
    truncated = duration > args.max_seconds
    if truncated:
        audio = audio[: args.max_seconds * sr]

    # ① 转写（与 transcribe.py 同引擎同参数）
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments_iter, info = model.transcribe(
        audio,
        vad_filter=True,
        initial_prompt="以下是简体中文普通话的内容，使用规范的标点符号。",
    )
    tsegs = [
        {"start": float(s.start), "end": float(s.end), "text": s.text.strip()}
        for s in segments_iter if s.text.strip()
    ]

    # ② 分离（内存 waveform 直喂）
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=hf_token)
    waveform = torch.from_numpy(audio[None, :])
    annotation = pipeline({"waveform": waveform, "sample_rate": sr})
    turns = [(t.start, t.end, spk) for t, _, spk in annotation.itertracks(yield_label=True)]

    # ③ 归属：每个转写分段取时间重叠最长的说话人
    def speaker_for(seg):
        best, best_overlap = None, 0.0
        for ts, te, spk in turns:
            ov = min(seg["end"], te) - max(seg["start"], ts)
            if ov > best_overlap:
                best, best_overlap = spk, ov
        return best

    def label(spk):
        if not spk or not spk.startswith("SPEAKER_"):
            return "说话人?"
        return "说话人" + chr(ord("A") + int(spk.split("_")[1]))

    merged = []
    for seg in tsegs:
        sp = label(speaker_for(seg))
        if merged and merged[-1]["speaker"] == sp:
            merged[-1]["text"] += " " + seg["text"]
        else:
            merged.append({"start": round(seg["start"], 1), "speaker": sp, "text": seg["text"]})

    speakers = sorted({m["speaker"] for m in merged})
    sys.stdout = real_stdout
    json.dump(
        {
            "language": info.language,
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
