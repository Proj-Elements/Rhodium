import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { monthDate, moneyToCents, parseMonth } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { budgetSchema } from "@/lib/validation";
import { isMonthLocked } from "@/lib/summary";

export const dynamic = "force-dynamic";

type Context = { params: { month: string } };

export async function GET(_request: Request, { params }: Context) {
  try {
    parseMonth(params.month);
    const budget = await prisma.monthlyBudget.findUnique({ where: { month: monthDate(params.month) } });
    return NextResponse.json({ budget: budget ? { ...budget, month: params.month } : null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    parseMonth(params.month);
    const body = budgetSchema.parse(await parseJsonBody(request));
    if (await isMonthLocked(params.month)) return jsonError("本月已经结算，请先重新打开本月", 409);
    const amountCents = moneyToCents(body.amount);
    const month = monthDate(params.month);
    if (amountCents < 0) return jsonError("预算不能为负数");
    const budget = await prisma.monthlyBudget.upsert({
      where: { month },
      create: { month, amountCents },
      update: { amountCents },
    });
    return NextResponse.json({ budget: { ...budget, month: params.month } });
  } catch (error) {
    return handleApiError(error);
  }
}
