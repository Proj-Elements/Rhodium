import { monthStart } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

/** The single-row preset: default budget for months without an explicit one. */
export async function getBudgetPreset(): Promise<number | null> {
  const preset = await prisma.budgetPreset.findUnique({ where: { id: 1 } });
  return preset?.amountCents ?? null;
}

export async function setBudgetPreset(amountCents: number): Promise<void> {
  await prisma.budgetPreset.upsert({ where: { id: 1 }, create: { id: 1, amountCents }, update: { amountCents } });
}

/** Where a month's effective budget came from. */
export type BudgetSource = "month" | "preset" | "none";

export type ResolvedBudget = {
  amountCents: number | null;
  source: BudgetSource;
};

/**
 * Budget for a month = the explicit MonthlyBudget row if one exists, otherwise
 * the preset. Both lookups run in parallel and the source is returned alongside
 * the amount, so callers never need a second query to tell them apart.
 */
export async function resolveMonthBudget(month: string): Promise<ResolvedBudget> {
  const [explicit, preset] = await Promise.all([
    prisma.monthlyBudget.findUnique({ where: { month: monthStart(month) }, select: { amountCents: true } }),
    getBudgetPreset(),
  ]);
  if (explicit) return { amountCents: explicit.amountCents, source: "month" };
  if (preset !== null) return { amountCents: preset, source: "preset" };
  return { amountCents: null, source: "none" };
}
