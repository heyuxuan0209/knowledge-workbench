# feed-digest · 资讯追更 skill

每天增量抓取一批 AI / 科技 / 播客 / 思考写作类信源的更新文章，**标题自动翻译为中文**，
去重后增量写入单一文件 `data/digest.md`。零 npm 依赖（Node 18+ + 系统 curl），
翻译走 DeepSeek（复用 `backend/.env` 里的 `DEEPSEEK_API_KEY`）。

## 目录

```
feed-digest/
├── SKILL.md              # Claude 触发入口
├── feeds.json            # 信源清单 + 规则（改这里加源/调阈值）
├── README.md
├── scripts/
│   ├── run.mjs           # ★ 自主入口：抓取→翻译→写 digest→推进 state
│   ├── fetch-feeds.mjs   # 抓取 + 解析 + 增量去重（可单独调试）
│   ├── translate.mjs     # DeepSeek 批量翻译标题（可单独调试）
│   └── write-digest.mjs  # 渲染 Markdown + 追加 JSONL
└── data/                 # 首次运行自动生成
    ├── digest.md         # 成品：按天分板块，最新置顶
    ├── state.json        # 去重指纹（勿手删）
    ├── items.jsonl       # 结构化条目，供程序消费
    └── cron.log          # 定时运行日志
```

## 首次运行（生成初始 digest）

```bash
cd "/Users/heyuxuan/Documents/项目/knowledge-workbench/.claude/skills/feed-digest"
node scripts/run.mjs
```

首次会一次性拉每源最新若干条（每源 ≤12，Hacker News ≤8，HF 论文只收 ≥20 票），属正常。
之后每次只增量补新条目。国内网络访问 Substack / Google 系需要代理时，
`run.mjs` 前加环境变量即可（curl 会自动读取）：

```bash
HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 node scripts/run.mjs
```

## 每天定时（二选一）

先查 node 绝对路径（cron/launchd 的 PATH 很干净，必须写全路径）：

```bash
which node        # 例如 /opt/homebrew/bin/node（Apple 芯片）或 /usr/local/bin/node（Intel）
```

### 方案 A：launchd（macOS 原生，推荐，更稳）

把下面存成 `~/Library/LaunchAgents/com.kwb.feed-digest.plist`，
将 `/opt/homebrew/bin/node` 换成上一步查到的路径，代理按需增删 `EnvironmentVariables`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.kwb.feed-digest</string>
  <key>WorkingDirectory</key>
  <string>/Users/heyuxuan/Documents/项目/knowledge-workbench/.claude/skills/feed-digest</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>scripts/run.mjs</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <!-- 需要代理时取消注释：
    <key>HTTPS_PROXY</key><string>http://127.0.0.1:7897</string>
    <key>HTTP_PROXY</key><string>http://127.0.0.1:7897</string> -->
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/feed-digest.log</string>
  <key>StandardErrorPath</key><string>/tmp/feed-digest.err</string>
</dict></plist>
```

加载（改动 plist 后需先 unload 再 load）：

```bash
launchctl unload ~/Library/LaunchAgents/com.kwb.feed-digest.plist 2>/dev/null
launchctl load  ~/Library/LaunchAgents/com.kwb.feed-digest.plist
launchctl start com.kwb.feed-digest      # 立即跑一次验证
```

### 方案 B：crontab（更简单）

```bash
crontab -e
# 加一行（每天 08:00，node 路径换成 which node 的结果）：
0 8 * * * cd "/Users/heyuxuan/Documents/项目/knowledge-workbench/.claude/skills/feed-digest" && /opt/homebrew/bin/node scripts/run.mjs >> data/cron.log 2>&1
```

> macOS 提示：`Documents/` 受隐私保护，若 cron 运行时报权限错误，去
> 「系统设置 → 隐私与安全性 → 完全磁盘访问权限」给 `/usr/sbin/cron` 授权；
> launchd 方案一般不受此限，所以优先推荐 A。

## 常用操作

| 需求 | 做法 |
|---|---|
| 加一个信源 | 编辑 `feeds.json` 的 `sources`，加 `{id,name,name_zh,category,type,urls}` |
| 改论文票数门槛 | 改 `hf-papers` 的 `rules.minScore`（默认 20） |
| 改每源每次上限 | 改该源 `rules.maxNew`（HN=8，其余默认 12） |
| 某个源老失败 | 给它加 `discover`（站点主页）做 RSS 自动发现兜底，或换 `urls` 里的候选地址 |
| 只抓一个源调试 | `node scripts/run.mjs --source <id>` |
| 预览不落盘 | `node scripts/run.mjs --dry-run` |
| 重置某源去重 | 编辑 `state.json` 删掉对应源的 `seen`（谨慎） |

## 信源类型说明

- `rss`：标准 RSS/Atom（多数源）。多候选 URL 依次尝试 + 主页自动发现兜底。
- `json-hf`：Hugging Face `daily_papers` API，按 `upvotes` 过滤（社区投票筛选）。
- `json-hn`：Hacker News 官方 Firebase API，取热榜故事，去重后每次最多 `maxNew` 条。
- `scrape-pg`：Paul Graham 官网无 RSS，直接解析 `articles.html` 的随笔列表。

## 设计原则

- **增量去重**靠 `state.json` 的指纹窗口（每源留最近 500 条指纹），feed 里已见的不再重列。
- **单源失败隔离**：任一源报错只记进日志/`lastError`，不影响其它源，`run.mjs` 正常退出。
- **翻译只在成品阶段**、批量合并调用降成本；失败自动降级为英文标题，绝不中断。
- **只有成功写完 digest 才推进 state**，避免中途失败丢条目。
