# prototype/ — UI mock 与选型原型索引

规则（见 CLAUDE.md「文件放哪」）：所有 mock 只进这里，不进 `frontend/public/`。选完型、决策进 ADR 后在下表标记「已定」。

## mock-pages/ — 单文件 mock（2026-07-28 从 frontend/public/ 迁入）

| 文件 | 主题 | 状态 |
|---|---|---|
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

均为纯静态 HTML，直接双击（file://）可看，不依赖前端服务。

## 目录型原型

| 目录 | 主题 | 状态 |
|---|---|---|
| feed-lifecycle-mock/ | 处理进度/今日已清 | 已否决 → ADR-045 |
| feed-mute-archive-mock/ | 显式 mute / 归档 | 已定 → ADR-049/053（显式 mute，⚙调精选面板落地） |
| feishu-rework/ | 飞书接入 | 已定 → ADR-039 |
| flywheel-backhalf/ | 内容飞轮后半环 | 已定 → ADR-036 |
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
