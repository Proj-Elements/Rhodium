---
id: rhodium-http-api
type: module-design
status: draft
title: Rhodium HTTP API
parent: rhodium-architecture
---

## Responsibility

同源 JSON HTTP API 是浏览器与本地 Agent 共享的应用入口；唯一 HTML 无关的健康端点另外返回数据库状态。路由承载请求解析、Zod 校验、业务服务调用、Prisma CRUD/事务编排，以及 DTO 序列化，覆盖账目、分类、预算、固定支出、结算、导入导出和订阅同步。

`middleware.ts` 与 Next 配置属于这一公开边界：限制请求速率、提供安全响应头并禁止 API 缓存，但不认证调用者。公开 Agent 技能依托这一接口；端点清单与示例留在技能文档，本模块只维护跨端点的行为契约。

## Boundary

- 只允许服务端依赖：Prisma、Next Route Handler、Zod 与共享领域服务；不得返回未经序列化的数据库行代替稳定的 DTO。
- 可导入明确的客户端安全 DTO/纯函数，不得依赖 React 页面、浏览器状态或 UI 确认来执行授权。
- 错误应答为 `{error, details?}`；应用错误、校验错误、Prisma 冲突/缺失与未知错误有各自状态，不把内部异常直接暴露给客户端。
- 读取或订阅相关变更可触发同步；不能假定仅显式 `/sync` 才生成到期记录。用批量查询与唯一发生键处理重复/并发。
- 改变预算、结算、订阅和恢复状态的编排必须保持 `rhodium-architecture` 的不变量；金额和日期最终解释权属于 `rhodium-ledger-domain`。
- 集成测试必须面向独立、明确标记、回环地址的一次性测试库，不在真实账本上执行写入验证。
