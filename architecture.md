---
id: rhodium-architecture
type: architecture-design
status: draft
title: Rhodium System Architecture
parent: rhodium-product
---

## Drivers

产品范围与非目标由 `rhodium-product` 定义。架构优先保证账本的日期、金额、身份、月份锁定和恢复语义，其次优化个人账本在桌面与手机上的直接操作。单用户不等同于可以多实例部署。

## Decisions

### Topology

一个 Next.js 15 应用承载 React 19 浏览器页面、同源 Route Handlers 和中间件，通过 Prisma 访问 PostgreSQL。Docker 分别运行应用与数据库，启动时应用迁移并在持久卷中保存数据。没有独立后台 worker 或外部银行服务。

- `rhodium-web-ui` → `rhodium-http-api`：页面通过同源 HTTP 读写账本，不直接访问数据库。共享仅限明确客户端安全的纯函数与 DTO。
- `rhodium-http-api` → `rhodium-ledger-domain`：路由复用金钱/日历规则、输入 schema、预算解析、汇总和订阅计划，不另建相互漂移的规则。
- `rhodium-http-api` → `rhodium-persistence`：路由处理 CRUD、事务和恢复编排；也在业务不变量下直接使用 Prisma。
- `rhodium-ledger-domain` → `rhodium-persistence`：有副作用的服务使用 Prisma；纯函数不得因此变成数据库依赖。
- `rhodium-ledger-domain` 与 UI 中的展示辅助共享日期、金额、CSV 与类型定义；这些模块必须保持浏览器可执行，不能带入 Prisma。

### Ledger and time

财务金额以分为单位。`occurredOn`、月份开始/结束及订阅发生月份是 PostgreSQL `DATE`，在应用内用月初/当日 UTC 午夜承载；这不是把业务日期换成用户本地时刻。今天以 `Asia/Shanghai` 决定，日历区间采用半开月份范围。金额转换集中处理浮点边界。

### Stateful monthly history

显式月预算优先于默认预设。未来预算功能只生成起始月起 240 个月的显式预算，跳过锁定月份，避免无界覆盖。结算前同步到期订阅；锁定后月度总额读快照。已结算不允许位于未来；重新打开解除写入限制并恢复实时汇总。已有历史引用的订阅不能硬删除。

### Data portability

JSON 完整备份涵盖分类、默认/月度预算、订阅、账目（含软删除）和结算。分类按名称与类型合并，订阅和账目按受验证的稳定 ID 恢复；订阅名不是唯一键。恢复重建订阅发生键，不能与另一订阅或另一月份拼接历史身份。裸 CSV/JSON 行列表仅新增，不覆盖既有账目，因而不能作为去重备份。

导入先完成预检/全请求验证，再以单数据库事务写入。任何受影响的锁定月份都在写入前拒绝；一般请求体上限 256 KB，导入上限 8 MB、20,000 行。CSV 导出中和电子表格公式前缀。

### Security and deployment

API 没有身份信息或所有权概念。回环端口绑定、外部认证反向代理或 VPN 是访问控制边界。进程内限流仅约束失控请求，安全响应头与 `Cache-Control: no-store` 不能防止已获访问权的用户读取或清空账本。

同步去抖、默认分类播种标记和限流计数均在单个 Node.js 进程内，不能视为跨实例协调。订阅同步以稳定的数据库发生键去重，而不是依靠冷却窗口保证正确性。

生产容器以非 root 用户运行；HeroUI Pro 凭据只通过构建期 secret 使用，不得进入源码、镜像参数或运行环境。重命名产品不迁移旧数据库、卷名或浏览器偏好键。

## Invariants

- 浏览器的账本变更经过 HTTP 与输入校验；不能把 Prisma 或服务器单例打包进客户端。
- 非负金额、日期合法性、分类方向和停用状态由服务端强制，不能仅靠表单。
- 活跃汇总排除软删除账目；归档分类可以保留历史显示、过滤和完整备份恢复。
- 订阅账目用 `(subscriptionId, month)` 编码的唯一发生键去重，短月将记录日钳制在真实日历日内。
- 所有改变订阅计划的写操作和月份重开必须失效进程内同步冷却；并发或失败不能留下永久错误缓存。
- 锁定保护覆盖普通写入、移动账目与导入的目标/源月份；批量未来的预算跳过锁定月。
- Prisma schema、迁移和公开 DTO 的映射共同定义持久化契约；禁止不经迁移修改真实数据结构。
- 无头浏览器 E2E 尚未自动化。**未确认现状：** 现有文档仅记录人工浏览器验收和纯函数/数据库集成测试，未发现浏览器测试配置。
- 2026-11-06 的 `npm audit` 报告 12 项（4 high、8 moderate），涵盖 Zod、HeroUI Pro 安装链的 figlet 及开发工具。**用户确认记录这些剩余风险。** 这是一份时间点观察而非永久版本清单；升级必须单独兼容验证，不能将本地部署解释成漏洞已修复。

## Supporting documents

用户确认不直接采纳现有文档。README 继续说明运行与安全边界；`public/skill/SKILL.md` 是随应用分发的 Agent 接口使用说明；`docs/frontend-redesign.md` 为历史设计/验收输入；`docs/cursor-design-analysis.md` 是另一产品的参考资料。它们不是这个图谱中已审阅的架构决策。
