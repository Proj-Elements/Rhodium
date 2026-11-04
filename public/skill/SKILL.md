---
name: rhodium-ledger
description: 通过本地 HTTP API 查看并管理「Rhodium」记账应用的开支。凡用户提到记账、记一笔、本月花了多少、开支/支出/收入、预算、固定支出/订阅、月度回顾/结算、分类、导入导出账目等需求，一律使用本技能直接调用 http://127.0.0.1:3030 的 REST API 完成，不要猜测接口格式，也不要让用户手动操作页面。
---

# Rhodium（rhodium-ledger）API

「Rhodium」是单用户个人记账应用，全部能力通过本地 REST API 暴露。本技能让 Agent 能代替用户完成查账、记账、预算、结算、订阅与数据导入导出。

## 0. 连接与自检

所有示例假设 `BASE=http://127.0.0.1:3030`（应用默认端口）。若健康检查失败，先确认端口或让用户启动应用。

```bash
BASE=http://127.0.0.1:3030
curl -fsSL $BASE/api/health        # {"status":"ok","database":"ok"}；503 = 数据库不可达
```

- 无鉴权：应用没有任何登录，且默认只绑定回环地址。不要把地址转发给不可信网络。
- 限流（作用于所有 /api/*，按分钟滑动窗口）：GET/HEAD 600 次、写操作（POST/PATCH/PUT/DELETE）120 次、/api/import* 12 次。超限返回 429 与 `Retry-After` 响应头，等 `Retry-After` 秒后重试。
- 批量写入时把请求间隔开来，避免触顶写限流。

## 1. 核心约定（先读这一节再动手）

| 约定 | 说明 |
|---|---|
| 金额 | 请求体里用「元」的字符串或数字（如 `"12.34"`）；响应里一律是整数「分」`amountCents`。展示时 `amountCents / 100`，格式 ¥12.34。单笔上限 2,000,000,000 分（2 千万元），负数会被拒绝 |
| 日期 | `occurredOn` 必须是 `YYYY-MM-DD`（严格校历，`2025-02-30` 会被 400 拒绝）；月份一律 `YYYY-MM` |
| 时区 | 应用按 `Asia/Shanghai` 计算"今天"与"当月" |
| 错误 | 统一 `{"error": "中文消息", "details?": ...}`。400 参数错误（details 为 zod 字段错误）、404 不存在、409 冲突、413 请求体过大、429 限流 |
| 类型值 | 账目请求用小写 `"expense"`/`"income"`，响应是大写 `"EXPENSE"`/`"INCOME"`；分类类型请求 `expense|income|both`，响应 `EXPENSE|INCOME|BOTH` |
| 删除 | 账目是软删除（保留数据），可用 PATCH `{"restore":true}` 恢复；分类没有删除，用 `{"archived":true}` 停用 |
| 锁定月 | 已结算且未重开的月份是只读的：对其中账目的增删改返回 409「本月已经结算，请先重新打开本月」。先 `POST /api/settlements/{month}/reopen` 解锁 |

## 2. 常用任务

### 2.1 查看当月开支概览（最先用这个）

```bash
curl -fsSL $BASE/api/dashboard            # 当月；?month=2026-09 看指定月
```

关键字段：`expenseCents`/`incomeCents` 当月支出/收入总额；`budget`（`{amountCents}` 或 null）与 `budgetSource`（`month`=本月显式预算 / `preset`=全局预设 / `none`=未设）；`remainingCents` 剩余预算；`usagePercent` 使用率；`focusDateExpenseCents` 当日支出；`categoryBreakdown` 分类排行（按金额降序）；`recentExpenses` 最近 7 天逐日支出；`recentTransactions` 最近 10 笔；`daysElapsed`/`daysInMonth` 已过天数/总天数。

回答"这个月花了多少"时直接读 `expenseCents`，并可用 `categoryBreakdown` 补充最大去向、`dailyAverageCents` 风格信息可用日均（日均 = `expenseCents / daysElapsed`，注意 `daysElapsed` 在当月才小于总天数）。

### 2.2 查某月账目清单

```bash
curl -fsSL "$BASE/api/transactions?month=2026-09"              # 全部
curl -fsSL "$BASE/api/transactions?month=2026-09&type=expense" # 只看支出
```

返回 `{month, readOnly, transactions: TransactionDTO[]}`，按日期倒序。`readOnly=true` 表示该月已结算锁定。

### 2.3 记一笔

先拿分类列表（首次调用会自动播种默认分类）：

```bash
curl -fsSL $BASE/api/categories    # 取 id/name/type；archivedAt 非 null 的分类已停用，不要选用
```

再记账（`type` 决定分类必须能用于支出或收入）：

```bash
curl -fsSL -X POST $BASE/api/transactions -H 'content-type: application/json' \
  -d '{"type":"expense","amount":"24.50","occurredOn":"2026-09-05","categoryId":"<分类id>","note":"午饭"}'
# 201 {"transaction": TransactionDTO}
```

- `note` 可选，≤200 字。金额必须是该分类可用方向的合法金额（非负、不超上限）。
- 不确定分类 id 时，可用 `categoryBreakdown` 或分类列表按名字匹配；找不到合适分类时先建分类（见 2.7）。

### 2.4 修改 / 删除 / 恢复账目

```bash
# 修改（body 必须携带与 POST 相同的全部字段：type/amount/occurredOn/categoryId，
# note 可省略；不支持只传部分字段的补丁式修改；目标月份锁定会 409）
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' \
  -d '{"type":"expense","amount":"30.00","occurredOn":"2026-09-05","categoryId":"<分类id>","note":"改价"}'

# 删除（软删除）
curl -fsSL -X DELETE $BASE/api/transactions/<id>    # {"id":"...","deleted":true}

# 恢复（只能恢复已软删除的行，否则 409）
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' -d '{"restore":true}'
```

注意：restore 的 body 必须只有 `{"restore":true}`，混入其他字段会被 400 拒绝。已软删除的行不能直接编辑（409），要先 restore。restore 会重新校验分类：分类已被归档或类型不再匹配时返回 400「请选择有效的分类」。

### 2.5 预算

```bash
# 查某月预算（budget=显式月预算；preset=全局预设；effectiveBudgetCents=实际生效值）
curl -fsSL $BASE/api/budgets/2026-09

# 设置本月显式预算
curl -fsSL -X PUT "$BASE/api/budgets/2026-09" -H 'content-type: application/json' -d '{"amount":"3000"}'

# 一次性把本月起 240 个月内都写成显式预算（已结算的月份会被跳过不动）
curl -fsSL -X PUT "$BASE/api/budgets/2026-09?scope=future" -H 'content-type: application/json' -d '{"amount":"3000"}'
# 响应含 monthsSet 与 throughMonth

# 删除某月显式预算（该月回落到预设）
curl -fsSL -X DELETE $BASE/api/budgets/2026-09

# 全局预设（所有没有显式预算的月份的默认值）
curl -fsSL $BASE/api/budgets/preset
curl -fsSL -X PUT $BASE/api/budgets/preset -H 'content-type: application/json' -d '{"amount":"3000"}'
```

### 2.6 月度回顾与结算

```bash
# 单月完整分析：分类排行、单日峰值、逐日日历、订阅支出单列
curl -fsSL $BASE/api/settlements/2026-09          # {"summary": {...}}

# 近 6 个月趋势（含 end 月，旧→新）；?include=focus 额外返回 end 月完整 summary
curl -fsSL "$BASE/api/settlements?end=2026-09&include=focus"
```

summary 字段：`budgetCents`/`budgetSource`/`expenseCents`/`incomeCents`/`remainingCents`、`subscriptionExpenseCents`（订阅产生的支出）、`topCategory`/`topDate`（单日最高）、`dailyBreakdown`（每天 `{date,expenseCents,incomeCents,transactionCount}`）、`dailyAverageCents`、`transactionCount`（全部账目数）、`expenseTransactionCount`（仅支出笔数）、`settlement`（已结算快照或 null）。

结算与重开（**写操作，先向用户确认**）：

```bash
curl -fsSL -X POST $BASE/api/settlements/2026-09/settle   # 快照并锁定该月（未来月份 400）
curl -fsSL -X POST $BASE/api/settlements/2026-09/reopen   # 重新打开；未结算 404，已打开 409
```

### 2.7 分类

```bash
curl -fsSL $BASE/api/categories
curl -fsSL -X POST $BASE/api/categories -H 'content-type: application/json' \
  -d '{"name":"宠物","type":"expense"}'          # type: expense|income|both，名称≤30字
curl -fsSL -X PATCH $BASE/api/categories/<id> -H 'content-type: application/json' -d '{"archived":true}'   # 停用
curl -fsSL -X PATCH $BASE/api/categories/<id> -H 'content-type: application/json' -d '{"name":"餐饮饮食"}'  # 改名
```

系统分类（`isSystem=true`）不能停用。没有 DELETE：停用后的分类不再出现在记账选择里，但历史账目保留。

### 2.8 固定支出（订阅）

```bash
curl -fsSL $BASE/api/subscriptions
curl -fsSL -X POST $BASE/api/subscriptions -H 'content-type: application/json' \
  -d '{"name":"网易云音乐","amount":"15.00","billingDay":8,"categoryId":"<支出分类id>","startMonth":"2026-09"}'
# billingDay 1-31，短月自动取最后一天；endMonth 可选；分类必须是支出类（EXPENSE/BOTH）
curl -fsSL -X PATCH $BASE/api/subscriptions/<id> -H 'content-type: application/json' -d '{"active":false}'  # 暂停（body 只能有 active）
curl -fsSL -X DELETE $BASE/api/subscriptions/<id>   # 已有历史账目时只暂停不删除（响应 archived:true）
curl -fsSL -X POST $BASE/api/subscriptions/sync     # 立刻补记到期的订阅账目 {"created":n,"syncedThrough":"YYYY-MM-DD"}
```

服务端对 sync 有 60 秒去抖，无需频繁调用；增删改订阅或重开月份会使其立即失效重算。

### 2.9 导入 / 导出

```bash
# 导出完整备份（JSON，含全部数据）或账目 CSV
curl -fsSL "$BASE/api/export?format=json" -o backup.json
curl -fsSL "$BASE/api/export?format=csv"  -o transactions.csv

# 先预检（不写库）：返回 total/valid/errors
curl -fsSL -X POST $BASE/api/import/preview -H 'content-type: application/json' -d @import.json

# 导入（同事务；最多 20000 行 / 8MB；rows 可为空数组，只还原 backup 里的分类/订阅/预算/结算）
curl -fsSL -X POST $BASE/api/import -H 'content-type: application/json' -d @import.json   # {"imported": n}
```

导入行字段（中英文键等价）：`occurredOn`/`日期`（YYYY-MM-DD）、`amount`/`金额`（元）或 `amountCents`（分）、`type`/`类型`（`expense`/`income`，也接受 `支出`/`收入`）、`category`/`分类`（按名字匹配，缺省落「其他」）、`note`/`备注`。行内某月已锁定则整个请求 409。

导入合并语义：
- **裸行列表**（无 backup 字段）：一律新插入，行里带的 `id` 会被忽略——不可能覆盖已有账目。因此把导出的 CSV 再导回会重复入账；整体还原请用 JSON 完整备份（带 `backup` 字段）。
- **完整备份**（`backup` 字段 = export 的 JSON）：按自然键合并（分类按 名称+类型，订阅按名称，预算/结算按月份）；账目行带 `id` 时按 id upsert 且保留 createdAt。
- 导入量大或不确定时先打 preview。

## 3. API 速查表

| 方法 + 路径 | 作用 |
|---|---|
| GET /api/health | 健康检查 |
| GET /api/dashboard?month= | 当月/指定月总览 |
| GET /api/transactions?month=&type= | 账目清单（type 可省略） |
| POST /api/transactions | 记账 `{type,amount,occurredOn,categoryId,note?}` → 201 |
| PATCH /api/transactions/{id} | 修改（同 POST 字段）或 `{"restore":true}` 恢复 |
| DELETE /api/transactions/{id} | 软删除 |
| GET /api/budgets/{month} | `{budget,preset,effectiveBudgetCents}` |
| PUT /api/budgets/{month}?scope=month\|future | 设置显式预算（future 含 240 个月） |
| DELETE /api/budgets/{month} | 删除显式预算 |
| GET/PUT /api/budgets/preset | 全局预设预算 `{amount}` |
| GET /api/settlements?end=&include=focus | 近 6 个月趋势 |
| GET /api/settlements/{month} | 单月完整分析 `{summary}` |
| POST /api/settlements/{month}/settle | 结算并锁定（不可逆，需确认） |
| POST /api/settlements/{month}/reopen | 重开已结算月份 |
| GET/POST /api/categories | 列表（自动播种）/ 新建 `{name,type}` → 201 |
| PATCH /api/categories/{id} | 改名 / `{archived}` 停用 |
| GET/POST /api/subscriptions | 列表 / 新建 → 201 |
| PATCH /api/subscriptions/{id} | 修改或 `{"active":bool}` 暂停/恢复 |
| DELETE /api/subscriptions/{id} | 删除或归档（有历史账目时） |
| POST /api/subscriptions/sync | 补记到期订阅 |
| POST /api/import/preview | 导入预检（不写库） |
| POST /api/import | 导入（≤20000 行） |
| GET /api/export?format=json\|csv | 全量备份 / CSV |

## 4. 数据结构

```jsonc
TransactionDTO = {
  id, type: "EXPENSE"|"INCOME", amountCents: number,
  occurredOn: "YYYY-MM-DD", note: string|null,
  category: CategoryDTO, source: "MANUAL"|"SUBSCRIPTION",
  subscriptionId: string|null, subscriptionMonth: "YYYY-MM"|null
}
CategoryDTO = { id, name, type: "EXPENSE"|"INCOME"|"BOTH", isSystem, sortOrder, archivedAt: ISO|null }
SubscriptionDTO = { id, name, amountCents, billingDay, categoryId, category, startMonth: "YYYY-MM", endMonth: "YYYY-MM"|null, active, note }
```

## 5. 行为守则

1. **先读后写**：记账前先 `GET /api/categories` 与 `GET /api/dashboard`，用真实 id 与真实语境回答，不要编造分类或重复记账（改用 PATCH）。
2. **金额换算零失误**：用户说"24块5"→ `amount:"24.50"`；把响应的 `amountCents` 除以 100 再展示，永远不要输出原始分值当金额。
3. **锁定月不动手**：写操作撞上 409「本月已经结算」时，停下来告知用户，询问是否 reopen（reopen 会解除快照保护，属于用户决策）。
4. **结算/重开/删除前确认**：settle、reopen、批量导入会改变或冻结数据，执行前用一句话向用户复述将要做的事。
5. **失败要读 error**：响应体 `error` 是中文人话（如「订阅「X」的分类不存在」），直接转述给用户，不要吞掉。
