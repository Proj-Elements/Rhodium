# Rhodium

面向大学生的个人记账 Web 应用：记录日常支出、设置月度预算、管理固定订阅、一键报销，并在月底回顾本月余量。

前端采用 HeroUI v3 / HeroUI Pro 的暖白与松绿主题，支持移动端和亮暗模式。设计说明与历史验收记录见 [`docs/frontend-redesign.md`](docs/frontend-redesign.md)。

产品显示名称为 Rhodium。数据库、Docker 数据卷和浏览器偏好的旧标识保持不变，改名不会创建新账本或清空已有设置。

## 本地开发

构建和测试使用受支持的 Node.js 22（至少 22.12；CI / Docker 固定为 22.23.4）。锁定的 Vitest 5 不支持旧的 Node.js 20。

```bash
npm ci --ignore-scripts
# 在当前 shell 设置 HEROUI_KEY 后初始化锁定的组件版本
node node_modules/hpsetup/bin.js react --auto
npx prisma generate
cp .env.example .env
# 编辑 .env，设置 POSTGRES_PASSWORD 和对应的本地 DATABASE_URL
# 本地 DATABASE_URL 中的密码需进行 URL 编码；Compose 会自动编码原始密码
docker compose up -d db
npx prisma migrate deploy
npm run dev
```

打开 <http://127.0.0.1:3030>。

## Docker 部署

```bash
docker compose up -d --build
```

当前界面使用 HeroUI Pro 组件。Docker 构建前需在当前 shell 设置 `HEROUI_KEY`（从 HeroUI Pro 获取），不要把它写进仓库或 `.env`。Compose 会通过 BuildKit secret 将其仅传给锁文件中的 `hpsetup@4.7.4`；工具及其传递依赖均由 `npm ci` 安装，不再用构建时的 `npx` 临时下载。密钥不作为构建参数或镜像环境变量保存。不要提交或发送 key。本地首次安装后也需运行上述初始化命令，密钥同样通过环境变量提供。

应用容器会在启动时自动执行 Prisma migrations。PostgreSQL 数据保存在 `yueyu-postgres` named volume 中。健康检查探针为 `GET /api/health`。

用预构建镜像离线部署见 [`Docker/README.md`](Docker/README.md)。

### 安全默认值

本应用**不含任何登录与鉴权**，因此 compose 默认把两个端口都绑在回环地址上：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `APP_BIND` | `127.0.0.1` | 应用 3030 端口的绑定地址 |
| `DB_BIND` | `127.0.0.1` | Postgres 5432 端口的绑定地址 |
| `POSTGRES_PASSWORD` | `yueyu_password` | 数据库原始口令，供 Postgres 初始化和应用连接使用 |
| `RHODIUM_ALLOWED_HOSTS` | 仅本机地址 | 允许访问应用的主机名或 `主机:端口`，多个值用逗号分隔 |
| `RHODIUM_ALLOWED_ORIGINS` | 请求主机的同源地址 | 额外允许的精确来源地址，多个值用逗号分隔 |
| `RHODIUM_TRUST_PROXY` | `false` | 是否信任代理转发的客户端地址；仅在可信代理覆盖这些头时启用 |

确认所在网络可信后再对外暴露，并务必覆盖默认口令：

```bash
POSTGRES_PASSWORD='强口令' APP_BIND=0.0.0.0 RHODIUM_ALLOWED_HOSTS=ledger.example.com docker compose up -d --build
```

`POSTGRES_PASSWORD` 只在**首次**创建数据卷时用于初始化数据库；之后修改需同时更新数据库中的角色口令。

反向代理需保留原始 `Host`。`RHODIUM_ALLOWED_ORIGINS` 只用于同一主机和端口的外部 TLS 来源差异，不能允许其他站点访问。启用 `RHODIUM_TRUST_PROXY=true` 时，应用只能由单个可信边缘代理连接，并由该代理覆盖整列 `X-Forwarded-For` 为一个已验证的客户端 IP；包含逗号链或无效地址的请求共用默认限流桶。

Compose 分别传递数据库地址、用户、库名和原始密码，应用容器入口会进行 URL 编码后生成连接串，密码包含 `#`、`@`、`:` 等字符也不会破坏连接。独立运行容器时可直接提供已编码的 `DATABASE_URL`，其优先于分开的 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`。本地 Prisma CLI 仍从 `.env` 读取 `DATABASE_URL`。应用进程以非 root 的 `node` 用户运行。

`yueyu` 数据库名、数据库用户名和 `yueyu-postgres` 卷标识用于兼容已有部署。升级时保持原 Compose 项目名和卷挂载；在新目录启动 Compose 前，先按 [`Docker/README.md`](Docker/README.md) 指定已有卷，避免连接到新空卷。

## 安全边界

**这是单人本地账本，服务端没有任何登录或鉴权：任何能访问端口的人都能读写、导出、清空全部账目。**

- 不要把 `3030` 或 `5432` 暴露到公网或不受信任的局域网；如需远程访问，请放在带认证的反向代理（或 VPN）之后。
- `/api/*` 使用进程内固定窗口限流（读 600/分钟、写 120/分钟、导入 12/分钟），重启会重置计数，多实例不共享额度。默认不信任请求里的转发地址；它只用于限制失控的请求循环，不能代替认证。
- API 校验允许的 Host 和浏览器来源，拒绝跨站访问，失败返回 403。携带 JSON 的写请求必须使用 `Content-Type: application/json`，否则返回 415；本机 Agent / CLI 可不带 `Origin`。额外允许的来源只能处理可信代理转发导致的来源差异，不能放开浏览器的跨站请求。允许 Host 或来源不等于身份认证。
- 响应头包含 CSP、`X-Frame-Options`、`Referrer-Policy` 等基础加固，API 响应统一 `Cache-Control: no-store`。
- 普通请求体上限为 256 KiB，导入接口为 64 MiB，均按实际 UTF-8 字节数限制；超出返回 413。
- `/api/export` 会导出全部账目（CSV 已做公式注入转义），请自行保管导出文件。
- JSON 备份包含默认预算、月度预算、分类、订阅及其暂停和价格历史。恢复时分类按名称/类型合并，订阅与账目按稳定 ID 恢复，不会把同名订阅合成一个；历史账目保留归档分类。旧备份缺少默认预算字段时保留当前设置，显式 `budgetPreset: null` 表示恢复为未设置。
- 完整恢复只发送 `{backup: 备份对象}`，在一个事务中合并全部账目和元数据，最后校验并应用结算快照。已有锁定月份需先重新打开；合并后账目与关闭快照不一致时返回 409，全部回滚。先通过预检查看新增、覆盖和冲突摘要。完整备份每类实体最多 100,000 条，超出 64 MiB 时使用数据库备份，不能拆批绕开一致性检查。
- 账目支持一键报销：已报销支出保留账面金额，但不再消耗预算。仪表盘以自付额展示支出，月度回顾另列账面支出与自付额；备注和分类编辑保留报销，修改已报销账目的金额、日期或方向前需显式撤销报销。
- 新建账目和订阅支持 `Idempotency-Key`。请求结果不确定时用同一键和同一内容重试，服务端返回原始创建结果；账目、订阅、分类编辑及结算重开通过 `version` / `expectedVersion` 拒绝过期写入，预算使用 GET 返回的状态摘要。调用示例见公开 API 技能。
- 常驻服务启动及每轮完成 60 秒后自动同步订阅，无需打开浏览器。历史补记按每订阅最多 12 个月一事务推进，保存进度，失败后可重试；普通写入等锁超过 3 秒返回可重试的 409。重开月份会原子补齐该月到期支出。
- 交易和结算历史均可在界面查看，接口默认每页 50 条、最多 200 条，通过 `nextCursor` 继续查询。旧数据缺少历史时不能据此推断它从未被修改。
- 导入预检明确显示默认预算的新增、修改或删除；第三方分类不存在时按原名称新建，显式错误分类 ID 和失效订阅引用会被拒绝。恢复不接受未来关闭结算、收入类型的订阅发生记录或与当前实体矛盾的最新历史。JSON/CSV 导出分批查询并编码，CSV 仅读取账目及分类名。

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

`npm test` 运行无需数据库的单元、组件与路由测试。Node 脚本的测试单独执行 `node --test scripts/*.test.mjs`；数据库集成测试使用下面的独立入口。

普通后端变更可用 `npx tsc --noEmit --project tsconfig.server.json` 检查服务端类型，无需初始化授权 UI。完整 `npm run typecheck` 和生产构建需要先完成 HeroUI Pro 初始化。

需要数据库的集成测试（预算继承、结算快照、订阅同步、接口回归）单独运行，先准备一个**可以被清空**的库：

```bash
docker run -d --name rhodium-test-db -e POSTGRES_USER=rhodium -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=rhodium_test -p 127.0.0.1:55433:5432 postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
# 等待 pg_isready 成功；仅为上面刚创建的空测试库设置允许清空标记。
docker exec rhodium-test-db psql -U rhodium -d rhodium_test -c "COMMENT ON DATABASE rhodium_test IS 'rhodium:test-database';"
export TEST_DATABASE_URL="postgresql://rhodium:testpw@127.0.0.1:55433/rhodium_test?schema=public"
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
npm run test:db -- tests/integration/budget.test.ts
```

集成测试会 `TRUNCATE` 所有业务表，**不要指向真实数据库**。必须显式设置 `TEST_DATABASE_URL`，不再回退到普通 `DATABASE_URL`；仅接受回环地址、`public` schema 和以 `_test` / `_test_<标识>` 结尾的库名。每次清空前还会核对实际数据库、用户、schema 及上述数据库注释标记。不要为了运行测试给真实账本添加此标记。日常修复只指定受影响测试文件，不重复执行全量测试。

`.github/workflows/ci.yml` 对普通分支 push、pull request 和合并队列选择受影响的静态检查、单元测试与必要的数据库/构建/容器检查。整体门禁仅由新版本标签推送触发。数据库检查使用带清空标记的一次性 Postgres 服务；后端类型检查不依赖授权 UI，UI 的检查不把 `HEROUI_KEY` 交给 PR 或队列代码。

字体变更会检查文件结构和 CSS 引用并执行授权构建；公开 Agent 技能变更会校验路由表、并发版本、幂等和历史分页契约。数据库迁移包含财务 CHECK 约束及包含搜索的 trigram 索引；升级遇到已有非法数据会拒绝迁移，应先备份并修正数据，不能跳过约束。应用使用常驻 Node.js/Docker 运行，休眠或按请求启动的 serverless 环境不保证后台调度；测试可设置 `RHODIUM_DISABLE_SCHEDULER=true` 禁用调度。

分支 push 初始化授权组件并保存 14 天构建产物。UI PR 仅使用本仓库、同一 CI 工作流成功 push，且来源为默认分支或当前 PR 精确 head SHA、锁文件 SHA256 完全匹配的组件产物；合并队列仅接受默认分支产物。缺少匹配产物时检查会明确失败，需要先完成相应 push。容器或任一 Compose 文件变更时，push 构建并启动容器，直接使用其中的生产构建；PR / 合并队列检查 Compose 配置并执行 Next.js 生产构建，不接收构建密钥。

应用默认使用人民币、中文界面和 `Asia/Shanghai` 时区。首版是单人本地账本，不包含登录、多人共享、银行同步或多币种。
