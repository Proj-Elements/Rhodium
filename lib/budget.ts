import type { Prisma } from "@prisma/client";
import { monthKey, monthStart } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { withLedgerRead, withLedgerWrite } from "@/lib/ledger-write";
import { conflict } from "@/lib/errors";

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

export type BudgetSource = "month" | "preset" | "none" | "settlement";
export type ResolvedBudget = { amountCents: number | null; source: BudgetSource };
const NO_BUDGET: ResolvedBudget = { amountCents: null, source: "none" };

/** Explicit month budgets override the preset; absent and zero remain distinct. */
export async function resolveBudget(month: string, db?: Prisma.TransactionClient): Promise<ResolvedBudget> {
  if (!db) return withLedgerRead((tx) => resolveBudget(month, tx));
  const [budget, preset, settlement] = await Promise.all([
    db.monthlyBudget.findUnique({ where: { month: monthStart(month) }, select: { amountCents: true } }),
    getBudgetPreset(db),
    db.monthlySettlement.findUnique({
      where: { month: monthStart(month) },
      select: { reopenedAt: true, remainingAmountCents: true, budgetAmountCents: true },
    }),
  ]);
  if (settlement && settlement.reopenedAt === null) {
    return { amountCents: settlement.remainingAmountCents === null ? null : settlement.budgetAmountCents, source: "settlement" };
  }
  if (budget) return { amountCents: budget.amountCents, source: "month" };
  if (preset !== null) return { amountCents: preset, source: "preset" };
  return NO_BUDGET;
}

/** Resolve a batch's explicit, preset and captured budgets from one snapshot. */
export async function resolveBudgets(months: string[], db?: Prisma.TransactionClient): Promise<Map<string, ResolvedBudget>> {
  const unique = [...new Set(months)];
  if (!unique.length) return new Map();
  if (!db) return withLedgerRead((tx) => resolveBudgets(unique, tx));
  const [rows, preset, settlements] = await Promise.all([
    db.monthlyBudget.findMany({ where: { month: { in: unique.map(monthStart) } }, select: { month: true, amountCents: true } }),
    getBudgetPreset(db),
    db.monthlySettlement.findMany({
      where: { month: { in: unique.map(monthStart) }, reopenedAt: null },
      select: { month: true, remainingAmountCents: true, budgetAmountCents: true },
    }),
  ]);
  const explicit = new Map(rows.map((row) => [monthKey(row.month), row.amountCents]));
  const captured = new Map(settlements.map((row) => [monthKey(row.month), row]));
  const fallback: ResolvedBudget = preset === null ? NO_BUDGET : { amountCents: preset, source: "preset" };
  return new Map(unique.map((month): [string, ResolvedBudget] => {
    const settlement = captured.get(month);
    if (settlement) return [month, { amountCents: settlement.remainingAmountCents === null ? null : settlement.budgetAmountCents, source: "settlement" }];
    const amountCents = explicit.get(month);
    return [month, amountCents === undefined ? fallback : { amountCents, source: "month" }];
  }));
}

/** Save one month's budget under the same lock and settled-state guard as API writes. */
export async function saveMonthlyBudget(month: string, amountCents: number): Promise<void> {
  await withLedgerWrite(async (tx) => {
    const monthDate = monthStart(month);
    const settlement = await tx.monthlySettlement.findUnique({ where: { month: monthDate }, select: { reopenedAt: true } });
    if (settlement && !settlement.reopenedAt) throw conflict("本月已经结算，请先重新打开本月");
    await tx.monthlyBudget.upsert({
      where: { month: monthDate },
      create: { month: monthDate, amountCents },
      update: { amountCents },
    });
  });
}
