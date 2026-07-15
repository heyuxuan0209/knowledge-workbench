# link2article

丢一个链接进来 → 自动抓取/转写 → 由 Claude 翻译并总结成**中文结构化文章**。

支持:YouTube · 小宇宙播客 · 抖音 · 博客/任意网页 · 音频直链 · 本地音视频文件

## 架构(两步走)

```
链接 ──▶ scripts/link2article.py(确定性部分,脚本干)
           ├─ YouTube   → 优先抓官方/自动字幕(免转写);无字幕→下载音频→whisper
           ├─ 小宇宙     → 解析页面音频直链→whisper(自动带上官方 shownotes)
           ├─ 抖音       → yt-dlp 尝试;失败则提示先用去水印工具拿文件再 --file
           ├─ 音频直链   → 下载→whisper
           └─ 其他网页   → trafilatura 提正文(不用转写)
                 │
                 ▼
        output/<标题>.material.md(元数据+原文/转写稿+SRT字幕)
                 │
                 ▼
        Claude 读 SKILL.md 模板(智能部分,Claude 干)
           └─ 外语→地道中文改写;总结成固定模板的结构化文章
                 ▼
        output/<标题>.article.md
```

设计要点:**转写≠翻译**。Whisper 只能"外语→英文",到不了中文,所以外语内容一律两段式:ASR 出原文 → Claude 翻成中文。翻译和总结不用任何额外 API key,Claude 本体就是引擎。

## 安装

```bash
pip install faster-whisper trafilatura yt-dlp --break-system-packages
# 需要 ffmpeg(macOS: brew install ffmpeg / Ubuntu: apt install ffmpeg)
```

## 用法

```bash
# 网页/博客
python3 scripts/link2article.py "https://example.com/post"

# YouTube(优先抓字幕,速度快;无字幕才转写)
python3 scripts/link2article.py "https://www.youtube.com/watch?v=..."

# 小宇宙单集
python3 scripts/link2article.py "https://www.xiaoyuzhoufm.com/episode/..."

# 抖音(反爬多变,失败就先用去水印工具拿文件)
python3 scripts/link2article.py "https://v.douyin.com/..."

# 本地音视频文件(万能兜底)
python3 scripts/link2article.py --file ./视频.mp4

# 参数
--whisper-model small   # tiny/base/small/medium/large-v3,默认 base;越大越准越慢
--no-asr                # 只取字幕/正文,不做语音转写
```

跑完后,把生成的 `output/*.material.md` 丢给 Claude(装了本 SKILL 的话直接说"总结这个素材"),即得结构化文章。

## 装进 Claude Code / Cowork

把整个 `link2article/` 目录放到你的 skills 目录(如 `~/.claude/skills/link2article/`),
Claude 会按 SKILL.md 自动完成"跑脚本 → 翻译 → 按模板出文章"的全流程。

## 已知限制与提示

- **抖音**:无官方接口,yt-dlp 支持时好时坏。稳妥路径:douyin-mcp-server 或
  Douyin_TikTok_Download_API 拿无水印文件 → `--file` 喂入。
- **公众号**:单篇链接直接当"网页"处理即可;反爬硬站可在 URL 前加 `https://r.jina.ai/` 用 Jina Reader。
- **首次转写**会从 HuggingFace 下载 whisper 模型(base 约 145MB)。
- **合规**:下载/转写他人内容仅限个人学习研究,勿公开转载或商用;避免登录态批量抓取。
