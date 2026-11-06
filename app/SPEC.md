---
id: rhodium-web-ui
type: module-design
status: draft
title: Rhodium Browser Experience
parent: rhodium-architecture
---

## Responsibility

浏览器应用覆盖总览、收支明细、固定支出、月度回顾和设置五种工作区，以及共用导航、记账/订阅表单与设置偏好。`app` 与 `components` 共同构成这一模块。

页面把月份、编辑目标、筛选和表单暂态留在客户端，使用同源 API 读取/变更账本。不可用请求需要可恢复的错误反馈；保存期间防止重复提交或误关闭；危险操作保留确认/取消路径。失效的请求不能覆盖新选择的状态。

体验使用 HeroUI v3 / HeroUI Pro，以暖白与松绿的语义 token 同时支持亮暗主题。字体与图标本地托管。分类颜色与图标在同一账本中有稳定身份，弹窗由组件库管理焦点，移动端以可用空间重排而非假设桌面宽度。

## Boundary

- 可以依赖 React、HeroUI、共享客户端取数器和纯客户端领域/格式化工具；API 与持久化边界见 `rhodium-http-api`、`rhodium-persistence`。
- 不得导入 Prisma、服务器路由实现、Node-only 模块或 `DATABASE_URL`。
- 表单校验是反馈而非安全保证；金额、分类适用性及月份写入权限以 API 为准。
- 本地持久化仅保存非敏感的输入日期与主题偏好，沿用历史 `yueyu-*` 键；存储不可用不得破坏记账。
- 不自行实现第二套订阅业务或月份锁定规则；可展示服务端报告的状态，不能凭浏览器状态放行写入。
- 所有视觉行为改变须有针对性合同检查与真实渲染检查；当前没有自动浏览器 E2E，不能把人工设计记录视作持续回归保护。
