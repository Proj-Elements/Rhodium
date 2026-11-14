---
name: rhodium-ledger
description: 查询与管理「Rhodium」本地个人记账应用的账本：查开支与预算使用、记/改/删账目、维护固定支出（订阅）自动记账、月度结算与回顾、导出备份与导入还原。凡用户提到记账相关的事——记一笔、这个月/某月花了多少、预算还剩多少、订阅或会员扣费、月底结算或关账、分类、导入导出账本——即使用户没有提「Rhodium」或应用名，也应使用本技能，直接调用 http://127.0.0.1:3030 的本地 REST API 完成任务；不要凭记忆改用其他请求格式，也不要让用户手动去页面操作。
---

# Rhodium（rhodium-ledger）记账 API

「Rhodium」是使用共享令牌保护的单用户个人记账应用，全部能力通过本地 REST API 暴露。工作方式：连接自检 → 用路由表选接口 → 照抄本文示例改参数执行 → 按「错误应对」处理异常。

## 0. 连接自检（会话开始时跑一次）

```bash
BASE=http://127.0.0.1:3030        # 应用默认端口
curl -fsSL $BASE/api/health       # 正常返回 {"status":"ok","database":"ok"}
```

- 503 = 应用活着但数据库不可达；连接失败 = 应用没启动或端口不同，让用户启动应用。自检一次即可，之后不要轮询。
- 除健康检查外均需认证。使用 `RHODIUM_ACCESS_TOKEN` 对应令牌，通过 `Authorization: Bearer <令牌>` 请求；浏览器使用 Basic 用户名 `rhodium`、密码为令牌。令牌不得写进技能或日志，远程连接必须使用 HTTPS。下文 curl 示例需自行附带认证头。
- 限流使用进程内固定窗口：读 600 次/分钟、写 120 次/分钟、`/api/import*` 12 次/分钟，重启会重置计数。触发返回 429 与 `Retry-After` 响应头，等那么多秒再重试；批量写入时把请求间隔开。
- 写请求统一使用 `Content-Type: application/json`。本机 CLI 无需伪造 `Origin` 或转发地址；自定义访问域名必须先配置允许的 Host，浏览器跨站请求会被拒绝。这些检查与令牌鉴权共同生效。

## 1. 动手前先记住四条硬规则

1. **请求用元，响应用分**：请求体用明确的十进制金额（推荐字符串 `"24.50"`）；响应里的 `amountCents` 一律是整数「分」——展示给用户前必须除以 100 格式化成 ¥24.50，永远不要把分值原样当金额播报。单笔上限 2,000,000,000 分（两千万元）；不传负数或 `"0x10"`、`"1e3"`、`"1,2,3"` 这类金额文本。
2. **日期是严格日历**：`occurredOn` 必须 `YYYY-MM-DD`（`2025-02-30` 会被 400 拒绝）；月份一律 `YYYY-MM`，年份范围为 0001–9999；「今天 / 当月」按 `Asia/Shanghai` 计算。
3. **请求小写、响应大写**：账目类型请求传 `"expense"`/`"income"`，响应是 `"EXPENSE"`/`"INCOME"`；分类类型请求 `expense|income|both`，响应 `EXPENSE|INCOME|BOTH`。
4. **已结算月份只读**：对锁定月份的账目做任何写操作都会 409「本月已经结算，请先重新打开本月」。不要擅自解锁——停下询问用户，得到同意后再 `POST /api/settlements/{month}/reopen`（解除快照保护是用户的决策）。

其余约定：账目是软删除，`DELETE` 后可恢复；分类没有删除，用 `{"archived":true}` 停用，历史账目保留。仪表盘的 `expenseCents`/`outOfPocketCents` 不含已报销支出，月度回顾的 `expenseCents` 保留账面全额，`outOfPocketCents` 才是自付额，预算与剩余按自付额计算；`reimbursedCents`/`reimbursedCount` 单列报销。备注与分类编辑保留报销；修改已报销账目的金额、日期或方向前需先明确撤销报销。删除、恢复与 JSON 备份还原均保留报销事实。

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

- 账面支出 → `expenseCents`；实际自付 → `outOfPocketCents`；收入 → `incomeCents`（记得除以 100）。
- 有报销 → `reimbursedCents` / `reimbursedCount` 是已报销金额与笔数，仍包含在 `expenseCents` 中，从 `outOfPocketCents` 与预算口径中排除；报销可随时撤销（见 §3.4）。
- 预算够不够 → `remainingCents`、`usagePercent`；`budget`（`{amountCents}` 或 null）配合 `budgetSource`：`month`=本月显式预算、`preset`=全局预设兜底、`settlement`=已结算月份的冻结预算、`none`=未设预算。预算为 0 是明确设置，不等于未设预算。
- 钱花在哪 → `categoryBreakdown`（分类排行，按金额降序，不含报销）。
- 近期走势 → `recentExpenses` 最近 7 天逐日支出（不含报销）；自付日均 = `outOfPocketCents / daysElapsed`（`daysElapsed`/`daysInMonth` 为已过/总天数，只有当月 `daysElapsed` 小于总天数）。
- 刚花了什么 → `recentTransactions` 最近 10 笔；`focusDateExpenseCents` 当日支出。

### 3.2 查某月账目清单

```bash
curl -fsSL "$BASE/api/transactions?month=2026-09"              # 该月第一页
curl -fsSL "$BASE/api/transactions?month=2026-09&type=expense" # 只看支出
curl -fsSL "$BASE/api/transactions?month=all&q=%E5%8D%88%E9%A5%AD" # 跨月搜索“午饭”
curl -fsSL "$BASE/api/transactions?month=all&deleted=only"     # 回收站
```

返回 `{month, readOnly, transactions, nextCursor, summary}`，按日期、创建时间、ID 倒序。默认每页 500 条，`limit` 可设 1–2000；`nextCursor` 非 null 时，将其原样传入下一页的 `cursor`，其他筛选条件保持一致。不能把第一页当作完整清单。`summary` 汇总所有匹配项而非当前页，含 `transactionCount`、账面 `expenseCents`、自付 `outOfPocketCents`、`incomeCents`、`reimbursedCents`、`reimbursedCount`。

`month=all` 跨月查询，`q`（最多 200 字）搜索备注、分类名和订阅名，`categoryId` 进一步筛分类；`deleted=only` 仅查软删除行，默认排除删除行。`readOnly=true` 表示指定月已锁定，跨月时分别查看每行的 `monthLocked`，不能因为顶层 `readOnly=false` 就修改已结算行。

### 3.3 记一笔

```bash
# 第 1 步：拿分类（首次调用会自动播种默认分类）。archivedAt 非 null 的已停用，不要选
curl -fsSL $BASE/api/categories

# 第 2 步：为这次记账生成并保存一个唯一请求键；不确定结果时用原键和原请求重试
REQUEST_KEY=$(uuidgen)
# type 决定 categoryId 必须是可用于该方向的分类
curl -fsSL -X POST $BASE/api/transactions -H 'content-type: application/json' \
  -H "Idempotency-Key: $REQUEST_KEY" \
  -d '{"type":"expense","amount":"24.50","occurredOn":"2026-09-05","categoryId":"<分类id>","note":"午饭"}'
# 201 {"transaction": TransactionDTO}
```

完整示例——用户说「午饭 24 块 5」：查分类列表按名字匹配到「餐饮」的 id（匹配不到合适的就先建，见 §3.9），执行上面的 POST（`amount:"24.50"`，`occurredOn` 用上海时区的今天），然后照这样汇报：「已记：餐饮 ¥24.50（09-05），本月共支出 ¥xxxx.xx」。`note` 可选、≤200 字。

`Idempotency-Key` 为 8–128 个字母、数字或 `._:-`，UUID 符合要求。旧 CLI 可省略，但本技能始终为新操作生成并保存它。请求超时或结果不确定时，沿用同一键和同一内容重试，不要生成新键。相同键和归一化内容返回原 201 JSON，并以 `Idempotent-Replay: true` 标识重放；相同键配不同内容返回 409。键无过期时间，并随完整备份保存。

重放返回的是创建时的响应快照，即使该账目后来被修改、删除或结算，也不会再创建一笔。需要最新状态时另查账目。用户改变金额等内容时应视为新操作并生成新键。

### 3.4 修改 / 删除 / 恢复账目

```bash
# 先 GET 清单拿到当前 version。修改必须携带全部编辑字段和 expectedVersion
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' \
  -d '{"expectedVersion":1,"type":"expense","amount":"30.00","occurredOn":"2026-09-05","categoryId":"<分类id>","note":"改价"}'

# 删除（软删除）
curl -fsSL -X DELETE "$BASE/api/transactions/<id>?expectedVersion=1" -H 'content-type: application/json'

# 恢复（仅限已软删除的行，否则 409）
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' -d '{"restore":true,"expectedVersion":2}'

# 报销（仅支出；已删除行 409「这条账目已被删除，无法报销」；收入行 409「只有支出才能标记报销」）
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' -d '{"reimburse":true,"expectedVersion":3}'
# 撤销报销：只清空报销时间戳，不改金额、日期、分类
curl -fsSL -X PATCH $BASE/api/transactions/<id> -H 'content-type: application/json' -d '{"unreimburse":true,"expectedVersion":4}'
```

上面的版本号仅为示例，每次操作都使用最新响应或清单里的 `version`。版本不匹配会返回 409，先重新读取并向用户说明冲突，再根据用户意图处理，不能自动覆盖其他编辑。

删除响应包含 `{id, deleted, version, transaction}`。如需解释改动来源，读取 `GET /api/transactions/{id}/history?limit=50`：`history` 按版本倒序，记录 `version`、`action`、`before`、`after` 和 `recordedAt`，快照保留当时分类名。默认每页 50 条，`limit` 为 1–200；`nextCursor` 非 null 时原样传入下一页 `cursor`。只解释已保存的记录；旧数据没有记录不代表从未被编辑。历史账目分类已停用时，保留原分类的备注编辑仍可保存；换分类须选有效分类。

恢复、报销、撤销报销的 body 只能包含一个动作键和 `expectedVersion`，混入其他动作或完整编辑字段返回 400。已软删除行不能直接编辑，先恢复；恢复会重新校验分类，分类已归档或类型不匹配时返回 400。报销和撤销报销仅允许未删除、未锁定月份内的支出，收入或已删除行返回 409，不存在的 id 返回 404。

### 3.5 预算

```bash
# 查某月预算：source 解释有效值来源，locked 表示已冻结；已结算月采用快照预算
curl -fsSL $BASE/api/budgets/2026-09

# 设本月显式预算
curl -fsSL -X PUT "$BASE/api/budgets/2026-09" -H 'content-type: application/json' -d '{"amount":"3000","expectedVersion":"<GET 返回的 version>"}'

# 从本月起一次性写最多 240 个月的显式预算（跳过已结算月，不越过 9999-12）
curl -fsSL -X PUT "$BASE/api/budgets/2026-09?scope=future" -H 'content-type: application/json' -d '{"amount":"3000","expectedVersion":"<GET 返回的 futureVersion>"}'
# 响应含 monthsSet 与 throughMonth

# 删某月显式预算（该月回落到 preset）
curl -fsSL -X DELETE "$BASE/api/budgets/2026-09?expectedVersion=<GET 返回的 version>" -H 'content-type: application/json'

# 全局预设：所有没有显式预算的月份的默认值
curl -fsSL $BASE/api/budgets/preset
curl -fsSL -X PUT $BASE/api/budgets/preset -H 'content-type: application/json' -d '{"amount":"3000","expectedVersion":"<GET preset 返回的 version>"}'
```

预算版本是不可自行构造的状态摘要。月预算 GET 返回 `version`、`futureVersion`、`presetVersion`，分别用于本月、未来范围和全局预设写入；preset GET 的 `version` 与 `presetVersion` 含义相同。使用填写变更时读取到的版本；过期返回 409 后重新核对，不能只换成新版本自动重试旧内容。

### 3.6 月度回顾与结算

```bash
# 单月完整分析：分类排行、单日峰值、逐日日历、订阅支出单列
curl -fsSL $BASE/api/settlements/2026-09          # {"summary": {...}}

# 近 6 个月趋势（含 end 月，旧→新）；?include=focus 额外返回 end 月完整 summary
curl -fsSL "$BASE/api/settlements?end=2026-09&include=focus"
```

summary 字段：`budgetCents`/`budgetSource`/`expenseCents`（账面支出，含报销）/`outOfPocketCents`（自付额）/`reimbursedCents`/`reimbursedCount`/`incomeCents`/`remainingCents`（预算减自付额）、`subscriptionExpenseCents`（订阅产生的支出）、`topCategory`/`topDate`（单日最高，按账面全额）、`dailyBreakdown`（每天 `{date,expenseCents,incomeCents,transactionCount}`）、`dailyAverageCents`（自付额日均）/`grossDailyAverageCents`（账面支出日均）、`transactionCount`（全部账目数）、`expenseTransactionCount`（仅支出笔数）、`settlement`（已结算快照或 null）。

结算与重开是冻结/解除冻结数据的操作，**执行前用一句话向用户复述要做的事**：

```bash
curl -fsSL -X POST $BASE/api/settlements/2026-09/settle -H 'content-type: application/json'   # 快照并锁定该月（未来月份 400）
curl -fsSL -X POST $BASE/api/settlements/2026-09/reopen -H 'content-type: application/json' \
  -d '{"expectedVersion":1}'   # 使用 summary.settlement.revision；未结算 404，已打开或过期 409
```

结算保存分类名称及账面支出、自付额、收入的分类快照，重开和重新结算产生新修订，旧修订保留。重开会在同一事务内补齐该月被锁定挡住的到期支出，成功后直接刷新汇总即可。`GET /api/settlements/{month}/history?limit=50` 返回 `{history:[{id,month,revision,action,snapshot,recordedAt}],nextCursor}`；`limit` 为 1–200，非空 `nextCursor` 原样传入下一页 `cursor`。

### 3.7 固定支出（订阅）

```bash
curl -fsSL $BASE/api/subscriptions
REQUEST_KEY=$(uuidgen)
curl -fsSL -X POST $BASE/api/subscriptions -H 'content-type: application/json' -H "Idempotency-Key: $REQUEST_KEY" \
  -d '{"name":"网易云音乐","amount":"15.00","billingDay":8,"categoryId":"<支出分类id>","startMonth":"2026-09"}'
# billingDay 1-31，短月自动取当月最后一天；endMonth 可选；分类必须可用于支出（EXPENSE/BOTH）

# 修改：发完整字段加 expectedVersion，或 active 加 expectedVersion 暂停/恢复
curl -fsSL -X PATCH $BASE/api/subscriptions/<id> -H 'content-type: application/json' -d '{"active":false,"expectedVersion":1}'

# 删除：已有历史账目时只暂停不真删（响应 archived:true），避免账目失去关联
curl -fsSL -X DELETE "$BASE/api/subscriptions/<id>?expectedVersion=1" -H 'content-type: application/json'

# 显式补记到期的订阅账目；GET 查询不会触发订阅补记
curl -fsSL -X POST $BASE/api/subscriptions/sync -H 'content-type: application/json'
# {"created":n,"syncedThrough":"YYYY-MM-DD", ...}
```

创建订阅使用与记账相同的幂等规则，两个接口的键独立；重试沿用原键和原内容。PATCH 和 DELETE 使用 GET 返回的订阅 `version`，过期返回 409。暂停、恢复按当天的 `[开始日, 恢复日)` 记录，扣款日落在暂停区间内的账目不会在恢复后补记，分类停用期间同理。金额、扣款日、分类和起止月份变更默认下月生效，当前月继续沿用原计划；尚未开始的未来计划可编辑未来生效内容，已经产生的历史账目不会被改价。月内已到期、后来才暂停的计划仍计入本月计划固定支出。

响应包含 `billingEffectiveMonth`（最新计划生效月）、`currentAmountCents`（当月有效价格或 null）、`billingHistory` 与 `billingPauses`。旧数据或没有历史字段的旧备份无法还原过去价格，服务端从迁移/导入当月建立可靠计划并跳过无法确定的历史缺口。sync 的 `skippedUnknownHistory` 与 `historyWarnings[{subscriptionId,knownFrom}]` 必须如实告知用户，不能把未补记的缺口当作没有消费。

常驻 Node.js 服务启动时自动同步，完成后每 60 秒再执行一次，无需打开页面；停机期间的缺口在重启后补齐。后台及显式全量同步按每订阅最多 12 个月一事务推进，失败只回滚当前批次，重试从持久进度继续。全量 sync 有按日期区分的 60 秒缓存，订阅变更、导入或重开月份使缓存失效。写锁等待超过 3 秒返回 409，可稍后重试；页面仍可读取已有账目。

### 3.8 导入 / 导出

```bash
# 导出：JSON 完整备份，或用于表格查看的账目 CSV
curl -fsSL "$BASE/api/export?format=json" -o backup.json
curl -fsSL "$BASE/api/export?format=csv"  -o transactions.csv

# 完整恢复仅传一次 envelope，不同时发送 rows 与 backup.transactions
node -e 'const fs=require("node:fs"); const backup=JSON.parse(fs.readFileSync("backup.json","utf8")); fs.writeFileSync("restore-request.json",JSON.stringify({backup}));'

# 先预检（不写库），读 errors、summary.lockedMonths 与 summary.conflicts
curl -fsSL -X POST $BASE/api/import/preview -H 'content-type: application/json' --data-binary @restore-request.json

# 确认变更摘要后恢复；同一事务内重校验，要么全成要么全不动
curl -fsSL -X POST $BASE/api/import -H 'content-type: application/json' --data-binary @restore-request.json
# {"imported": n, "summary": {...}}
```

普通追加导入使用 `{"format":"json","rows":[...]}`；CSV 需先解析为表头对应的行对象，再使用 `{"format":"csv","rows":[...]}`。导入行字段（中英文键等价）：`occurredOn`/`日期`（YYYY-MM-DD）、`amount`/`金额`（元）或 `amountCents`（分）、`type`/`类型`（`expense`/`income`，也接受 `支出`/`收入`）、`category`/`分类`、`note`/`备注`。分类按名称及收支方向匹配，不存在时按原名称新建并计入预检；缺省名称用「其他」。显式 `categoryId` 无效、分类停用或方向不匹配时阻止导入，不静默替换。普通备注不超过 200 字。

两个接口都限制 UTF-8 请求体不超过 64 MiB。普通追加单次最多 20,000 行；完整备份每类实体最多 100,000 条。JSON 导出检查相同恢复边界，超限会明确报错，不能把失败响应当作成功备份。完整备份不可拆批恢复：账目、预算、订阅历史和结算锁需要在同一事务中验证。超限时使用 PostgreSQL 数据库备份。

同一服务进程同时只接收一个导入或预检；繁忙返回 429 与 `Retry-After`。上传请求体须在 30 秒内完成，超时返回 408。预览最多展示前 20 行，单条备注只展示前 200 字；恢复仍保留完整历史备注。错误诊断只展示有限条数，应修正已报告问题后再次预检。时间戳换算成 UTC 后也必须在 0001–9999 年内；未来的 `createdAt` 必须同时提供不早于它的 `updatedAt`。

合并语义决定选哪种格式，别弄错：

- **普通行列表**（无 `backup` 字段）：一律新插入，行内 `id` 被忽略。所以把 CSV 再导回去会重复入账；整体还原必须用 JSON 完整备份。
- **完整备份**（`backup` 字段为导出的 JSON）：当前导出版本为 2，恢复支持版本 1、2，其他版本拒绝。系统分类优先按 `systemKey` 识别，其他分类按名称和类型合并；订阅与交易按稳定 ID 恢复，预算和结算按月份合并。保留账目创建时间、更新时间、版本以及可用的暂停、价格和审计历史。旧文件即使只含预算、预设、历史或幂等记录，页面也按完整备份识别。
- **结算一致性**：已有锁定月份不能覆盖，未来月份不能恢复为关闭。备份中的关闭快照必须与合并后账目的支出、收入、报销及预算净额一致，否则返回 409 并回滚全部写入。最新审计快照须与对应实体一致；订阅发生记录必须是支出且关联键一致。不能以分批导入绕开验证。
- **预检摘要**：`summary.transactions` 给出 `create`、`update`、`unchanged` 数量，`categories`、`subscriptions`、`budgets`、`settlements` 各给出 `create`、`update`；`budgetPreset` 给出 `create`、`update`、`delete`，删除默认预算也须核对；`lockedMonths` 和 `conflicts` 列出阻塞。正式导入会在事务中重新计算，预检后其他请求可能改变账本，预检通过不保证后续导入一定成功。
- **CSV 用途**：导出只包含未删除账目，包含报销时间，不包含完整预算、订阅及结算历史。Rhodium 用 `__rhodium_csv_encoding=apostrophe-v1` 标记安全公式转义，回导时只对带此标记的行还原；第三方 CSV 不猜测或删除原始前导单引号。不要删除此标记列。未闭合引号和重复表头会被拒绝。
- 行多或没把握时先 preview，并向用户说明新增、覆盖和冲突数量；完整恢复的授权应覆盖实际预检结果。

### 3.9 分类

```bash
curl -fsSL $BASE/api/categories
curl -fsSL -X POST $BASE/api/categories -H 'content-type: application/json' \
  -d '{"name":"宠物","type":"expense"}'          # type: expense|income|both，名称≤30字
curl -fsSL -X PATCH $BASE/api/categories/<id> -H 'content-type: application/json' -d '{"archived":true,"expectedVersion":1}'   # 停用
curl -fsSL -X PATCH $BASE/api/categories/<id> -H 'content-type: application/json' -d '{"name":"餐饮饮食","expectedVersion":1}'  # 改名
```

系统分类（`isSystem=true`）不能停用；没有 DELETE（见 §1 末尾约定）。PATCH 携带 GET 返回的 `version`，每次成功后版本增加；系统分类改名仍保持原播种身份，不会重建旧名称。

## 4. 错误应对

错误统一 `{"error": "中文消息", "details?": ...}`。`error` 是给用户看的中文人话（如「订阅「X」的分类不存在」），直接转述，不要吞掉。

| 状态码 | 含义 | 怎么办 |
|---|---|---|
| 400 | 参数不合法（`details` 是字段级错误） | 按 details 改字段重试；常见：日期非法、金额为负或超限、分类方向不匹配 |
| 403 | Host、来源或浏览器访问上下文不允许 | 检查实际访问地址与部署白名单，不伪造来源绕过检查 |
| 404 | id 或月份不存在 | 先 GET 列表核对真实 id，不要猜 |
| 408 | 请求体上传超时 | 检查传输速度后重新上传；服务端尚未开始该次写入 |
| 409 | 月份锁定、版本过期、幂等键内容冲突、结算与合并账目不一致等 | 重新读取并说明具体冲突；不自动覆盖，不自动重开月份 |
| 413 | 请求体过大 | 普通追加可在确认重复风险后分批，每批最多 20,000 行且不超过 64 MiB；完整备份不能拆批，应使用数据库备份 |
| 415 | JSON 请求缺少正确媒体类型 | 补上 `Content-Type: application/json` 后按原操作重试 |
| 429 | 限流 | 等响应头 `Retry-After` 秒数后重试 |

## 5. API 速查表

| 方法 + 路径 | 作用 |
|---|---|
| GET /api/health | 健康检查（无需认证） |
| GET /api/revision | 账本变更序号，用于前台刷新 |
| GET /api/dashboard?month= | 当月/指定月总览 |
| GET /api/transactions?month=&type=&q=&deleted=&cursor= | 分页账目、跨月搜索和回收站；`month=all` 跨月，`deleted=only` 查删除项 |
| POST /api/transactions | 记账 `{type,amount,occurredOn,categoryId,note?}`，带 `Idempotency-Key` |
| PATCH /api/transactions/{id} | 完整编辑或单个恢复/报销/撤销报销动作，均携带 `expectedVersion` |
| DELETE /api/transactions/{id}?expectedVersion= | 按当前版本软删除 |
| GET /api/transactions/{id}/history?limit=&cursor= | 分页快照，返回 `history,nextCursor` |
| GET /api/budgets/{month} | `{budget,preset,effectiveBudgetCents,source,locked,version,futureVersion,presetVersion}` |
| PUT /api/budgets/{month}?scope=month\|future | 设置显式预算，携带对应 `expectedVersion`（future 最多 240 个月） |
| DELETE /api/budgets/{month}?expectedVersion= | 按已读状态删除显式预算 |
| GET/PUT /api/budgets/preset | 读取含 `version`；写入 `{amount,expectedVersion}` |
| GET /api/settlements?end=&include=focus | 近 6 个月趋势 |
| GET /api/settlements/{month} | 单月完整分析 `{summary}` |
| GET /api/settlements/{month}/history?limit=&cursor= | 按修订倒序分页，返回 `history,nextCursor` |
| POST /api/settlements/{month}/settle | 结算并锁定（需用户确认） |
| POST /api/settlements/{month}/reopen | 重开已结算月份，传 `{expectedVersion: revision}`（需用户确认） |
| GET/POST /api/categories | 列表（自动播种）/ 新建 `{name,type}` → 201 |
| PATCH /api/categories/{id} | 改名 / `{archived}` 停用，携带 `expectedVersion` |
| GET/POST /api/subscriptions | 列表 / 新建 → 201，创建带 `Idempotency-Key` |
| PATCH /api/subscriptions/{id} | 完整字段修改或 `active` 暂停/恢复，均携带 `expectedVersion` |
| DELETE /api/subscriptions/{id}?expectedVersion= | 删除，有历史账目时改为归档 |
| POST /api/subscriptions/sync | 补记到期订阅 |
| POST /api/import/preview | 导入预检（不写库） |
| POST /api/import | 原子恢复 `{backup}` 或追加 `{format,rows}`；返回写入数与变更摘要 |
| GET /api/export?format=json\|csv | 全量备份 / CSV |

## 6. 数据结构

```jsonc
TransactionDTO = {
  id, version: number, type: "EXPENSE"|"INCOME", amountCents: number,
  occurredOn: "YYYY-MM-DD", note: string|null, deletedAt: ISO|null,
  category: CategoryDTO, source: "MANUAL"|"SUBSCRIPTION",
  subscriptionId: string|null, subscriptionMonth: "YYYY-MM"|null,
  reimbursedAt: ISO|null   // 非空 = 已报销
}
CategoryDTO = { id, version: number, name, type: "EXPENSE"|"INCOME"|"BOTH", isSystem, sortOrder, archivedAt: ISO|null }
SubscriptionDTO = {
  id, version: number, name, amountCents, billingDay, categoryId, category,
  startMonth: "YYYY-MM", endMonth: "YYYY-MM"|null, active, note,
  billingEffectiveMonth: "YYYY-MM"|null, currentAmountCents: number|null,
  billingHistory, billingPauses
}
```

## 7. 行为守则

1. **先读后写**：记账前先 `GET /api/categories` 拿真实 id，按名字匹配；匹配不到合适的就新建分类，永远不要编造 id。同一件事不要靠反复 POST 补救（改错用 PATCH，怀疑重复先 GET 清单）。
2. **金额换算零失误**：用户说「24块5」→ 请求 `amount:"24.50"`；响应 `amountCents` → 除以 100 再展示。
3. **日常记账直接做，破坏性的先问**：记一笔、查数、设预算按用户指令直接执行；settle、reopen、批量导入、用完整备份还原会冻结、解冻或覆盖数据，先复述一遍将要做的事再动手。
4. **失败照实说**：把 `error` 里的中文消息转述给用户，不要悄悄重试把问题藏起来。
