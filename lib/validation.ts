import { z } from "zod";
import { moneyToCents } from "@/lib/domain";
import { categoryIconNames } from "@/lib/category-icons";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Amounts reuse the single domain parser so client and API share one truth. */
const amountValue = z.union([z.string(), z.number()]).refine((value) => {
  try {
    moneyToCents(value);
    return true;
  } catch {
    return false;
  }
}, "金额必须是非负数字");

/** Rejects impossible calendar dates (e.g. 2025-02-31) at validation time. */
const dateValue = z
  .string()
  .regex(datePattern, "日期格式应为 YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "日期无效");

const monthValue = z.string().regex(monthPattern, "月份格式应为 YYYY-MM");
const categoryIconValue = z.enum(categoryIconNames).nullable().optional();

export const transactionSchema = z.object({
  type: z.enum(["expense", "income"]),
  amount: amountValue,
  occurredOn: dateValue,
  categoryId: z.string().min(1),
  note: z.string().max(200).optional().nullable(),
});

export const budgetSchema = z.object({
  amount: amountValue,
});

export const subscriptionSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    amount: amountValue,
    billingDay: z.number().int().min(1).max(31),
    categoryId: z.string().min(1),
    startMonth: monthValue,
    endMonth: monthValue.optional().nullable(),
    active: z.boolean().optional().default(true),
    note: z.string().max(200).optional().nullable(),
  })
  .refine((body) => !body.endMonth || body.endMonth >= body.startMonth, {
    message: "结束月份不能早于开始月份",
    path: ["endMonth"],
  });

/** Toggle-only body for PATCH /api/subscriptions/[id]. */
export const subscriptionToggleSchema = z
  .object({ active: z.boolean() })
  .strict();

/** Restore-only PATCH body for a soft-deleted transaction ({ restore: true }). */
export const transactionRestoreSchema = z
  .object({ restore: z.literal(true) })
  .strict();

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(30),
  type: z.enum(["expense", "income", "both"]).default("expense"),
  icon: categoryIconValue,
});

export const categoryPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(30).optional(),
    archived: z.boolean().optional(),
    icon: categoryIconValue,
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "没有需要更新的字段");

const backupIdValue = z.string().trim().min(1).max(60);

/**
 * Backup payloads used to be `z.record(z.unknown())`, which let a caller push
 * arbitrary shapes — including primary keys — straight into `upsert`. The rows
 * are now described explicitly and unknown keys are stripped.
 *
 * `id` is kept only as a *correlation* key so transactions referencing a
 * category/subscription can be re-pointed; the import route never writes it as a
 * database primary key.
 */
const backupCategorySchema = z.object({
  id: backupIdValue,
  name: z.string().trim().min(1).max(30),
  type: z.string().optional().nullable(),
  isSystem: z.union([z.boolean(), z.string()]).optional(),
  sortOrder: z.union([z.number(), z.string()]).optional(),
  archivedAt: z.string().optional().nullable(),
  icon: categoryIconValue,
});

const backupSubscriptionSchema = z.object({
  id: backupIdValue,
  name: z.string().trim().min(1).max(80),
  amountCents: z.union([z.number(), z.string()]),
  billingDay: z.union([z.number(), z.string()]),
  categoryId: backupIdValue,
  startMonth: z.string(),
  endMonth: z.string().optional().nullable(),
  active: z.union([z.boolean(), z.string()]).optional(),
  note: z.string().max(200).optional().nullable(),
});

const backupBudgetSchema = z.object({
  month: dateValue,
  amountCents: z.union([z.number(), z.string()]),
});

const backupSettlementSchema = z.object({
  month: dateValue,
  budgetAmountCents: z.union([z.number(), z.string()]),
  expenseAmountCents: z.union([z.number(), z.string()]),
  incomeAmountCents: z.union([z.number(), z.string()]),
  remainingAmountCents: z.union([z.number(), z.string()]).optional().nullable(),
  settledAt: z.string().optional().nullable(),
  reopenedAt: z.string().optional().nullable(),
});

export const backupSchema = z.object({
  version: z.union([z.number(), z.string()]).optional(),
  exportedAt: z.string().optional(),
  categories: z.array(backupCategorySchema).max(500).optional(),
  subscriptions: z.array(backupSubscriptionSchema).max(500).optional(),
  budgets: z.array(backupBudgetSchema).max(1200).optional(),
  settlements: z.array(backupSettlementSchema).max(1200).optional(),
});

export type BackupPayload = z.infer<typeof backupSchema>;

export const importSchema = z.object({
  format: z.enum(["json", "csv"]),
  // Empty row lists are legal: a full backup may only carry categories,
  // subscriptions, budgets or settlements. The real ceiling on a payload is
  // the 8 MB body limit; this cap just bounds the row-loop work inside.
  rows: z.array(z.record(z.unknown())).max(20_000),
  backup: backupSchema.optional(),
});
