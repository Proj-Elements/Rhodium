# 月余

面向大学生的个人记账 Web 应用：记录日常支出、设置月度预算、管理固定订阅，并在月底回顾本月余量。

## 本地开发

```bash
npm install
cp .env.example .env
docker compose up -d db
npx prisma migrate deploy
npm run dev
```

打开 <http://127.0.0.1:3030>。

## Docker 部署

```bash
docker compose up -d --build
```

应用容器会在启动时自动执行 Prisma migrations。PostgreSQL 数据保存在 `yueyu-postgres` named volume 中。健康检查探针为 `GET /api/health`。

用预构建镜像离线部署见 [`Docker/README.md`](Docker/README.md)。

### 安全默认值

本应用**不含任何登录与鉴权**，因此 compose 默认把两个端口都绑在回环地址上：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `APP_BIND` | `127.0.0.1` | 应用 3030 端口的绑定地址 |
| `DB_BIND` | `127.0.0.1` | Postgres 5432 端口的绑定地址 |
| `POSTGRES_PASSWORD` | `yueyu_password` | 数据库口令，同时注入 Postgres 与 `DATABASE_URL` |

确认所在网络可信后再对外暴露，并务必覆盖默认口令：

```bash
POSTGRES_PASSWORD='强口令' APP_BIND=0.0.0.0 docker compose up -d --build
```

`POSTGRES_PASSWORD` 只在**首次**创建数据卷时用于初始化数据库；之后修改需同时更新数据库中的角色口令。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

应用默认使用人民币、中文界面和 `Asia/Shanghai` 时区。首版是单人本地账本，不包含登录、多人共享、银行同步或多币种。
