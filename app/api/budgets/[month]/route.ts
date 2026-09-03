import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody, monthRange } from "@/lib/api";
import { moneyToCents, parseMonth } from "@/lib/domain";
import { conflict } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { budgetSchema } from "@/lib/validation";
import { isMonthLocked } from "@/lib/summary";

export const dynamic = "force-dynamic";

type Context = { params: { month: string } };

export async function GET(_request: Request, { params }: Context) {
  try {
    parseMonth(params.month);
    const budget = await prisma.monthlyBudget.findUnique({ where: { month: monthRange(params.month).start } });
    return NextResponse.json({ budget: budget ? { amountCents: budget.amountCents } : null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    parseMonth(params.month);
    const body = budgetSchema.parse(await parseJsonBody(request));
    if (await isMonthLocked(params.month)) throw conflict("本月已经结算，请先重新打开本月");
    const amountCents = moneyToCents(body.amount);
    const month = monthRange(params.month).start;
    const budget = await prisma.monthlyBudget.upsert({
      where: { month },
      create: { month, amountCents },
      update: { amountCents },
    });
    return NextResponse.json({ budget: { amountCents: budget.amountCents } });
  } catch (error) {
    return handleApiError(error);
  }
}
