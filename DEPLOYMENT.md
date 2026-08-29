# 生产部署

## 已验证的可选公网拓扑（2026-08-28）

```text
公网浏览器
  → HTTPS · Tailscale Funnel（`https://<device>.<tailnet>.ts.net`）
  → Nginx Basic Auth（127.0.0.1:3443）
  → Express + frontend/dist（127.0.0.1:3000）
  → SQLite（VPS 唯一真相源）

tailnet 内部调用 / SSH 隧道
  → 受防火墙限制的 3000 端口
  → 同一 Express 服务
```

该拓扑已完成国内外网络验证，但公开入口默认关闭，需要临时演示时才开启。公网不直接开放 3000，也不迁移 SQLite。公网 HTTPS 由 Tailscale Funnel 提供，VPS 自身的 443 仍供 SSH 使用；两者不争抢监听端口。Nginx 只监听本机 3443，公网认证不会打断飞书机器人和会议流程对内部 3000 的调用。

## 生产配置

复制 `backend/.env.example` 中需要的键到 `backend/.env`，真实密钥不进 Git。当前拓扑的应用层配置为：

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
ACCESS_PROTECTION_ENABLED=false
ALLOWED_ORIGINS=https://<device>.<tailnet>.ts.net,http://localhost:3000,http://127.0.0.1:3000,http://<tailnet-device>:3000
DB_PATH=./data/app.db
```

`ACCESS_PROTECTION_ENABLED=false` 是有意设计：公网认证由 Nginx 完成，避免破坏内部自动化。Nginx 的口令文件为 `/etc/nginx/kw.htpasswd`，权限必须保持 `root:www-data 0640`。`HOST=0.0.0.0` 用于保留 Tailscale 直连，但 UFW 必须继续把 3000 限定在 `tailscale0`，公网绝不允许直连。

Funnel 配置：

```bash
tailscale funnel --bg http://127.0.0.1:3443
tailscale funnel status
```

演示结束后关闭：

```bash
tailscale funnel --https=443 off
```

## 上线前硬检查

1. Mac、GitHub、VPS 的提交关系已对齐，VPS worktree 必须干净。
2. 对运行中 SQLite 执行一致性备份，备份后跑 `PRAGMA integrity_check`。
3. `npm run test:security` 与 `npm run test:export-parsers` 通过。
4. `frontend/npm run build` 通过。
5. Nginx 访问口令可用，公网未登录访问均返回 401；内部 `/health/live` 返回最小存活信息。
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
curl http://127.0.0.1:3000/health
curl -u "<网关用户>:<网关密码>" http://127.0.0.1:3443/health
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
- 公网入口：`tailscale funnel --https=443 off`，不影响 SSH 和 tailnet 内部运维通道。

## 当前已知运行风险

- LLM 供应商余额不足时，进程仍会存活，但翻译/分类会降级。
- SQLite 是 VPS 上的唯一真相源；Mac 本地库只是旧快照。
- 一键发布依赖浏览器扩展和 localhost/HTTPS 上下文，最后发布按钮始终由人点击。
- Tailscale Funnel 目前属于 beta，受其非固定带宽限制约束；长期正式运营可再迁移到自有域名入口。
