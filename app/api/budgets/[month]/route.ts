import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody, monthRange } from "@/lib/api";
import { moneyToCents, parseMonth } from "@/lib/domain";
import { conflict } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { budgetSchema } from "@/lib/validation";
import { isMonthLocked } from "@/lib/summary";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    const budget = await prisma.monthlyBudget.findUnique({ where: { month: monthRange(month).start } });
    return NextResponse.json({ budget: budget ? { amountCents: budget.amountCents } : null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    const body = budgetSchema.parse(await parseJsonBody(request));
    if (await isMonthLocked(month)) throw conflict("本月已经结算，请先重新打开本月");
    const amountCents = moneyToCents(body.amount);
    const monthDate = monthRange(month).start;
    const budget = await prisma.monthlyBudget.upsert({
      where: { month: monthDate },
      create: { month: monthDate, amountCents },
      update: { amountCents },
    });
    return NextResponse.json({ budget: { amountCents: budget.amountCents } });
  } catch (error) {
    return handleApiError(error);
  }
}
