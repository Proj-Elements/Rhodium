import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { addMonths, monthStart } from "@/lib/domain";
import { conflict } from "@/lib/errors";

export function budgetHorizon(month: string) {
  const remaining = (9999 - Number(month.slice(0, 4))) * 12 + 13 - Number(month.slice(5, 7));
  return Math.min(240, remaining);
}

export async function budgetVersion(tx: Prisma.TransactionClient, month?: string, future = false): Promise<string> {
  const preset = await tx.budgetPreset.findUnique({ where: { id: 1 } });
  const rows = !month ? [] : future
    ? await tx.monthlyBudget.findMany({ where: { month: { gte: monthStart(month), lte: monthStart(addMonths(month, budgetHorizon(month) - 1)) } }, orderBy: { month: "asc" } })
    : [await tx.monthlyBudget.findUnique({ where: { month: monthStart(month) } })];
  return createHash("sha256").update(JSON.stringify({ preset, rows })).digest("hex");
}

export async function assertBudgetVersion(tx: Prisma.TransactionClient, expected: string, month?: string, future = false) {
  if (expected !== await budgetVersion(tx, month, future)) throw conflict("预算已被其他操作修改，请刷新后核对再保存");
}
