# 生产部署

## 推荐拓扑

```text
浏览器 → HTTPS 域名 → Cloudflare Tunnel → 127.0.0.1:3000
                                               └→ Express + frontend/dist + SQLite
```

不直接开放 3000，不迁移 SQLite，不占用当前 SSH 使用的 443。Tailscale/SSH 隧道保留为运维退路。

## 生产配置

复制 `backend/.env.example` 中需要的键到 `backend/.env`，真实密钥不进 Git。公网上线至少配置：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
ACCESS_PROTECTION_ENABLED=true
ACCESS_USERNAME=judge
ACCESS_PASSWORD=<密码管理器生成的长随机密码>
ALLOWED_ORIGINS=https://<正式域名>
DB_PATH=./data/app.db
```

如需保留 Tailscale 直连 3000，`HOST` 可保持 `0.0.0.0`，但 UFW 必须继续限定为 `tailscale0`；公网绝不允许 3000。

## 上线前硬检查

1. Mac、GitHub、VPS 的提交关系已对齐，VPS worktree 必须干净。
2. 对运行中 SQLite 执行一致性备份，备份后跑 `PRAGMA integrity_check`。
3. `npm run test:security` 与 `npm run test:export-parsers` 通过。
4. `frontend/npm run build` 通过。
5. 访问口令可用，未登录时除 `/health/live` 外均返回 401。
6. 从国内和国外网络分别验证首页、登录和关键流程。

## 构建与重启

```bash
cd frontend && npm ci && npm run build
cd ../backend && npm ci
sudo systemctl restart kw-backend
```

重启后不能只看 `active`：

```bash
curl http://127.0.0.1:3000/health/live
curl -u "$ACCESS_USERNAME:$ACCESS_PASSWORD" http://127.0.0.1:3000/health
git rev-parse HEAD
```

`/health` 返回的 `commit` 必须等于目标 HEAD。

## 验收关键流程

- 资讯页能读到已入库内容，标签页长期打开后会自动重读。
- 选择一条现有资讯能打开解读；不在验收中跑全量同步。
- 素材、主题、灵感和草稿列表可读。
- 创作台能读取文体、平台形态和系列样式。
- 多平台适配使用一份测试草稿跑通，不触发最终发布。
- 数据复盘页能读现有数据，不改写真实发布记录。

## 回滚

- 代码：回到上一个已验证 commit，重建前端后重启 systemd。
- 前端：保留上一份 `frontend/dist` 产物。
- 数据：只在确认数据已损坏时恢复备份；恢复前先保留当前库，不直接覆盖。
- 公网入口：可先停 Cloudflare Tunnel，不影响 SSH/Tailscale 运维通道。

## 当前已知运行风险

- LLM 供应商余额不足时，进程仍会存活，但翻译/分类会降级。
- SQLite 是 VPS 上的唯一真相源；Mac 本地库只是旧快照。
- 一键发布依赖浏览器扩展和 localhost/HTTPS 上下文，最后发布按钮始终由人点击。
