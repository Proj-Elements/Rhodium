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

/**
 * Budget for a month = the explicit MonthlyBudget row if one exists,
 * otherwise the preset. Returns null when neither is set.
 */
export async function resolveBudgetCents(month: string): Promise<number | null> {
  const budget = await prisma.monthlyBudget.findUnique({
    where: { month: monthStart(month) },
    select: { amountCents: true },
  });
  if (budget) return budget.amountCents;
  return getBudgetPreset();
}

/** True when this specific month carries its own explicit budget row. */
export async function hasExplicitBudget(month: string): Promise<boolean> {
  const budget = await prisma.monthlyBudget.findUnique({
    where: { month: monthStart(month) },
    select: { id: true },
  });
  return Boolean(budget);
}

/** Save a monthly budget row, creating or updating as needed. */
export async function saveMonthlyBudget(month: string, amountCents: number): Promise<void> {
  await prisma.monthlyBudget.upsert({
    where: { month: monthStart(month) },
    create: { month: monthStart(month), amountCents },
    update: { amountCents },
  });
}
