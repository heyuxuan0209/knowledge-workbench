# kw-content

KW 作品链的可组合 CLI，让 Codex CLI 从任意目录读取已确认的关键版本，并把新关键版写回同一作品链。

## 配置

优先读环境变量 `KW_CONTENT_BASE_URL`、`KW_CONTENT_USERNAME`、`KW_CONTENT_PASSWORD`，其次读 `~/.kw-content/config.json`。密码不要放在命令行参数中：

```bash
printf '%s' "$KW_CONTENT_PASSWORD" | kw-content init --base-url http://localhost:3000 --username "$KW_CONTENT_USERNAME" --password-stdin
kw-content --json doctor
```

## 常用命令

```bash
kw-content --json works list --query "外婆"
kw-content continue <work-id> --out ./draft.md
kw-content checkpoint <work-id> --file ./draft.md --dry-run --json
kw-content checkpoint <work-id> --file ./draft.md --json
kw-content handoff get <work-id> --format markdown
```

`checkpoint` 只新建关键 Release，不发布、不删除、不覆盖历史。

## JSON 契约

成功：`{"ok":true,"data":...}`。失败：`{"ok":false,"error":{"code":"...","message":"..."}}`。认证信息永不输出。高层命令不够用时，只读逃生口是 `kw-content request get /api/...`。
