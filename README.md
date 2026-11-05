# Rhodium

面向大学生的个人记账 Web 应用：记录日常支出、设置月度预算、管理固定订阅、一键报销，并在月底回顾本月余量。

前端采用 HeroUI v3 / HeroUI Pro 的暖白与松绿主题，支持移动端和亮暗模式。设计说明、隔离验收方法与已知依赖风险见 [`docs/frontend-redesign.md`](docs/frontend-redesign.md)。

产品显示名称为 Rhodium。数据库、Docker 数据卷和浏览器偏好的旧标识保持不变，改名不会创建新账本或清空已有设置。

## 本地开发

```bash
npm install
cp .env.example .env
# 编辑 .env，把 POSTGRES_PASSWORD 与 DATABASE_URL 里的密码改成同一个值
docker compose up -d db
npx prisma migrate deploy
npm run dev
```

打开 <http://127.0.0.1:3030>。

## Docker 部署

```bash
docker compose up -d --build
```

当前界面使用 HeroUI Pro 组件。Docker 构建前需在当前 shell 设置 `HEROUI_KEY`（从 HeroUI Pro 获取），不要把它写进仓库或 `.env`。Compose 会通过 BuildKit secret 将其仅传给固定版本的 `hpsetup@4.7.4`；密钥不作为构建参数或镜像环境变量保存。不要提交或发送 key。本地首次 `npm ci` 后也需运行 `npx -y hpsetup@4.7.4 react --auto`，密钥同样通过环境变量提供。

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

数据库口令优先来自 `.env` 的 `POSTGRES_PASSWORD`；未设置时回落到开发默认值 `yueyu_password`（与 `.env.example` 的连接串一致），该值只在**首次**创建数据卷时生效。两个服务的端口默认只绑定 `127.0.0.1`（可用 `DB_BIND`/`APP_BIND` 放开），应用进程以非 root 的 `node` 用户运行。

## 安全边界

**这是单人本地账本，服务端没有任何登录或鉴权：任何能访问端口的人都能读写、导出、清空全部账目。**

- 不要把 `3030` 或 `5432` 暴露到公网或不受信任的局域网；如需远程访问，请放在带认证的反向代理（或 VPN）之后。
- `/api/*` 有基于进程内存的简易限流（读 600/分钟、写 120/分钟、导入 12/分钟），只用于兜住失控的重试循环，不是防护措施。
- 响应头包含 CSP、`X-Frame-Options`、`Referrer-Policy` 等基础加固，API 响应统一 `Cache-Control: no-store`。
- 请求体上限为 256 KB，导入接口 8 MB；超出返回 413。
- `/api/export` 会导出全部账目（CSV 已做公式注入转义），请自行保管导出文件。
- 账目支持一键报销：已报销的支出保留在账本里（带「已报销」徽标），但不再计入支出合计、预算消耗与剩余金额；报销可随时撤销。

## Agent 技能

应用自带一份可一键安装的 Agent 技能包，安装后 ZCode 等支持 skills 的 Agent 能直接通过 API 查看和管理账本（查当月开支、记一笔、预算、结算、订阅、导入导出）。技能文件随应用分发，由应用自身在 `/skill/SKILL.md` 提供：

```bash
mkdir -p ~/.agents/skills/rhodium-ledger
curl -fsSL http://127.0.0.1:3030/skill/SKILL.md -o ~/.agents/skills/rhodium-ledger/SKILL.md
```

安装后重启 Agent 会话即可生效。技能源文件在仓库的 `public/skill/SKILL.md`，应用升级时随版本更新，重新执行上面的命令即可刷新。

## 验证

```bash
npm run typecheck
npm run lint
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

以上全部命令都由 `.github/workflows/ci.yml` 在每次 push 与 pull request 上跑一遍，集成测试在 CI 里使用一次性的 postgres service 容器。

应用默认使用人民币、中文界面和 `Asia/Shanghai` 时区。首版是单人本地账本，不包含登录、多人共享、银行同步或多币种。
