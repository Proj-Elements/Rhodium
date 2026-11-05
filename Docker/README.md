# Rhodium Docker 部署包

本目录用于**用预构建镜像**部署（不含构建上下文）。若想直接从源码构建运行，请在仓库根目录执行 `docker compose up -d --build`。

## 文件

- `docker-compose.yml` — 一键启动 app + postgres，使用镜像 `yueyu:latest`
- `yueyu-image-latest.tar.gz` — 应用镜像归档（**不在仓库里**，已被 `.gitignore` 忽略，需按下面步骤自行导出）

## 一、导出镜像归档

在**仓库根目录**执行：

```bash
docker build -t yueyu:latest .
docker save yueyu:latest | gzip > Docker/yueyu-image-latest.tar.gz
```

把 `Docker/` 整个目录拷到目标机器即可。

## 二、在目标机器部署

```bash
# 1. 导入镜像
docker load -i yueyu-image-latest.tar.gz
# => Loaded image: yueyu:latest

# 2. 启动（在该目录下执行）
docker compose up -d

# 3. 打开
# http://127.0.0.1:3030
```

首次启动会自动应用全部数据库迁移（镜像启动时执行 `prisma migrate deploy`），无需手动操作。

## 说明

- **端口默认只绑定回环地址 `127.0.0.1`。** 本应用没有任何登录/鉴权，任何能访问该端口的人都可以读写账本。确认所在网络可信后，再用 `APP_BIND=0.0.0.0 docker compose up -d` 对外暴露。
- 数据库端口同理，默认 `127.0.0.1:5432`，可用 `DB_BIND` 覆盖。
- **数据库密码默认为 `yueyu_password`，请务必覆盖：** 建议在该目录放一个 `.env` 文件写入 `POSTGRES_PASSWORD=你的密码`，compose 会同时用于 Postgres 初始化和应用连接串。注意：该密码只在**首次**创建数据卷时生效，事后修改需同时改动数据库里的角色口令。
- 数据持久化在 named volume `yueyu-postgres` 中；升级镜像不会丢数据。
- 健康检查：`docker compose ps`，app 与 db 均应显示 `healthy`；app 的探针为 `GET /api/health`。
- 应用容器内端口固定 `3030`（镜像内置 `PORT=3030`）；如需改对外端口，编辑 compose 里的 `ports` 映射左侧即可。
