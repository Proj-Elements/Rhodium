import { z } from "zod";
import { moneyToCents, parseDateOnly, parseMonth } from "@/lib/domain";
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
    try { parseDateOnly(value); return true; } catch { return false; }
  }, "日期无效");

const monthValue = z.string().regex(monthPattern, "月份格式应为 YYYY-MM").refine((value) => {
  try { parseMonth(value); return true; } catch { return false; }
}, "月份超出有效范围");
const categoryIconValue = z.enum(categoryIconNames).nullable().optional();

export const transactionSchema = z.object({
  type: z.enum(["expense", "income"]),
  amount: amountValue,
  occurredOn: dateValue,
  categoryId: z.string().min(1),
  note: z.string().max(200).optional().nullable(),
}).strict();

export const transactionEditSchema = transactionSchema.extend({
  expectedVersion: z.number().int().positive(),
}).strict();

export const budgetSchema = z.object({
  amount: amountValue,
});

export const budgetEditSchema = budgetSchema.extend({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const expectedVersionSchema = z.object({ expectedVersion: z.number().int().positive().max(2_147_483_647) }).strict();

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
  .object({ active: z.boolean(), expectedVersion: z.number().int().positive() })
  .strict();

export const subscriptionEditSchema = subscriptionSchema.safeExtend({ expectedVersion: z.number().int().positive() });

/** Restore-only PATCH body for a soft-deleted transaction ({ restore: true }). */
export const transactionRestoreSchema = z
  .object({ restore: z.literal(true), expectedVersion: z.number().int().positive() })
  .strict();

/**
 * Reimburse-only PATCH body ({ reimburse: true }). Strict like the restore
 * body so extra fields cannot ride along. Undoing a reimbursement has its own
 * strict body too ({ unreimburse: true }) so it cannot be confused with an
 * edit. Ordinary edits preserve the stamp.
 */
export const transactionReimburseSchema = z
  .object({ reimburse: z.literal(true), expectedVersion: z.number().int().positive() })
  .strict();

/** Un-reimburse-only PATCH body ({ unreimburse: true }). */
export const transactionUnreimburseSchema = z
  .object({ unreimburse: z.literal(true), expectedVersion: z.number().int().positive() })
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
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine((body) => Object.keys(body).some((key) => key !== "expectedVersion"), "没有需要更新的字段");

export { backupSchema, importSchema, type BackupPayload } from "@/lib/backup-validation";
