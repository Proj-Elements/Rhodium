# 月余 Docker 部署包

本目录包含可直接部署的产物。

## 文件

- `yueyu-image-latest.tar.gz` — 应用镜像（启动时自动执行 `prisma migrate deploy`）
- `docker-compose.yml` — 一键启动 app + postgres

## 部署步骤

```bash
# 1. 导入镜像
docker load -i yueyu-image-latest.tar.gz
# => Loaded image: yueyu:latest

# 2. 启动（在该目录下执行）
docker compose up -d

# 3. 打开
# http://localhost:3030
```

首次启动会自动应用全部数据库迁移，无需手动操作。

## 说明

- 数据持久化在 named volume `yueyu-postgres` 中；升级镜像不会丢数据。
- 健康检查：`docker compose ps`，app 与 db 均应显示 `healthy`。
- 应用端口由 compose 固定为 `3030`（镜像内已内置 `PORT=3030`）；如需改对外端口，编辑 compose 里的 `ports` 映射即可。
- 数据库连接串已由 compose 注入，无需额外配置。
