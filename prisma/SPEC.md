---
id: rhodium-persistence
type: module-design
status: draft
title: Rhodium PostgreSQL Persistence
parent: rhodium-architecture
---

## Responsibility

PostgreSQL 与 Prisma 是账本权威状态：分类、账目、固定支出计划、显式/默认预算和月度结算。schema 与顺序迁移共同管理结构；应用启动部署迁移，持久卷承载实际数据。

关系保留历史：账目引用分类，订阅生成的账目可引用来源计划。分类名称与类型构成自然唯一键；结算和显式预算按月份唯一；订阅账目另有唯一发生键。读相关索引优先匹配软删除过滤、日期/类型汇总和外键访问。

## Boundary

- 仅服务端通过 Prisma 访问；浏览器不得获取连接串或直接查询数据库。
- 业务事务由 API/领域服务持有，导入等多步写入以一个数据库事务保证原子性；schema 本身不伪装成月份锁或订阅有效期的完整实现。
- `DELETE` 不代替领域软删除/停用规则；数据库约束与索引变更须有可部署迁移，不手工漂移生产 schema。
- 时间戳保留事件发生与修改信息，业务日期使用 `DATE`；货币始终是整数分，税前预算剩余可接受负值而原始金额非负。
- 结算快照和结算状态在同一聚合内保存，不能只保存锁而丢失当时的财务数值。
- 测试库与真实库严格分开；集成测试必须有回环连接、明确测试数据库名称、`public` schema、独立 `TEST_DATABASE_URL` 和显式一次性标记，清理业务表前重新核对身份。
