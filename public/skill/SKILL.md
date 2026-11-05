---
name: rhodium-ledger
description: 查询与管理「Rhodium」本地个人记账应用的账本：查开支与预算使用、记/改/删账目、维护固定支出（订阅）自动记账、月度结算与回顾、导出备份与导入还原。凡用户提到记账相关的事——记一笔、这个月/某月花了多少、预算还剩多少、订阅或会员扣费、月底结算或关账、分类、导入导出账本——即使用户没有提「Rhodium」或应用名，也应使用本技能，直接调用 http://127.0.0.1:3030 的本地 REST API 完成任务；不要凭记忆改用其他请求格式，也不要让用户手动去页面操作。
---

# Rhodium（rhodium-ledger）记账 API

「Rhodium」是单用户、无登录的个人记账应用，全部能力通过本地 REST API 暴露。工作方式：连接自检 → 用路由表选接口 → 照抄本文示例改参数执行 → 按「错误应对」处理异常。

## 0. 连接自检（会话开始时跑一次）

```bash
BASE=http://127.0.0.1:3030        # 应用默认端口
curl -fsSL $BASE/api/health       # 正常返回 {"status":"ok","database":"ok"}
```

- 503 = 应用活着但数据库不可达；连接失败 = 应用没启动或端口不同，让用户启动应用。自检一次即可，之后不要轮询。
- 无鉴权：应用没有任何登录保护，只应绑定回环地址使用，不要把地址转发给不可信网络。
- 限流（按分钟滑动窗口）：读 600 次、写 120 次、`/api/import*` 12 次。触发返回 429 与 `Retry-After` 响应头，等那么多秒再重试；批量写入时把请求间隔开。

## 1. 动手前先记住四条硬规则

1. **金额方向相反**：请求体用「元」的字符串或数字（如 `"24.50"`）；响应里的 `amountCents` 一律是整数「分」——展示给用户前必须除以 100 格式化成 ¥24.50，永远不要把分值原样当金额播报。单笔上限 2,000,000,000 分（两千万元），负数会被 400 拒绝。
2. **日期是严格日历**：`occurredOn` 必须 `YYYY-MM-DD`（`2025-02-30` 会被 400 拒绝）；月份一律 `YYYY-MM`；「今天 / 当月」按 `Asia/Shanghai` 计算。
3. **请求小写、响应大写**：账目类型请求传 `"expense"`/`"income"`，响应是 `"EXPENSE"`/`"INCOME"`；分类类型请求 `expense|income|both`，响应 `EXPENSE|INCOME|BOTH`。
4. **已结算月份只读**：对锁定月份的账目做任何写操作都会 409「本月已经结算，请先重新打开本月」。不要擅自解锁——停下询问用户，得到同意后再 `POST /api/settlements/{month}/reopen`（解除快照保护是用户的决策）。

其余约定：账目是软删除（`DELETE` 后数据仍在，可 PATCH `{"restore":true}` 恢复）；分类没有删除，用 `{"archived":true}` 停用，停用后不再出现在记账选择里但历史账目保留；支出一键报销用 PATCH `{"reimburse":true}`（响应带 `reimbursedAt`）——仪表盘的 `expenseCents`/`outOfPocketCents` 不含已报销支出，月度回顾的 `expenseCents` 保留账面全额、`outOfPocketCents` 才是自付额，预算与剩余按自付额计算；`reimbursedCents`/`reimbursedCount` 单列报销。报销是会计事实，可用 `{"unreimburse":true}` 撤销；完整编辑（PATCH 全部字段）也会撤销报销，删除/恢复与 JSON 备份还原保留报销状态。

## 2. 任务路由：什么问题打哪个接口

| 用户想问 / 想做 | 调用 | 详见 |
|---|---|---|
| 这个月花了多少、预算还剩多少、钱去哪了 | `GET /api/dashboard` | §3.1 |
| 某月的账目清单 | `GET /api/transactions?month=` | §3.2 |
| 记一笔 | `GET /api/categories` → `POST /api/transactions` | §3.3 |
| 改金额 / 删掉 / 误删找回 | `PATCH` / `DELETE` `/api/transactions/{id}` | §3.4 |
| 设预算（本月 / 往后全部 / 全局默认） | `PUT` `/api/budgets/...` | §3.5 |
| 月度回顾、关账、重开 | `GET` / `POST` `/api/settlements/...` | §3.6 |
| 会员、房租等每月自动记账 | `/api/subscriptions` | §3.7 |
| 备份、换机迁移、批量导入 | `/api/export`、`/api/import*` | §3.8 |
| 新建 / 改名 / 停用分类 | `/api/categories` | §3.9 |

## 3. 常用任务示例

### 3.1 当月开支概览（回答"花了多少"先打这个）

```bash
curl -fsSL $BASE/api/dashboard            # 当月；?month=2026-09 看指定月
```

按问题读字段：

- 花了多少 → `expenseCents` / `incomeCents`（记得除以 100）。
- 有报销 → `reimbursedCents` / `reimbursedCount` 是已报销金额与笔数，已从 `expenseCents` 与预算口径中排除；报销可随时撤销（见 §3.4）。
- 预算够不够 → `remainingCents`、`usagePercent`；`budget`（`{amountCents}` 或 null）配合 `budgetSource`：`month`=本月显式预算、`preset`=全局预设兜底、`none`=未设预算。
- 钱花在哪 → `categoryBreakdown`（分类排行，按金额降序，不含报销）。
- 近期走势 → `recentExpenses` 最近 7 天逐日支出（不含报销）；日均 = `expenseCents / daysElapsed`（`daysElapsed`/`daysInMonth` 为已过/总天数，只有当月 `daysElapsed` 小于总天数）。
- 刚花了什么 → `recentTransactions` 最近 10 笔；`focusDateExpenseCents` 当日支出。

### 3.2 查某月账目清单

```bash
curl -fsSL "$BASE/api/transactions?month=2026-09"              # 全部
curl -fsSL "$BASE/api/transactions?month=2026-09&type=expense" # 只看支出
```

返回 `{month, readOnly, transactions: TransactionDTO[]}`，按日期倒序。`readOnly=true` 表示该月已结算锁定。

### 3.3 记一笔

```bash
# 第 1 步：拿分类（首次调用会自动播种默认分类）。archivedAt 非 null 的已停用，不要选
curl -fsSL $BASE/api/categories

# 第 2 步：写入。type 决定 categoryId 必须是可用于该方向的分类
curl -fsSL -X POST $BASE/api/transactions -H 'content-type: application/json' \
  -d '{"type":"expense","amount":"24.50","occurredOn":"2026-09-05","categoryId":"<分类id>","note":"午饭"}'
# 201 {"transaction": TransactionDTO}
```

完整示例——用户说「午饭 24 块 5」：查分类列表按名字匹配到「餐饮」的 id（匹配不到合适的就先建，见 §3.9），执行上面的 POST（`amount:"24.50"`，`occurredOn` 用上海时区的今天），然后照这样汇报：「已记：餐饮 ¥24.50（09-05），本月共支出 ¥xxxx.xx」。`note` 可选、≤200 字。

POST 没有幂等键：如果请求超时或结果不确定，先 `GET /api/transactions?month=` 查一遍再决定重试，避免重复入账。

### 3.4 修改 / 删除 / 恢复账目

```bash
# 修改：body 必须携带与 POST 相同的全部字段（note 可省略），不支持只传部分字段的补丁
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' \
  -d '{"type":"expense","amount":"30.00","occurredOn":"2026-09-05","categoryId":"<分类id>","note":"改价"}'

# 删除（软删除）
curl -fsSL -X DELETE $BASE/api/transactions/<id>    # {"id":"...","deleted":true}

# 恢复（仅限已软删除的行，否则 409）
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' -d '{"restore":true}'

# 报销（仅支出；已删除行 409「这条账目已被删除，无法报销」；收入行 409「只有支出才能标记报销」）
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' -d '{"reimburse":true}'
# 撤销报销：仅清空时间戳，不改金额、日期、分类；完整编辑也会撤销报销
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' -d '{"unreimburse":true}'
```

三个边角行为：restore 的 body 必须只有 `{"restore":true}`，混入其他字段 400；已软删除的行不能直接编辑（409），先 restore；restore 会重新校验分类，分类已归档或类型不匹配时 400「请选择有效的分类」。

报销与撤销报销的 body 分别只能有 `{"reimburse":true}` 或 `{"unreimburse":true}`（混入其他操作或完整编辑字段也会 400）；重复操作幂等返回 200。两种操作都只允许未删除、未锁定月份内的支出，收入或已删除行返回 409；不存在的 id 返回 404。

### 3.5 预算

```bash
# 查某月预算：budget=显式月预算，preset=全局预设，effectiveBudgetCents=实际生效值
curl -fsSL $BASE/api/budgets/2026-09

# 设本月显式预算
curl -fsSL -X PUT "$BASE/api/budgets/2026-09" -H 'content-type: application/json' -d '{"amount":"3000"}'

# 从本月起一次性写 240 个月的显式预算（已结算月份自动跳过不动）
curl -fsSL -X PUT "$BASE/api/budgets/2026-09?scope=future" -H 'content-type: application/json' -d '{"amount":"3000"}'
# 响应含 monthsSet 与 throughMonth

# 删某月显式预算（该月回落到 preset）
curl -fsSL -X DELETE $BASE/api/budgets/2026-09

# 全局预设：所有没有显式预算的月份的默认值
curl -fsSL $BASE/api/budgets/preset
curl -fsSL -X PUT $BASE/api/budgets/preset -H 'content-type: application/json' -d '{"amount":"3000"}'
```

### 3.6 月度回顾与结算

```bash
# 单月完整分析：分类排行、单日峰值、逐日日历、订阅支出单列
curl -fsSL $BASE/api/settlements/2026-09          # {"summary": {...}}

# 近 6 个月趋势（含 end 月，旧→新）；?include=focus 额外返回 end 月完整 summary
curl -fsSL "$BASE/api/settlements?end=2026-09&include=focus"
```

summary 字段：`budgetCents`/`budgetSource`/`expenseCents`（账面支出，含报销）/`outOfPocketCents`（自付额）/`reimbursedCents`/`reimbursedCount`/`incomeCents`/`remainingCents`（预算减自付额）、`subscriptionExpenseCents`（订阅产生的支出）、`topCategory`/`topDate`（单日最高，按账面全额）、`dailyBreakdown`（每天 `{date,expenseCents,incomeCents,transactionCount}`）、`dailyAverageCents`（自付额日均）、`transactionCount`（全部账目数）、`expenseTransactionCount`（仅支出笔数）、`settlement`（已结算快照或 null）。

结算与重开是冻结/解除冻结数据的操作，**执行前用一句话向用户复述要做的事**：

```bash
curl -fsSL -X POST $BASE/api/settlements/2026-09/settle   # 快照并锁定该月（未来月份 400）
curl -fsSL -X POST $BASE/api/settlements/2026-09/reopen   # 重新打开；未结算 404，已打开 409
```

### 3.7 固定支出（订阅）

```bash
curl -fsSL $BASE/api/subscriptions
curl -fsSL -X POST $BASE/api/subscriptions -H 'content-type: application/json' \
  -d '{"name":"网易云音乐","amount":"15.00","billingDay":8,"categoryId":"<支出分类id>","startMonth":"2026-09"}'
# billingDay 1-31，短月自动取当月最后一天；endMonth 可选；分类必须可用于支出（EXPENSE/BOTH）

# 修改：二选一——发与 POST 相同形态的完整字段，或只发 {"active":true|false} 暂停/恢复（这种 body 不能混入其他字段）
curl -fsSL -X PATCH $BASE/api/subscriptions/<id> -H 'content-type: application/json' -d '{"active":false}'

# 删除：已有历史账目时只暂停不真删（响应 archived:true），避免账目失去关联
curl -fsSL -X DELETE $BASE/api/subscriptions/<id>

# 立刻补记到期的订阅账目（通常不用手动调，页面访问会自动触发；补录历史时显式调一次）
curl -fsSL -X POST $BASE/api/subscriptions/sync     # {"created":n,"syncedThrough":"YYYY-MM-DD"}
```

服务端对 sync 有 60 秒去抖缓存，重复调用直接返回上次结果；增删改订阅或重开月份会使缓存立即失效。

### 3.8 导入 / 导出

```bash
# 导出：JSON 完整备份（含全部分类/预算/订阅/结算）或账目 CSV
curl -fsSL "$BASE/api/export?format=json" -o backup.json
curl -fsSL "$BASE/api/export?format=csv"  -o transactions.csv

# 导入前先预检（不写库）：返回 total/valid/errors
curl -fsSL -X POST $BASE/api/import/preview -H 'content-type: application/json' -d @import.json

# 导入（同事务、要么全成要么全不动；≤20000 行 / 8MB；rows 可为空数组，只还原 backup 里的分类/订阅/预算/结算）
curl -fsSL -X POST $BASE/api/import -H 'content-type: application/json' -d @import.json   # {"imported": n}
```

导入行字段（中英文键等价）：`occurredOn`/`日期`（YYYY-MM-DD）、`amount`/`金额`（元）或 `amountCents`（分）、`type`/`类型`（`expense`/`income`，也接受 `支出`/`收入`）、`category`/`分类`（按名字匹配，缺省落「其他」）、`note`/`备注`。任何一行落在已锁定月份则整个请求 409。

合并语义决定选哪种格式，别弄错：

- **裸行列表**（无 `backup` 字段）：一律新插入，行内 `id` 被忽略，不可能覆盖已有账目。所以把导出的 CSV 再导回去就是重复入账；提示用户，整体还原要用 JSON 完整备份。
- **完整备份**（`backup` 字段 = export 的 JSON）：按自然键合并（分类按 名称+类型，订阅按名称，预算/结算按月份）；账目行带 `id` 时按 id upsert 且保留 createdAt。
- 行多或没把握时永远先打 preview；用完整备份还原整本账之前向用户确认。

### 3.9 分类

```bash
curl -fsSL $BASE/api/categories
curl -fsSL -X POST $BASE/api/categories -H 'content-type: application/json' \
  -d '{"name":"宠物","type":"expense"}'          # type: expense|income|both，名称≤30字
curl -fsSL -X PATCH $BASE/api/categories/<id> -H 'content-type: application/json' -d '{"archived":true}'   # 停用
curl -fsSL -X PATCH $BASE/api/categories/<id> -H 'content-type: application/json' -d '{"name":"餐饮饮食"}'  # 改名
```

系统分类（`isSystem=true`）不能停用；没有 DELETE（见 §1 末尾约定）。

## 4. 错误应对

错误统一 `{"error": "中文消息", "details?": ...}`。`error` 是给用户看的中文人话（如「订阅「X」的分类不存在」），直接转述，不要吞掉。

| 状态码 | 含义 | 怎么办 |
|---|---|---|
| 400 | 参数不合法（`details` 是字段级错误） | 按 details 改字段重试；常见：日期非法、金额为负或超限、分类方向不匹配 |
| 404 | id 或月份不存在 | 先 GET 列表核对真实 id，不要猜 |
| 409 | 冲突：月份已锁定 / 编辑软删除行 / restore 未删除行 / 名称重复 / 分类仍被账目引用 | 锁定月→询问用户是否 reopen；软删除行→先 `{"restore":true}`；其余把 error 原话反馈给用户 |
| 413 | 请求体过大 | 导入切批（单次 ≤20000 行 / 8MB） |
| 429 | 限流 | 等响应头 `Retry-After` 秒数后重试 |

## 5. API 速查表

| 方法 + 路径 | 作用 |
|---|---|
| GET /api/health | 健康检查 |
| GET /api/dashboard?month= | 当月/指定月总览 |
| GET /api/transactions?month=&type= | 账目清单（type 可省略） |
| POST /api/transactions | 记账 `{type,amount,occurredOn,categoryId,note?}` → 201 |
| PATCH /api/transactions/{id} | 修改（同 POST 全部字段）、`{"restore":true}` 恢复、`{"reimburse":true}` 报销或 `{"unreimburse":true}` 撤销报销 |
| DELETE /api/transactions/{id} | 软删除 |
| GET /api/budgets/{month} | `{budget,preset,effectiveBudgetCents}` |
| PUT /api/budgets/{month}?scope=month\|future | 设置显式预算（future 含 240 个月） |
| DELETE /api/budgets/{month} | 删除显式预算 |
| GET/PUT /api/budgets/preset | 全局预设预算 `{amount}` |
| GET /api/settlements?end=&include=focus | 近 6 个月趋势 |
| GET /api/settlements/{month} | 单月完整分析 `{summary}` |
| POST /api/settlements/{month}/settle | 结算并锁定（需用户确认） |
| POST /api/settlements/{month}/reopen | 重开已结算月份（需用户确认） |
| GET/POST /api/categories | 列表（自动播种）/ 新建 `{name,type}` → 201 |
| PATCH /api/categories/{id} | 改名 / `{archived}` 停用 |
| GET/POST /api/subscriptions | 列表 / 新建 → 201 |
| PATCH /api/subscriptions/{id} | 完整字段修改，或 `{"active":bool}`（单独）暂停/恢复 |
| DELETE /api/subscriptions/{id} | 删除，有历史账目时改为归档 |
| POST /api/subscriptions/sync | 补记到期订阅 |
| POST /api/import/preview | 导入预检（不写库） |
| POST /api/import | 导入（≤20000 行） |
| GET /api/export?format=json\|csv | 全量备份 / CSV |

## 6. 数据结构

```jsonc
TransactionDTO = {
  id, type: "EXPENSE"|"INCOME", amountCents: number,
  occurredOn: "YYYY-MM-DD", note: string|null,
  category: CategoryDTO, source: "MANUAL"|"SUBSCRIPTION",
  subscriptionId: string|null, subscriptionMonth: "YYYY-MM"|null,
  reimbursedAt: ISO|null   # 非空 = 已报销
}
CategoryDTO = { id, name, type: "EXPENSE"|"INCOME"|"BOTH", isSystem, sortOrder, archivedAt: ISO|null }
SubscriptionDTO = { id, name, amountCents, billingDay, categoryId, category, startMonth: "YYYY-MM", endMonth: "YYYY-MM"|null, active, note }
```

## 7. 行为守则

1. **先读后写**：记账前先 `GET /api/categories` 拿真实 id，按名字匹配；匹配不到合适的就新建分类，永远不要编造 id。同一件事不要靠反复 POST 补救（改错用 PATCH，怀疑重复先 GET 清单）。
2. **金额换算零失误**：用户说「24块5」→ 请求 `amount:"24.50"`；响应 `amountCents` → 除以 100 再展示。
3. **日常记账直接做，破坏性的先问**：记一笔、查数、设预算按用户指令直接执行；settle、reopen、批量导入、用完整备份还原会冻结、解冻或覆盖数据，先复述一遍将要做的事再动手。
4. **失败照实说**：把 `error` 里的中文消息转述给用户，不要悄悄重试把问题藏起来。
