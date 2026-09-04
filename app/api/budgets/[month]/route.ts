import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody, monthRange } from "@/lib/api";
import { addMonths, moneyToCents, monthKey, monthStart, parseMonth } from "@/lib/domain";
import { conflict } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { budgetSchema } from "@/lib/validation";
import { isMonthLocked } from "@/lib/summary";
import { getBudgetPreset } from "@/lib/budget";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

const putQuerySchema = z.object({
  // "month" (default): only this month gets an explicit budget row.
  // "future": this month AND every month inside the horizon below get explicit
  // rows (the preset stops applying to them).
  scope: z.enum(["month", "future"]).default("month"),
});

/**
 * How far ahead `scope=future` materialises explicit rows. Months beyond the
 * horizon keep whatever they already had — the previous implementation issued an
 * unbounded `updateMany({ month: { gte } })` that silently overwrote budgets the
 * user had set past this window.
 */
const FUTURE_MONTH_LIMIT = 240; // 20 years of rows, plenty for a personal ledger.

export async function GET(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    const [budget, preset] = await Promise.all([
      prisma.monthlyBudget.findUnique({ where: { month: monthRange(month).start } }),
      getBudgetPreset(),
    ]);
    return NextResponse.json({
      budget: budget ? { amountCents: budget.amountCents } : null,
      preset: preset === null ? null : { amountCents: preset },
      effectiveBudgetCents: budget?.amountCents ?? preset,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    const { scope } = putQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const body = budgetSchema.parse(await parseJsonBody(request));
    if (await isMonthLocked(month)) throw conflict("本月已经结算，请先重新打开本月");
    const amountCents = moneyToCents(body.amount);
    const monthDate = monthRange(month).start;

    if (scope === "future") {
      // Explicit rows for [month, month + FUTURE_MONTH_LIMIT). Anything past the
      // horizon is deliberately left alone.
      const horizonEnd = monthStart(addMonths(month, FUTURE_MONTH_LIMIT - 1));
      // Settled months keep their own budget: rewriting one would desync the
      // snapshot already stored in MonthlySettlement.
      const locked = await prisma.monthlySettlement.findMany({
        where: { month: { gte: monthDate, lte: horizonEnd }, reopenedAt: null },
        select: { month: true },
      });
      const lockedKeys = new Set(locked.map((row) => monthKey(row.month)));
      const rows = Array.from({ length: FUTURE_MONTH_LIMIT }, (_, index) => monthStart(addMonths(month, index)))
        .filter((rowMonth) => !lockedKeys.has(monthKey(rowMonth)))
        .map((rowMonth) => ({ month: rowMonth, amountCents }));
      await prisma.$transaction([
        prisma.monthlyBudget.createMany({ data: rows, skipDuplicates: true }),
        // Re-assert the amount for rows that already existed with another value.
        prisma.monthlyBudget.updateMany({
          where: { month: { gte: monthDate, lte: horizonEnd, notIn: locked.map((row) => row.month) } },
          data: { amountCents },
        }),
      ]);
      return NextResponse.json({ budget: { amountCents }, scope, monthsSet: rows.length, throughMonth: monthKey(horizonEnd) });
    }

    const budget = await prisma.monthlyBudget.upsert({
      where: { month: monthDate },
      create: { month: monthDate, amountCents },
      update: { amountCents },
    });
    return NextResponse.json({ budget: { amountCents: budget.amountCents }, scope });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    if (await isMonthLocked(month)) throw conflict("本月已经结算，请先重新打开本月");
    await prisma.monthlyBudget.deleteMany({ where: { month: monthStart(month) } });
    return NextResponse.json({ deleted: true, month });
  } catch (error) {
    return handleApiError(error);
  }
}
