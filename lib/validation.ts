import { z } from "zod";
import { moneyToCents } from "@/lib/domain";

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

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(30),
  type: z.enum(["expense", "income", "both"]).default("expense"),
});

export const categoryPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(30).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "没有需要更新的字段");

export const importSchema = z.object({
  format: z.enum(["json", "csv"]),
  rows: z.array(z.record(z.unknown())).min(1).max(5000),
  backup: z.record(z.unknown()).optional(),
});
