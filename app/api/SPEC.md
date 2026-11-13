---
id: rhodium-http-api
type: module-design
status: draft
title: Rhodium HTTP API
parent: rhodium-architecture
---

## Responsibility

同源 JSON HTTP API 是浏览器与本地 Agent 共享的应用入口；健康端点另外返回数据库状态。路由承载请求解析、Zod 校验、业务服务调用、Prisma CRUD/事务编排，以及 DTO 序列化，覆盖账目、分类、预算、固定支出、结算、导入导出和订阅同步。

`middleware.ts` 与 Next 配置属于这一公开边界：限制请求速率、提供安全响应头并禁止 API 缓存，但不认证调用者。公开 Agent 技能依托这一接口；端点清单与示例留在技能文档，本模块只维护跨端点的行为契约。

## Boundary

- 只允许服务端依赖：Prisma、Next Route Handler、Zod 与共享领域服务；不得返回未经序列化的数据库行代替稳定的 DTO。
- 可导入明确的客户端安全 DTO/纯函数，不得依赖 React 页面、浏览器状态或 UI 确认来执行授权。
- 错误应答为 `{error, details?}`；应用错误、校验错误、Prisma 冲突/缺失与未知错误有各自状态，不把内部异常直接暴露给客户端。
- 所有 API 请求校验允许的 Host、Origin 和浏览器来源信息；需要请求体的写接口仅接受 `application/json`，本地 CLI 的无 Origin 请求仍遵守 Host 与内容类型约束。允许来源、受信任代理和默认回环范围由显式配置控制。
- 创建交易接受可选 `Idempotency-Key`；同键同内容重放原响应，同键不同内容返回 409。编辑、恢复与报销动作以请求体 `expectedVersion` 校验版本，删除以查询参数携带该版本；过期返回 409。独立动作与完整编辑互斥，不能以混合字段绕过动作语义。
- GET 不隐式创建订阅账目；默认分类列表 GET 初始化默认分类是读取播种例外。显式同步、订阅变更和结算可同步到期计划；用批量查询与唯一发生键处理重复/并发，未知计划历史通过同步结果报告。
- 账目与月份分别通过 `/api/transactions/[id]/history`、`/api/settlements/[month]/history` 提供只读历史查询；账目变更及结算状态的历史写入和对应业务变更处于同一事务。
- 同一报告在 `RepeatableRead` 只读事务中从一个数据库快照读取；已结算月份的预算接口与报告返回相同的结算预算。
- 完整备份恢复与普通新增行导入分别校验，不在请求中重复承载账目；全部实体在同一事务内恢复，闭合结算总额或分类金额与最终明细不一致时返回 409 并回滚。
- 改变预算、结算、订阅和恢复状态的编排必须保持 `rhodium-architecture` 的不变量；金额和日期最终解释权属于 `rhodium-ledger-domain`。
- 集成测试必须面向独立、明确标记、回环地址的一次性测试库，不在真实账本上执行写入验证。
- 订阅创建也支持按资源隔离的幂等键；订阅与分类 PATCH、订阅 DELETE 要求已读 `expectedVersion`，重开要求结算 `revision`。预算 GET 返回本月、未来范围和预设摘要，写入须携带对应 `expectedVersion`。不能无条件覆盖旧页面提交。
- 两种历史接口接受 `limit`（默认 50、最多 200）和 `cursor`（上页最后版本/修订），返回 `history` 与 `nextCursor`。游标为空表示读取完毕。
- 预检和正式导入共享分类/订阅引用解析，显式坏引用拒绝，未知普通分类按原名创建；摘要包含 `budgetPreset.create/update/delete`。完整恢复拒绝未来关闭结算、订阅收入及最新历史与实体矛盾的备份。
- 全量导出在同一快照中分页查询、分块编码；CSV 仅读取账目及分类名。服务端调度通过领域同步执行，GET 仍不隐式补账；重开在同一事务内补齐目标月。写锁等待超过 3 秒返回 409。
