---
name: feed-digest
description: 每日增量抓取一批 AI/科技/播客/思考写作类信源的更新文章，标题自动翻译为中文，去重后增量写入单一 digest.md。触发：用户说"抓一下资讯/追更/更新信源/跑一下 feed-digest/今天有什么新的/资讯更新了吗"，或由定时任务到点调用。信源清单与规则在 feeds.json，翻译走 DeepSeek。
---

# feed-digest · 资讯追更

一组零依赖脚本（Node 18+ / 系统 curl）：抓取 `feeds.json` 里 35 个信源的**新**文章 →
标题**翻译为中文** → **去重增量**写入 `data/digest.md`。核心是一条命令，无需 Claude 在场也能靠 crontab 自跑。

## 关键前提

**必须在有外网的机器上运行**（用户本机 / 有网络的环境）。curl 直连各 feed；
国内网络挂代理时，curl 会自动读 `http_proxy/https_proxy`，与本项目其它 sync 脚本一致。
> 无外网的沙箱里跑会 35 源全失败——那是环境问题，不是脚本问题。

## 交互式用法（用户开口"追更/抓资讯"时）

1. 在 skill 目录运行：`node scripts/run.mjs`
2. 读它的日志，给用户一句话摘要：**成功 N 源 / 失败 M 源 / 新增 K 条**，附 `data/digest.md` 路径；
   若有失败源，把失败的源名 + 原因如实列出（不要假装全成功）。
3. 用户想看内容就 `Read data/digest.md` 的最新板块（最新一天在文件顶部）。

只想抓某一个源调试：`node scripts/run.mjs --source hf-papers`
只预览不落盘：`node scripts/run.mjs --dry-run`

## 产物（都在 `data/`）

- `digest.md` —— 唯一的成品文件。按天分板块（最新置顶），板块内按分类分组，
  每条：`[中文标题](链接) — 英文原标题 · 来源（· ▲票数）`。
- `state.json` —— 每源已见条目指纹，**增量去重的记忆**。不要手删（删了下次会把当前 feed 里的条目全当新的重列一遍）。
- `items.jsonl` —— 同样的新条目结构化追加，供 workbench 程序化消费。

## 翻译

`scripts/translate.mjs` 走 DeepSeek（`api.deepseek.com`，`deepseek-chat`，¥1/M）。
key 解析顺序：环境变量 `DEEPSEEK_API_KEY` → 向上层目录找 `backend/.env`（复用本项目已配置的 key）。
**拿不到 key 或调用失败时不会中断**：标题保留英文，日志提示"翻译降级"，成品照常生成。

## 改配置

编辑 `feeds.json`：
- 加源：往 `sources` 加一项（`id/name/name_zh/category/type/urls`）。`type` 取 `rss`（默认）/`json-hf`/`json-hn`/`scrape-pg`。
- 调规则：`rules.minScore`（HF 论文最低票数，默认 20）、`rules.maxNew`（每源每次最多新增，HN=8，其余默认 12）。
- `discover` 填站点主页做 RSS 自动发现兜底（配置的 feed 地址全失效时启用）。

## 定时（每天自动跑）

见 `README.md`。本质是把 `node <skill 目录>/scripts/run.mjs` 挂到用户 Mac 的 crontab，
与本项目 `sync-*.js` 的定时方式一致。首次请先手动跑一次生成初始 `digest.md`。
