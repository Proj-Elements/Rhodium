import { monthKey, monthStart } from "@/lib/domain";
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

export type ResolvedBudget = { amountCents: number | null; source: BudgetSource };

const NO_BUDGET: ResolvedBudget = { amountCents: null, source: "none" };

/**
 * Single source of truth for "what is this month's budget":
 * the explicit MonthlyBudget row if one exists, otherwise the preset.
 * Both rows are fetched in one round trip; callers that also need to know
 * where the number came from read `source`.
 */
export async function resolveBudget(month: string): Promise<ResolvedBudget> {
  const [budget, preset] = await Promise.all([
    prisma.monthlyBudget.findUnique({ where: { month: monthStart(month) }, select: { amountCents: true } }),
    getBudgetPreset(),
  ]);
  if (budget) return { amountCents: budget.amountCents, source: "month" };
  if (preset !== null) return { amountCents: preset, source: "preset" };
  return NO_BUDGET;
}

/**
 * Batch form of `resolveBudget`: two queries for any number of months, so
 * multi-month views (the settlements page) don't issue a pair per month.
 */
export async function resolveBudgets(months: string[]): Promise<Map<string, ResolvedBudget>> {
  const unique = [...new Set(months)];
  if (!unique.length) return new Map();
  const [rows, preset] = await Promise.all([
    prisma.monthlyBudget.findMany({
      where: { month: { in: unique.map(monthStart) } },
      select: { month: true, amountCents: true },
    }),
    getBudgetPreset(),
  ]);
  const explicit = new Map(rows.map((row) => [monthKey(row.month), row.amountCents]));
  const fallback: ResolvedBudget = preset === null ? NO_BUDGET : { amountCents: preset, source: "preset" };
  return new Map(
    unique.map((month) => {
      const amountCents = explicit.get(month);
      return [month, amountCents === undefined ? fallback : { amountCents, source: "month" }];
    }),
  );
}

/** Save a monthly budget row, creating or updating as needed. */
export async function saveMonthlyBudget(month: string, amountCents: number): Promise<void> {
  await prisma.monthlyBudget.upsert({
    where: { month: monthStart(month) },
    create: { month: monthStart(month), amountCents },
    update: { amountCents },
  });
}
