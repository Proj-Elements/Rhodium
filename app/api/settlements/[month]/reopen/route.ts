import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { monthStart, parseMonth } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { serializeSettlement } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    const settlement = await prisma.monthlySettlement.update({ where: { month: monthStart(month) }, data: { reopenedAt: new Date() } });
    return NextResponse.json({ settlement: serializeSettlement(settlement) });
  } catch (error) {
    return handleApiError(error);
  }
}
