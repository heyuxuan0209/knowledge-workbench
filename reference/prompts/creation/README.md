# 创作层 prompt 目录（文件即行为）

创作台的全部「语言规范」集中在这里：**改文件 = 改产品行为，保存即生效**（后端每次生成时实时读取，无缓存、无需重启）。程序逻辑（素材编号、溯源解析、截断）仍在代码里，这里只管 AI 怎么写。

## 目录结构

| 文件 | 作用 | 占位符 |
|---|---|---|
| `platforms/*.md` | 平台模板，**一个文件一个平台**——新增平台 = 加一个文件，创作台自动出现 | 无（纯规格） |
| `draft-frame.md` | 起稿总框架（综述+素材+要求的组装模板） | `{{topicName}} {{platformSpec}} {{stanceBlock}} {{current}} {{views}} {{consensus}} {{notes}}` |
| `stance-with.md` / `stance-without.md` | 有/无作者立场时的立场块（诚实原则：无立场时 AI 判断必须自我标注） | `{{viewpoint}}` |
| `humanize.md` | 去 AI 味三遍审校 | `{{platformNote}} {{draft}}` |
| `rewrite.md` | 创作助手指令改写 | `{{platformNote}} {{instruction}} {{draft}}` |
| `titles.md` | 标题候选 | `{{draft}}` |
| `thread-single.md` | 单篇内容快速出 thread（Feed 侧入口） | `{{material}}` |

## platforms/ 文件格式

```markdown
---
label: 公众号长文        ← 创作台按钮文字
icon: 📄                ← 按钮/草稿箱图标
order: 2                ← 排序
note: 公众号长文（Markdown） ← 指令改写时给 AI 的平台提示
---
（正文 = 平台写作规格，直接对 AI 说话）
```

## 修改守则

- 「不编造数据和引语」「保留 [素材N] 溯源标记」这类诚实约束是全局底线，改模板时**不要删**
- 占位符名字不要改（代码按名字注入）；删掉某个占位符 = 该信息不再进 prompt，属合法操作
- 文件缺失/frontmatter 缺 label 会导致生成接口报错（有意为之：宁可报错也不静默用空模板）
