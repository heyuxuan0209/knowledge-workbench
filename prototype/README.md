# prototype/ — UI mock 与选型原型索引

规则（见 CLAUDE.md「文件放哪」）：所有 mock 只进这里，不进 `frontend/public/`。选完型、决策进 ADR 后在下表标记「已定」。

## mock-pages/ — 单文件 mock（2026-07-28 从 frontend/public/ 迁入）

| 文件 | 主题 | 状态 |
|---|---|---|
| card-mockup.html / density-mockup.html / feed-density-mock.html | 卡片与密度选型 | 待标记 |
| feed-actions-mock.html / feed-curated-mock.html / feed-final-mock.html / feed-firsthand-mock.html / feed-lifecycle-mock.html / feed-scanread-mock.html | feed 各轮选型 | 待标记 |
| tracking-mock-a~e.html | 追踪选题 5 方案 | 待标记 |
| upload-fork-mock.html / upload-fork-inpage-mock.html | 上传分叉 | 待标记 |
| inspiration-merged-mock.html / inspiration-redesign-mock.html | 灵感页改版 | 待标记 |
| icons-hover-mock.html | 图标悬停 | 待标记 |

均为纯静态 HTML，直接双击（file://）可看，不依赖前端服务。

## 目录型原型

各子目录（feed-lifecycle-mock/、studio-redesign/、season-skins/ 等）为多文件原型，状态同样待各会话认领标记。

> 维护方式：哪轮选型结束了，就把对应行状态改成「已定 → ADR-0xx」；整个目录都定稿的可移入 `done/`（需要时再建）。
