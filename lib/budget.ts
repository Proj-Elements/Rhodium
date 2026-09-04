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

export type BudgetSource = "month" | "preset" | "none";

/**
 * Single source of truth for "what is this month's budget":
 * the explicit MonthlyBudget row if one exists, otherwise the preset.
 * Both rows are fetched in one round trip; callers that also need to know
 * where the number came from read `source`.
 */
export async function resolveBudget(month: string): Promise<{ amountCents: number | null; source: BudgetSource }> {
  const [budget, preset] = await Promise.all([
    prisma.monthlyBudget.findUnique({ where: { month: monthStart(month) }, select: { amountCents: true } }),
    getBudgetPreset(),
  ]);
  if (budget) return { amountCents: budget.amountCents, source: "month" };
  if (preset !== null) return { amountCents: preset, source: "preset" };
  return { amountCents: null, source: "none" };
}

/** Effective budget in cents, or null when neither a month row nor a preset is set. */
export async function resolveBudgetCents(month: string): Promise<number | null> {
  return (await resolveBudget(month)).amountCents;
}
