import { z } from "zod";
import { categoryIconNames } from "@/lib/category-icons";
import { parseDateOnly } from "@/lib/domain";
import { parseBillingPauses } from "@/lib/billing-pauses";
import { parseBillingHistory } from "@/lib/billing-history";
import { optionalDateTime, parseCents, parseSignedCents } from "@/lib/import-parser";

export const MAX_BACKUP_ROWS = 100_000;
export const MAX_APPEND_ROWS = 20_000;
export const BACKUP_VERSION = 2;

function parsedValue<T>(parse: (value: unknown) => T) {
  return z.unknown().transform((value, context) => {
    try { return parse(value); }
    catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "备份格式不正确" });
      return z.NEVER;
    }
  });
}

const id = z.string().trim().min(1).max(60);
const date = z.string().refine((value) => {
  try { parseDateOnly(value); return true; } catch { return false; }
}, "日期无效");
const monthDate = date.refine((value) => value.endsWith("-01"), "月份必须是月初日期");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(?:-01)?$/, "月份必须是 YYYY-MM 或月初日期");
const timestamp = z.string().refine((value) => {
  try { return optionalDateTime(value, "时间") !== null; } catch { return false; }
}, "时间必须是带时区的 ISO 时间");
const stamps = { createdAt: timestamp.optional(), updatedAt: timestamp.optional() };
const cents = parsedValue((value) => parseCents(value, "金额"));
const totalCents = parsedValue((value) => parseCents(value, "结算金额", 2_147_483_647));
const signedCents = parsedValue((value) => parseSignedCents(value, "结算剩余金额", -2_147_483_648, 2_147_483_647));
const pauses = parsedValue(parseBillingPauses).optional();
const billingHistory = parsedValue(parseBillingHistory).optional();
const legacyBoolean = z.union([z.boolean(), z.enum(["true", "false", "1", "0", "yes", "no"])]);
const revision = z.number().int().positive().max(2_147_483_647);

/** Reject excessive work before parsing elements, then reject ambiguous identities. */
function rows<T extends z.ZodType>(schema: T, identity?: (row: z.infer<T>) => unknown, maximum = MAX_BACKUP_ROWS) {
  return z.preprocess((value, context) => {
    if (Array.isArray(value) && value.length > maximum) {
      context.addIssue({ code: "too_big", origin: "array", maximum, inclusive: true });
      return z.NEVER;
    }
    return value;
  }, z.array(schema).max(maximum).refine((value) => !identity || new Set(value.map(identity)).size === value.length, "备份包含重复记录标识"));
}

const category = z.object({
  id, name: z.string().trim().min(1).max(30), type: z.enum(["EXPENSE", "INCOME", "BOTH", "expense", "income", "both"]).optional().nullable(),
  icon: z.enum(categoryIconNames).nullable().optional(), isSystem: legacyBoolean.optional(),
  sortOrder: z.coerce.number().int().min(-2_147_483_648).max(2_147_483_647).optional(),
  archivedAt: timestamp.nullable().optional(), billingPauses: pauses, ...stamps,
});
const subscription = z.object({
  id, name: z.string().trim().min(1).max(80), amountCents: cents,
  billingDay: z.coerce.number().int().min(1).max(31), categoryId: id,
  startMonth: month, endMonth: month.nullable().optional(), active: legacyBoolean.optional(),
  billingPauses: pauses, billingHistory, note: z.string().nullable().optional(), ...stamps,
}).refine((value) => !value.endMonth || value.endMonth.slice(0, 7) >= value.startMonth.slice(0, 7), "结束月份不能早于开始月份");
const budget = z.object({ month: monthDate, amountCents: cents, ...stamps });
const categorySnapshot = z.array(z.object({ categoryId: id, categoryName: z.string(), expenseCents: totalCents, outOfPocketCents: totalCents, incomeCents: totalCents })
  .refine((value) => value.outOfPocketCents <= value.expenseCents, "分类自付金额不能超过账面支出"))
  .refine((value) => new Set(value.map((row) => row.categoryId)).size === value.length, "结算分类快照不能包含重复分类");
const settlement = z.object({
  month: monthDate, budgetAmountCents: totalCents, expenseAmountCents: totalCents, incomeAmountCents: totalCents,
  remainingAmountCents: signedCents.nullable().optional(), settledAt: timestamp.nullable().optional(), reopenedAt: timestamp.nullable().optional(),
  revision: revision.optional(), categorySnapshot: categorySnapshot.nullable().optional(), ...stamps,
});
const transaction = z.object({
  id, type: z.enum(["EXPENSE", "INCOME", "expense", "income"]).optional(), amountCents: cents,
  occurredOn: date, categoryId: id, note: z.string().nullable().optional(),
  source: z.enum(["MANUAL", "SUBSCRIPTION"]).optional(), subscriptionId: id.nullable().optional(),
  subscriptionMonth: monthDate.nullable().optional(), subscriptionOccurrenceKey: z.string().min(1).max(200).nullable().optional(),
  deletedAt: timestamp.nullable().optional(), reimbursedAt: timestamp.nullable().optional(),
  version: revision.optional(), ...stamps,
}).refine((value) => value.source !== "SUBSCRIPTION" || Boolean(value.subscriptionId), "订阅账目必须关联订阅")
  .refine((value) => !value.subscriptionOccurrenceKey || (value.source === "SUBSCRIPTION" && value.subscriptionId && value.subscriptionMonth && value.subscriptionOccurrenceKey === `${value.subscriptionId}:${value.subscriptionMonth.slice(0, 7)}`), "订阅发生键与账目关联不匹配")
  .refine((value) => !value.reimbursedAt || value.type === "EXPENSE" || value.type === "expense" || value.type === undefined, "收入账目不能标记报销");
const transactionHistory = z.object({
  id, transactionId: id, version: revision, action: z.string().min(1).max(80),
  before: z.json().nullable().optional(), after: z.json(), recordedAt: timestamp,
}).refine((value) => value.after !== null && typeof value.after === "object" && !Array.isArray(value.after) && value.after.id === value.transactionId && value.after.version === value.version, "账目历史快照的标识和版本不匹配");
const settlementHistory = z.object({
  id, month: monthDate, revision, action: z.string().min(1).max(80), snapshot: z.json(), recordedAt: timestamp,
}).refine((value) => value.snapshot !== null && typeof value.snapshot === "object" && !Array.isArray(value.snapshot) && typeof value.snapshot.month === "string" && value.snapshot.month.slice(0, 7) === value.month.slice(0, 7) && value.snapshot.revision === value.revision, "结算历史快照的月份和版本不匹配");
const creationRequest = z.object({ key: z.string().min(1).max(200), requestHash: z.string().min(1).max(200), response: z.json(), createdAt: timestamp });

export const backupSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal("1"), z.literal("2")]).optional(), exportedAt: timestamp.optional(),
  categories: rows(category, (value) => value.id).refine((value) => new Set(value.map((item) => `${item.name}|${(item.type ?? "EXPENSE").toUpperCase()}`)).size === value.length, "备份包含重复分类名称和类型").optional(),
  subscriptions: rows(subscription, (value) => value.id).optional(),
  budgetPreset: z.object({ amountCents: cents, updatedAt: timestamp.optional() }).nullable().optional(),
  budgets: rows(budget, (value) => value.month).optional(), settlements: rows(settlement, (value) => value.month).optional(),
  transactions: rows(transaction, (value) => value.id).optional(),
  transactionHistory: rows(transactionHistory, (value) => `${value.transactionId}:${value.version}`).refine((value) => new Set(value.map((row) => row.id)).size === value.length, "备份包含重复历史 ID").optional(),
  settlementHistory: rows(settlementHistory, (value) => `${value.month}:${value.revision}`).refine((value) => new Set(value.map((row) => row.id)).size === value.length, "备份包含重复历史 ID").optional(),
  creationRequests: rows(creationRequest, (value) => value.key).optional(),
}).superRefine((value, context) => {
  for (const items of [value.categories, value.subscriptions, value.budgets, value.settlements, value.transactions]) {
    for (const row of items ?? []) if (row.createdAt && row.updatedAt && new Date(row.updatedAt) < new Date(row.createdAt)) context.addIssue({ code: "custom", message: "更新时间不能早于创建时间" });
  }
  const transactions = new Map((value.transactions ?? []).map((row) => [row.id, row.version ?? 1]));
  for (const row of value.transactionHistory ?? []) {
    const latest = transactions.get(row.transactionId);
    if (latest !== undefined && row.version > latest) context.addIssue({ code: "custom", message: `账目 ${row.transactionId} 的历史版本超出现有账目版本` });
  }
  const settlements = new Map((value.settlements ?? []).map((row) => [row.month, row.revision ?? 1]));
  for (const row of value.settlementHistory ?? []) {
    const latest = settlements.get(row.month);
    if (latest !== undefined && row.revision > latest) context.addIssue({ code: "custom", message: `${row.month.slice(0, 7)} 的历史结算版本超出现有结算版本` });
  }
});

export type BackupPayload = z.infer<typeof backupSchema>;

const ordinaryRows = rows(z.record(z.string(), z.unknown()), undefined, MAX_APPEND_ROWS);

/** A backup has one authoritative transaction array; legacy metadata + rows remains readable. */
export const importSchema = z.object({
  format: z.enum(["json", "csv"]).optional(), rows: rows(z.record(z.string(), z.unknown())).optional(), backup: backupSchema.optional(),
}).superRefine((value, context) => {
  if (value.backup) {
    if (value.format === "csv") context.addIssue({ code: "custom", message: "完整备份必须使用 JSON 格式" });
    if (value.rows?.length) {
      const legacy = backupSchema.safeParse({ ...value.backup, transactions: value.rows });
      if (!legacy.success) for (const issue of legacy.error.issues) context.addIssue({ ...issue, path: ["rows", ...issue.path] });
      else if (value.backup.transactions && JSON.stringify(legacy.data.transactions) !== JSON.stringify(value.backup.transactions)) context.addIssue({ code: "custom", message: "账目不能在 rows 和备份中提供不同的两份数据" });
    }
  } else {
    const result = ordinaryRows.safeParse(value.rows);
    if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: ["rows", ...issue.path] });
    if (!value.format) context.addIssue({ code: "custom", message: "请选择导入格式" });
  }
}).transform((value) => {
  const backup = value.backup && value.rows?.length && !value.backup.transactions ? backupSchema.parse({ ...value.backup, transactions: value.rows }) : value.backup;
  return { format: value.format ?? "json" as const, rows: backup ? backup.transactions ?? [] : value.rows ?? [], backup };
});
