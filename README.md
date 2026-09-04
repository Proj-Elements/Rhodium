# 月余

面向大学生的个人记账 Web 应用：记录日常支出、设置月度预算、管理固定订阅，并在月底回顾本月余量。

## 本地开发

```bash
npm install
cp .env.example .env
# 编辑 .env，把 POSTGRES_PASSWORD 与 DATABASE_URL 里的密码改成同一个值
docker compose up -d db
npx prisma migrate deploy
npm run dev
```

打开 <http://localhost:3030>。

## Docker 部署

```bash
docker compose up -d --build
```

应用容器会在启动时自动执行 Prisma migrations。PostgreSQL 数据保存在 `yueyu-postgres` named volume 中。

数据库口令来自 `.env` 的 `POSTGRES_PASSWORD`（未设置时 compose 会直接报错，不再回落到仓库里的默认口令）。两个服务的端口都只绑定 `127.0.0.1`，应用进程以非 root 的 `node` 用户运行。

## 安全边界

**这是单人本地账本，服务端没有任何登录或鉴权：任何能访问端口的人都能读写、导出、清空全部账目。**

- 不要把 `3030` 或 `5432` 暴露到公网或不受信任的局域网；如需远程访问，请放在带认证的反向代理（或 VPN）之后。
- `/api/*` 有基于进程内存的简易限流（读 600/分钟、写 120/分钟、导入 12/分钟），只用于兜住失控的重试循环，不是防护措施。
- 响应头包含 CSP、`X-Frame-Options`、`Referrer-Policy` 等基础加固，API 响应统一 `Cache-Control: no-store`。
- 请求体上限为 256 KB，导入接口 8 MB；超出返回 413。
- `/api/export` 会导出全部账目（CSV 已做公式注入转义），请自行保管导出文件。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

`npm test` 只跑纯函数单元测试，不需要数据库。

需要数据库的集成测试（预算继承、结算快照、订阅同步、接口回归）单独运行，先准备一个**可以被清空**的库：

```bash
docker run -d --name yueyu-test-db -e POSTGRES_USER=yueyu -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=yueyu_test -p 55433:5432 postgres:16-alpine
export TEST_DATABASE_URL="postgresql://yueyu:testpw@127.0.0.1:55433/yueyu_test?schema=public"
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
npm run test:db
```

集成测试会 `TRUNCATE` 所有表，**不要指向真实数据库**。

应用默认使用人民币、中文界面和 `Asia/Shanghai` 时区。首版是单人本地账本，不包含登录、多人共享、银行同步或多币种。
