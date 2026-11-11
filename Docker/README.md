# Rhodium Docker 部署包

本目录使用自行构建并导出的本地镜像 `rhodium:0.1.0` 部署；仓库没有承诺该标签已发布到远程镜像仓库。源码构建请在仓库根目录执行 `docker compose up -d --build`，并提前在环境中配置 `HEROUI_KEY`。

## 构建并导出

在仓库根目录执行，密钥通过 BuildKit secret 注入，不能改成 Docker build 参数：

```bash
docker build --secret id=heroui_key,env=HEROUI_KEY --tag rhodium:0.1.0 .
docker save rhodium:0.1.0 | gzip > Docker/rhodium-image-0.1.0.tar.gz
```

`HEROUI_KEY` 必须已在当前进程环境中设置。将本目录的 `docker-compose.yml`、镜像归档和按需配置的 `.env` 复制到目标机器；镜像归档不提交到 Git。旧 `yueyu-image-latest.tar.gz` 是历史产物，不能作为当前版本的构建证明。

## 启动

```bash
docker load -i rhodium-image-0.1.0.tar.gz
docker compose up -d
docker compose ps
```

访问 `http://127.0.0.1:3030`。启动入口先执行数据库迁移，再启动应用；容器停止信号会传递给运行中的子进程。数据库镜像由 digest 固定，应用容器以非 root 用户运行。

## 配置

- 应用没有登录鉴权，默认只绑定 `127.0.0.1:3030`。外部访问应通过经过认证的反向代理或可信 VPN，并显式配置 `RHODIUM_ALLOWED_HOSTS`。仅更改 `APP_BIND` 不会允许新的 Host。
- 代理应保留外部 Host。代理终止 TLS 时，可用 `RHODIUM_ALLOWED_ORIGINS=https://ledger.example` 声明同一 Host 的外部 Origin；Host 和端口必须精确一致。`cross-site`、`same-site` 浏览器请求仍被拒绝。
- 默认忽略转发 IP。只有应用仅接收单一可信边缘代理的连接，且代理将整列 `X-Forwarded-For` 覆写为单个真实客户端 IP 时，才能设置 `RHODIUM_TRUST_PROXY=true`。逗号地址链不用于独立限流键。
- 数据库默认绑定 `127.0.0.1:5432`，可用 `DB_BIND` 更改。应用通过 Compose 网络连接 `db`，无需开放数据库端口。
- 在 `.env` 设置原始 `POSTGRES_PASSWORD`。密码含 `$`、`#` 等字符时使用单引号，例如 `POSTGRES_PASSWORD='replace-with-your-own-password'`。Compose 分别传入 Postgres 和应用的 `PG*` 环境，应用入口进行 URL 编码，特殊字符不会截断连接串。
- 现有自定义容器部署仍可传入完整 `DATABASE_URL`，其优先级高于 `PG*`；自行提供 URL 时需分别编码用户名、密码、数据库名。`POSTGRES_PASSWORD` 只在首次创建数据卷时初始化数据库角色，修改已有库口令还需同步更新数据库角色本身。
- 应用内部端口为 `3030`。仅调整对外端口时，修改 Compose `ports` 的左侧即可。应用探针为 `GET /api/health`。

## 已有账本升级

产品、镜像与归档名称统一为 Rhodium。数据库名、用户 `yueyu` 和卷键 `yueyu-postgres` 为已有数据兼容保留；重命名这些资源不会迁移数据。

Compose 的实际卷名还带有项目名前缀，例如根目录以往通常是 `journal_yueyu-postgres`，本目录可能是 `docker_yueyu-postgres`。升级前用 `docker compose ls` 和 `docker volume ls` 确认原项目及卷，先导出账本备份；在原目录使用同一项目名启动。若移动或重命名部署目录，在 `.env` 设置原来的 `COMPOSE_PROJECT_NAME`，例如 `COMPOSE_PROJECT_NAME=journal`，然后确认应用仍挂载原卷。

升级使用 `docker compose up -d` 更新镜像。不要执行 `docker compose down -v`，该命令会删除数据库卷。更换卷或数据库大版本前，先保留可恢复的数据库备份。
