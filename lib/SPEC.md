---
id: rhodium-ledger-domain
type: module-design
status: draft
title: Rhodium Shared Ledger Logic
parent: rhodium-architecture
---

## Responsibility

共享逻辑提供 Rhodium 的计算语言与可复用行为：金钱/日期转换、活跃 DTO 类型、分类颜色/图标、预算解析、财务汇总、订阅计划与去抖、CSV/导入规范化、输入验证、序列化及数据库访问单例。

纯业务计算与其数据库协调显式分开：计划与汇总折叠可独立测试，而预算解析、月份锁读取及订阅同步用它访问持久化。API DTO 与浏览器类型共享私有枚举映射，不让数据库序列化格式直接替代产品契约。

## Boundary

- 可供 UI 和 API 复用的模块必须不引用 `lib/prisma.ts`、Node-only API 或服务器单例；不能以“共享”为由把 Prisma 间接送进客户端包。
- API 专属副作用可依赖 Prisma，但不得反向依赖 HTTP request、路由、React 组件或浏览器状态。
- 一份金额/日历实现是权威；新增代码不得在 UI、路由或导入器中另写不同的舍入、月份或短月规则。
- 默认分类通过进程标记和数据库自然键幂等补充；真实备份的恢复身份不能降级为不受控的任意 ID/对象透传。
- 跨域依赖与历史锁定/订阅/备份规则由 `rhodium-architecture` 统一记录；这里只拥有共享实现与可复用边界。
- 浏览器展示辅助与 CSV 可在客户端运行，但秘密、服务环境变量、数据库凭据和 Prisma 类型只属于服务端边界。
