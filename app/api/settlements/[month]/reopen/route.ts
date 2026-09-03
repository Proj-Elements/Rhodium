import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { monthDate, parseMonth } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Context = { params: { month: string } };

export async function POST(_request: Request, { params }: Context) {
  try {
    parseMonth(params.month);
    const settlement = await prisma.monthlySettlement.update({ where: { month: monthDate(params.month) }, data: { reopenedAt: new Date() } });
    return NextResponse.json({ settlement: { ...settlement, month: params.month } });
  } catch (error) {
    return handleApiError(error);
  }
}
