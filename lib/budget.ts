import type { Prisma } from "@prisma/client";
import { monthKey, monthStart } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { withLedgerWrite } from "@/lib/ledger-write";

/** The single-row preset; pass the writer's client for a coherent settlement. */
export async function getBudgetPreset(db: Prisma.TransactionClient = prisma): Promise<number | null> {
  const preset = await db.budgetPreset.findUnique({ where: { id: 1 } });
  return preset?.amountCents ?? null;
}

/** Join an existing locked write, or acquire the ledger lock for a standalone change. */
export async function setBudgetPreset(amountCents: number, tx?: Prisma.TransactionClient): Promise<void> {
  if (!tx) return withLedgerWrite((db) => setBudgetPreset(amountCents, db));
  await tx.budgetPreset.upsert({ where: { id: 1 }, create: { id: 1, amountCents }, update: { amountCents } });
}

export type BudgetSource = "month" | "preset" | "none";
export type ResolvedBudget = { amountCents: number | null; source: BudgetSource };
const NO_BUDGET: ResolvedBudget = { amountCents: null, source: "none" };

/** Explicit month budgets override the preset; absent and zero remain distinct. */
export async function resolveBudget(month: string, db: Prisma.TransactionClient = prisma): Promise<ResolvedBudget> {
  const [budget, preset] = await Promise.all([
    db.monthlyBudget.findUnique({ where: { month: monthStart(month) }, select: { amountCents: true } }),
    getBudgetPreset(db),
  ]);
  if (budget) return { amountCents: budget.amountCents, source: "month" };
  if (preset !== null) return { amountCents: preset, source: "preset" };
  return NO_BUDGET;
}

/** Two queries for any number of months, optionally inside a locked snapshot. */
export async function resolveBudgets(months: string[], db: Prisma.TransactionClient = prisma): Promise<Map<string, ResolvedBudget>> {
  const unique = [...new Set(months)];
  if (!unique.length) return new Map();
  const [rows, preset] = await Promise.all([
    db.monthlyBudget.findMany({ where: { month: { in: unique.map(monthStart) } }, select: { month: true, amountCents: true } }),
    getBudgetPreset(db),
  ]);
  const explicit = new Map(rows.map((row) => [monthKey(row.month), row.amountCents]));
  const fallback: ResolvedBudget = preset === null ? NO_BUDGET : { amountCents: preset, source: "preset" };
  return new Map(unique.map((month) => {
    const amountCents = explicit.get(month);
    return [month, amountCents === undefined ? fallback : { amountCents, source: "month" }];
  }));
}
