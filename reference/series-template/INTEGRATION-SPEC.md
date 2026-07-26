# 创作台集成契约 · AI 观察手记系列

> **交接对象**：负责创作台的 agent/体系。
> **交接方**：本系列资产的设计方（保留资产层维护与答疑）。
> **性质**：自包含契约（沿用 idea2post HANDOFF 先例，平台红线内嵌、不外借）。**产品代码接线由创作台方完成**；本文件只定契约、数据结构、依赖与映射，不假设你们的后端目录结构。

---

## 0. 集成目标（一句话）

把三块能力放进创作台，**用户选一次「系列风格」→ 联动产出头图 + 排版 + （可选）起草声音**：
1. **头图引擎**（确定性）——字段 → 双尺寸 PNG。
2. **排版引擎**（vendored gzh-design）——定稿 md + 主题 → 可粘贴公众号的合规 HTML。
3. **文案声音**（可选 prompt 预设）——起草/改写时可挑口吻，不选则人肉定稿。

> 决策前提（已定）：创作台由你方负责 → **hybrid 交接**；排版引擎 **vendored 进后端**（不依赖个人 `~/.claude` skill）；声音是**可选软层**、不与视觉硬绑定。

---

## 1. 核心数据模型

### 1.1 StylePreset（系列风格预设）

一个预设绑定「头图皮肤 + 正文主题 + 默认声音」，但**声音可被覆盖**（软绑定）。

| 预设 id | 名称 | cover_skin（头图皮肤） | article_theme（正文主题） | default_voice（默认声音，可改） |
|---|---|---|---|---|
| `ticket-brisk` | 摸鱼绿系 · 轻快犀利 | `moyu-green` | `moyu-ticket`（票据风） | `brisk` 轻快犀利 |
| `olive-deep` | 橄榄手记 · 沉稳深度 | `olive-journal` | `olive-journal` | `deep` 沉稳深度 |

备选头图皮肤（暂不启用，引擎里已有）：`graphite`、`red-white`。

### 1.2 IssueContent（每期内容字段）

头图与正文共用的一份期刊字段。**头图**直接消费下表；**正文**另需一份定稿 markdown。

| 字段 | 含义 | 必填 | 备注 |
|---|---|---|---|
| `name` | 系列刊名（报头左上） | ✔ | 固定 "AI 观察手记"（可改名） |
| `issue_event` | 期号 + 场合（报头右上） | ✔ | 支持 `<br>` 两行，如 `NO.01 · 视频演讲精读<br>Compile 26 · Cursor 社区` |
| `badge` | 来源徽章（副标前） | ○ | 可选：**留空即整枚隐藏**；可填 `▶ YouTube`/`𝕏`/`🎤 现场·飞书AI大会`/`⚡ 黑客松` |
| `kicker` | 副标 | ✔ | 一句话副标题 |
| `title_html` | 主标题 | ✔ | 含**一个** `<span class="ul">关键词</span>` 做下划线点睛；`<br>` 换行 |
| `author_html` | 作者行（底部左） | ✔ | 支持 `<b>…</b>`（自动上主题色）。当前署名见 §4 尾注 |
| `tag` | 类型标签（底部右） | ✔ | 如「深度精读」「现场手记」 |
| `article_md` | 正文定稿 markdown | ✔（仅正文用） | 喂给排版引擎；标题行为平台标题、不进正文 |

字段来源：精读流水线的结构化产物（演讲人/来源/期号/核心一句话/关键词）直接映射到上表。

---

## 2. 能力一：头图引擎（最独立，建议先接 = P1）

- **现成实现**：`reference/series-template/render_cover.py`（`STYLES` 皮肤字典 + `TEMPLATE_WIDE`/`TEMPLATE_SQUARE` 骨架 + `render(style, content, out, dir, shape)`）。这是**确定性纯函数**（同输入同输出），最适合先服务化。
- **输入**：`cover_skin` 对应的 `STYLES[key]` + `IssueContent`。
- **输出**：两张 PNG
  - `wide` = 900×383 @2x = **1800×766**（消息列表大图，2.35:1）
  - `square` = 1000×1000 @2x = **2000×2000**（转发卡片/主页，1:1）
  - 两种**各自专门排版**，非裁切。
- **依赖**：Playwright + headless Chromium，`device_scale_factor=2`。
- **接入方式**：把 `STYLES` 与两个 `TEMPLATE_*` 移植成后端模块；后端起一个无头浏览器渲染服务，`build_html()` 拼串 → 截图。皮肤 token 全在 `STYLES`（色/字体/rule/下划线色/标签色），照搬即可。
- **badge 逻辑**：`content["badge"]==""` 时后端要复刻"整枚移除"（见 `build_html` 里对 `<span class="badge">…</span>` 的条件删除）。

> ⚠️ **基建（✅ 已定：字体用 Noto）**：头图报头用宋体 `Songti SC`——**macOS 独有**，Linux 服务器无此字体、衬线标题会掉字。**服务端必须打包并注册开源中文字体**：**思源宋体 `Noto Serif SC`**（替代 Songti，做报头/标题）＋ **思源黑体 `Noto Sans SC`**（替代 PingFang，做正文），并在 `render_cover.py` 的字体栈 `SERIF`/`SANS` 里把它们排在前面。上线前必做。

---

## 3. 能力二：排版引擎（vendored gzh-design = P2）

- **输入**：`article_md`（定稿）+ `article_theme`。
- **输出**：纯 `<section>…</section>` 合规 HTML（直接粘贴公众号编辑器不掉样式）＋ 可选「一键复制」预览页。

### 3.1 Vendor 包（✅ 已随交接包自带，在 `vendor/`，零外部依赖）

排版组件库与脚本**已 vendored** 到 `reference/series-template/vendor/`，创作台方**无需**访问个人 `~/.claude`。目录：

| 文件（相对 `vendor/`） | 作用 | 必需 |
|---|---|---|
| `SKILL.md` | 装配流程与规则（给装配 LLM 的说明，非可执行代码） | ✔ |
| `references/theme-index.md` | 主题索引 + 每主题下划线 CSS（单一来源） | ✔ |
| `references/theme-moyu-ticket.md` | 票据风组件库 | ✔（启用） |
| `references/theme-olive-journal.md` | 橄榄手记组件库 | ✔（启用） |
| `references/common-components.md` | 通用组件（代码块/图片/小标签） | ✔ |
| `scripts/validate_gzh_html.py` | **确定性合规校验**（平台红线 + span leaf + 半角标点） | ✔ |
| `scripts/wrap_preview.py` | 把干净正文包成带「复制」按钮的预览页 | 可选 |
| `references/theme-{moyu-green,graphite-minimal,red-white,zen-whitespace}.md` | 备选主题（已一并带上） | 可选 |
| `VENDOR.md` | 来源仓库 + vendored 时间 + commit（手动同步依据） | — |

改进后按 `VENDOR.md` 手动双向同步（idea2post 先例）。

### 3.2 平台红线（内嵌，校验脚本是硬门）

- **禁**：`<style>`/`<script>`/`<div>`、`class`/`id`、`position:fixed|absolute|sticky`、`float`、`@media`/`@keyframes`、`display:grid`、CSS 变量、外部字体。
- **必须**：样式全内联；**每个文字节点用 `<span leaf="">…</span>` 包裹**（否则粘贴后样式整片丢失）。
- **中文标点全角、弯引号**（代码/英文专名/URL 内除外）。
- **验收**：`validate_gzh_html.py <file>` 必须跑到 **0 ERROR + 0 WARNING** 才算完成（半角引号可用文本节点转全角脚本批量修，见 §3.4）。

### 3.3 排版**不是纯函数**（装配 = LLM，✅ 已定）

装配这步（选组件配方、每段挑 1~3 个关键词加下划线、金句/引用/子标题的语义映射）**依赖 LLM 判断**，不是确定性规则。**已定方案**：
- 后端"排版引擎"= **LLM 装配 Agent（读 SKILL.md + 两份组件库，产出 HTML）** ＋ **确定性校验脚本兜底**（不规则化）。
- LLM 只管"装得像"，`fix_quotes.py` + `validate_gzh_html.py` 保证"合规"，职责分离。

### 3.4 半角引号转全角（确定性后处理，现成工具 `fix_quotes.py`）

流水线固定顺序：**LLM 装配 → `fix_quotes.py` → `validate_gzh_html.py`（应 0/0）**。
- `reference/series-template/fix_quotes.py`（现成、独立、无第三方依赖）：`python3 fix_quotes.py <file.html>` 原地把"含中文文本节点"里的直引号转全角弯引号，不碰标签/属性/纯英文。
- **对创作台 agent 无额外负担**：一次固定脚本调用、全自动无判断；作用是自动修掉最高频的校验 WARNING，让装配 LLM 不必追求 100% 完美。

---

## 4. 能力三：文案声音（可选 prompt 预设 = P3）

声音只影响**文字口吻**，与视觉无关；**可选**，不选则人肉定稿。清单（详见 `SERIES-SPEC.md` 的开头示范）：

| voice id | 名称 | 句式特征 | 适配 |
|---|---|---|---|
| `brisk` | 轻快犀利 | 短句、口语、第二人称"你"、金句密 | builder 观点/方法论 |
| `deep` | 沉稳深度 | 长句、书面、客观陈述、克制 | 深度访谈、思想性演讲 |
| `analytic`（备选） | 理性克制 | 结构化、数据/逻辑导向、中性 | 技术评测、趋势报告 |
| `sharp`（备选） | 观点鲜明 | 立场强、短句、断言锋利 | 争议、强观点、预测 |

- **接入建议**：作为 `reference/prompts/creation`（文体×平台形态）的**正交"声音"层**，起草/改写时叠加；与 025/026 三层模型对齐由你方定。
- **默认**：预设自带 `default_voice`，用户可覆盖或关闭。

**当前署名**（正文尾部固定文案，非声音）：
`我是杰西卡，为你精读海内外一线 AI builder 的一手观察与干货。`

---

## 5. 端到端流程（创作台视角）

```
精读流水线结构化字段（演讲人/来源/期号/核心一句话/关键词/定稿 md）
   → 用户选 StylePreset（ticket-brisk / olive-deep）
   ├─ 头图：字段 → render(skin, content, shape) → wide.png + square.png
   ├─ 正文：article_md + article_theme → LLM 装配 → validate（0/0）→ HTML(+预览页)
   └─ 声音（可选）：起草/改写时叠加 default_voice
   → 人审 → 发布
```

## 6. 依赖与基建清单

- **Playwright + Chromium**（头图渲染；`wrap_preview.py` 是纯 HTML 包壳、不需浏览器）。
- **中文字体**：思源宋体 `Noto Serif SC` + 思源黑体 `Noto Sans SC`（服务端替代 macOS 的 Songti/PingFang，§2 注意）。
- **python3**（校验脚本 / 引号后处理）。
- **一个装配用的 LLM**（§3.3）。

## 7. 分期路线

- **P1 头图**：确定性、最独立，先接见效最快。
- **P2 排版**：vendored 组件库 + LLM 装配 + 校验兜底。
- **P3 声音**：接 prompts/creation 的可选声音层。
- **P4 联动**：一次"选预设"驱动头图+正文+声音。

## 8. 决策状态

**✅ 已定（设计方拍板）**
- 排版**装配步 = LLM 装配 + 校验脚本兜底**，不规则化（§3.3）。
- 服务端**中文字体 = 打包 Noto Serif SC + Noto Sans SC**（§2）。
- 半角引号转全角 = 现成 `fix_quotes.py`，流水线固定调用（§3.4）。

**◻ 待你方（创作台）反馈**
1. 声音层并入 `prompts/creation` 的具体挂法（与 025/026 对齐）。
2. `badge` 默认隐藏、`title_html` 强制一个 `.ul` 关键词——这两条产品交互确认。

## 9. 资产清单（本目录，随本契约整体交接）

```
reference/series-template/
├── INTEGRATION-SPEC.md   # 本契约
├── SERIES-SPEC.md        # 系列规范（风格 ↔ 声音 配对 + 开头示范）
├── render_cover.py       # 头图引擎（确定性）
├── fix_quotes.py         # 直引号→全角弯引号 后处理工具（确定性）
├── vendor/               # 排版组件库 + 校验/预览脚本（自带，零外部依赖，§3.1）
│   ├── SKILL.md  ·  references/*.md  ·  scripts/*.py  ·  VENDOR.md
└── covers/               # 头图成品样例（双尺寸）+ gallery.html
正文成品样例：reference/video-digests/（票据风/橄榄手记等已排全文，含新署名）
```
