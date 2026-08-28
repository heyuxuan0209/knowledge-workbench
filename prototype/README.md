# prototype/ — UI mock 与选型原型索引

规则（见 CLAUDE.md「文件放哪」）：所有 mock 只进这里，不进 `frontend/public/`。选完型、决策进 ADR 后在下表标记「已定」。

## mock-pages/ — 单文件 mock（2026-07-28 从 frontend/public/ 迁入）

| 文件 | 主题 | 状态 |
|---|---|---|
| content-flow-overview.html | 七步内容流程总览：新手教程式导航，每步连回现有页面 | **已定 → ADR-108**：只做认知地图，不做管线运行中心；正式页面复用 KW 现有视觉 token |
| x-video-cards-mock.html | X 英文视频 demo 的**标题卡 / 录屏画框 / 加速角标**配色选型，6 版（黑金·8-Bit Orbit·Raw Grid 深色变体·Neo-Grid Bold·Editorial Forest·现状对照），配色取自 `html-ppt-mocks/` 定稿模板 | **已定 → ADR-092**：选 B 黑金；渲染器 `cards_gold.py` 在 `~/Documents/项目/writing/published/2026-08-10-一键读取X上英文视频/` |
| x-video-endcard-mock.html | X demo 片尾**第 7 张卡**：开源地址（watch-anything）+ 关注我（小红书/公众号/视频号/抖音二维码 + X @xuan70557），3 版布局 | **已定 → ADR-092**：完整版用 A（五宫格）／60 秒主推用 C（只留 GitHub + 公众号码）；二维码统一裁成纯码方图 |
| x-video-vcover-mock.html | X demo 的**竖版封面**（视频号/抖音/小红书）3 版：A 大字压图 / B 上下对比 / C 一句话冲击。1080×1920，带 3:4 安全区与平台 UI 遮挡标尺（`#clean` 看净版） | **已定 → A 大字压图**（文案不提 X，只说「刷到的英文长视频」）；成品在创作工作区 `封面-竖版-1080x1920.png` / `封面-3比4-1080x1440.png` |
| card-mockup.html / density-mockup.html / feed-density-mock.html | 卡片与密度选型 | 已定 → ADR-033（密度开关）→ ADR-045（开关退役、统一紧凑行） |
| feed-actions-mock.html | 动作条 4 版选型 | 已定 → 版 B 图标+文字（ADR-053 轮） |
| feed-curated-mock.html / feed-final-mock.html | feed 精选改造 | 已定 → ADR-053（情报台） |
| feed-firsthand-mock.html | 一手优先分组 | 已定 → ADR-045 |
| feed-scanread-mock.html | 扫/读分离 | 已定 → ADR-033 |
| feed-lifecycle-mock.html | 处理进度/「今日已清」 | 已否决 → ADR-045（feed 是精选台不是待办清单） |
| tracking-mock-a~e.html | 追踪选题 5 方案 | 已定 → ADR-040（追踪型主题+双通道配额） |
| upload-fork-mock.html / upload-fork-inpage-mock.html | 上传分叉 | 已过审 → ADR-035 ④上传岔口 |
| inspiration-merged-mock.html / inspiration-redesign-mock.html | 灵感页改版 | 已过审 → ADR-035（随手记/卡片养大） |
| icons-hover-mock.html | 导航图标三组选型 | 已定（随 hover 换 SVG 落地） |
| product-ideas-mock.html | 产品灵感库闭环（V4 阶段3：方案卡/灵感卡 + 问题→方案检索） | 封存 → ADR-060（不先建 UI，转两周无界面试点，08-11 验收） |
| bitable-single-table-mock.html / bitable-two-table-mock.html | 飞书多维表格·发布与复盘表结构选型（单表全记 vs 内容主表+发布记录，D7/D30 两档回收） | 已定 → 方案B + 机器人代填（ADR-061） |
| x-interpret-mock-a/b/c.html + x-interpret-mock-index.html | X 一键解读浏览器插件交互三方案（A 侧边面板 / B 原位展开 / C 飞书接力；index 为带切换器的对比页） | 已定 → 方案A 面板+卡片风、按钮文案「解读」（ADR-065，插件落地 extension/） |

均为纯静态 HTML，直接双击（file://）可看，不依赖前端服务。

## 目录型原型

| 目录 | 主题 | 状态 |
|---|---|---|
| feed-lifecycle-mock/ | 处理进度/今日已清 | 已否决 → ADR-045 |
| feed-mute-archive-mock/ | 显式 mute / 归档 | 已定 → ADR-040/053（显式 mute，⚙调精选面板落地；2026-07-29 修正错引：原写 049 实为 040） |
| feishu-rework/ | 飞书接入 | 已定 → ADR-039 |
| flywheel-backhalf/ | 内容飞轮后半环 | 已定 → ADR-036 |
| content-review-dashboard/ | 内容实验驾驶舱：流量/同频双目标、D7 触发、行动建议 + 自由探索（真实数据交互原型） | **探索中·待用户点选**（2026-08-25） |
| inspiration-layouts/ | 灵感/摄入口改版 | 已过审 → ADR-035/039 |
| reader-descent-mock/ | 精读器分析层（A–E/Z 多版） | 探索中·未产品化 |
| season-skins/ | 心情皮肤 | 已定 → ADR-037 |
| sharpen-mock/ | 「磨利」按钮三版 | 已砍 → ADR-044（仅作反面参考） |
| studio-export-mock/ | 出片/导出 | 已定 → ADR-046 P3 |
| studio-redesign/ | 创作台重设计（AC 布局等） | 已定 → ADR-028/030 |
| studio-redesign-mock/ | 播放器主题/暗色对照 | 已定 → ADR-038/043 轮（HTML 播放器） |
| tracking-topic-pilot/ | 追踪主题试点 | 已定 → ADR-040 |
| tutorial-viz/ | 可视化教程（含内容脚本样板） | 已定 → ADR-038/043；内容样板见 ADR-042 |
| ui-revamp-shots/ | UI 改版过程截图 | 存档（无待决选型） |

> 维护方式：哪轮选型结束了，就把对应行状态改成「已定 → ADR-0xx」；整个目录都定稿的可移入 `done/`（需要时再建）。

## 只在本地的目录（不进公开仓，clone 下来看不到）

| 目录 | 主题 | 状态 |
|---|---|---|
| `html-ppt-mocks/` | 场次页模板选型：18 版可点 HTML（A–R）+ `模板墙.html`（本机 34 套现成模板一屏铺开）+ `对比-F对I.html` | **已定 → ADR-086/087/088**。定稿 7 套：**H Raw Grid（唯一工程化）**／B 黑金／A 暖纸手账／I 8-Bit Orbit／O Daisy Days／Q Neo-Grid Bold／R Editorial Forest；D 内刊、E 深色蓝科技＝备用不工程化；弃用 C/F/G/K/L/M/N/P |

**为什么这个目录被 .gitignore**（本仓是公开仓）：`assets/tpl/` 是从
`zarazhangrui/beautiful-html-templates` 拷的 68 张截图（MIT，但没必要转载）、
`assets/zpix-subset.woff2` 是 Zpix 字体子集、18 份 mock 里是作者本人分享的真实内容。
**落地产物在 `backend/ppt/` 和 `.claude/skills/html-ppt/`，那两处是进 git 的**；
这里只是选型现场，留本地备查。
