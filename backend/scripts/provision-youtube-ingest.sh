#!/usr/bin/env bash
# YouTube 即时分析的生产依赖（幂等）：
# - yt-dlp：字幕/音频获取，同时作为 Homebrew/system yt-dlp 损坏时的 python -m 备份
# - faster-whisper：Groq 不可用、超文件上限或限流时的本地 CPU 兜底
#
# 用法：
#   ssh vultr-lax 'sudo -u bot -H bash -s' < backend/scripts/provision-youtube-ingest.sh
set -euo pipefail

PROJECT_DIR="${KW_PROJECT_DIR:-/home/bot/projects/knowledge-workbench}"
BACKEND_DIR="$PROJECT_DIR/backend"
VENV_DIR="$BACKEND_DIR/.venv-asr"

test -d "$BACKEND_DIR" || { echo "backend 目录不存在：$BACKEND_DIR" >&2; exit 1; }
command -v python3 >/dev/null || { echo "缺少 python3" >&2; exit 1; }
command -v ffmpeg >/dev/null || {
  echo "缺少 ffmpeg：无法只截取长视频前 40 分钟。请先用 root 运行：apt-get update && apt-get install -y ffmpeg" >&2
  exit 1
}

if [ ! -x "$VENV_DIR/bin/python3" ]; then
  python3 -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python3" -m pip install --disable-pip-version-check --upgrade pip
"$VENV_DIR/bin/python3" -m pip install --disable-pip-version-check --upgrade yt-dlp faster-whisper

# 预热 small 模型（约 460MB），避免 Groq 真故障时才临时下载。
"$VENV_DIR/bin/python3" - <<'PY'
from faster_whisper import WhisperModel
WhisperModel("small", device="cpu", compute_type="int8")
print("faster-whisper small model ready")
PY

"$VENV_DIR/bin/python3" -m yt_dlp --version
"$VENV_DIR/bin/python3" -c 'import faster_whisper; print("faster_whisper import ok")'

echo "YouTube ingest runtime ready: $VENV_DIR"
