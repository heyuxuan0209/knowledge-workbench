# 调研备忘：管道扩展选型（入口 ASR + 出口成片/发布）

**日期**: 2026-07-15
**来源**: `reference/link2article/`（链接→中文结构化文章 skill）+ `reference/ai-shortvideo-toolkit.pdf`（AI 短视频工具全景精选），两份材料已随仓库归档
**性质**: 调研结论，非决策。落地时按条目升格为 ADR 写入 DECISIONS.md。

---

## 一、对 workbench 的定位判断

- **link2article** = 强化版"② 理解"入口（多渠道→文字），单次转化、无沉淀无飞轮 → 吸收进产品，不替代产品
- **shortvideo-toolkit** = "⑤ 创作后半段（成片）→ ⑥ 发布 → 复盘"的工具地图 → workbench 终点仍是"带观点的可发布稿件"，成片/发布留给外部工具与未来插件层

## 二、近期可落（小改）

| 条目 | 落点 | 做法 |
|------|------|------|
| Jina Reader 兜底 | content-ingestion.js | readability 失败（SPA/反爬/公众号单篇）→ 重试 `https://r.jina.ai/<url>`，只读合规 |
| 结构化解读模板升级 | ephemeral chat prompt / 解读产物 | 吸收 link2article 模板：TL;DR / 核心观点 / 金句（带时间戳）/ **可复用素材（选题角度·数据案例·争议钩子）** / **局限与存疑**（契合诚实原则）；同时收掉 M2 遗留的"结构化解读升级" |

## 三、按里程碑归档的选型基线

### M3 后（skills 管道 / active-query 执行器）
- **Agent-Reach**（本地 cookie、零 API 费，X/Reddit/YouTube/GitHub/B站/小红书）——active-query 主候选，顺带补中文渠道
- OpenBiliClaw（跨平台主动内容发现 Agent）——可选的"发现"补充

### M4（创作台完整版）
- **Humanizer-zh 思路内置**：口播稿/thread 生成后固定过一道"去 AI 味"（按钮或后处理），不依赖外部 skill
- huashu-skills（花叔 11 技能）——脚本/大纲 prompt 可参考，选题引擎我们已有

### M5（ASR / 多渠道音视频）
- **架构基线 = link2article 两步走**：确定性脚本（渠道分流：YouTube 无字幕→ASR、小宇宙音频直链、抖音 yt-dlp+去水印兜底、音频直链、本地文件）→ LLM 翻译+结构化
- **引擎升级 = whisperX**（词级时间戳 + 说话人分离，优于 faster-whisper；金句可标时间点、访谈可分说话人）
- 落法：link2article.py 作为 backend 转写子进程（child_process），material 产物进现有翻译+解读管道，落 contents 不落散文件
- 过渡期：link2article 装入 `~/.claude/skills/` 手动跑，产出文字稿粘贴进万能收口

### M6+（发布 Agent / 复盘回流，未排期）
- 发布：**AiToEarn**（22k★，唯一原生覆盖抖音+小红书+B站+X+YouTube）主候选；TurboPush MCP（Claude 原生可编程）辅；Postiz 管海外（不支持中国平台）
- **复盘回流（飞轮最后一环）**：借 douyin-creator-tools 思路——发布数据/未回复评论回流为选题信号（评论区争议点=下一个选题）
- TTS/成片（豆包/CosyVoice2/whisperX+MoneyPrinterTurbo/NarratoAI/HyperFrames）：视频生产环节，不进产品本体，留给外部工具/插件

## 四、合规红线（印证既有决策）

- 抖音/小红书用户协议禁自动化爬取；商用采集他人数据可能触《数据安全法》《个保法》→ ADR-007 不逆向抓取维持正确
- 小红书自动发布风控最激进 → 未来发布 Agent 走官方 API / 半自动 + 人工审核
- 同素材同时段机器群发最危险 → 一稿多平台要差异化、低频
- 第三方 skill 安装前过 skill-vetter 体检（用户 Claude 环境建议，非产品代码）
