import { z } from "zod";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

const amountValue = z.union([z.string(), z.number()]).refine((value) => {
  if (typeof value === "string" && !value.trim()) return false;
  const numeric = typeof value === "number" ? value : Number(value.replace(/,/g, "").trim());
  return Number.isFinite(numeric) && numeric >= 0;
}, "金额必须是非负数字");

export const transactionSchema = z.object({
  type: z.enum(["expense", "income"]),
  amount: amountValue,
  occurredOn: z.string().regex(datePattern),
  categoryId: z.string().min(1),
  note: z.string().max(200).optional().nullable(),
});

export const budgetSchema = z.object({
  amount: amountValue,
});

export const subscriptionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  amount: amountValue,
  billingDay: z.number().int().min(1).max(31),
  categoryId: z.string().min(1),
  startMonth: z.string().regex(monthPattern),
  endMonth: z.string().regex(monthPattern).optional().nullable(),
  active: z.boolean().optional().default(true),
  note: z.string().max(200).optional().nullable(),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(30),
  type: z.enum(["expense", "income", "both"]).default("expense"),
});

export const importSchema = z.object({
  format: z.enum(["json", "csv"]),
  rows: z.array(z.record(z.unknown())).min(1).max(5000),
  backup: z.record(z.unknown()).optional(),
});
