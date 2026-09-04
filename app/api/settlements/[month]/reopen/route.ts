import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { monthStart, parseMonth } from "@/lib/domain";
import { conflict, notFound } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeSettlement } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    // Explicit existence check: relying on P2025 produced the generic "请求的数据不存在".
    const existing = await prisma.monthlySettlement.findUnique({ where: { month: monthStart(month) }, select: { reopenedAt: true } });
    if (!existing) throw notFound("这个月还没有结算，无需重新打开");
    if (existing.reopenedAt) throw conflict("这个月已经是打开状态");
    const settlement = await prisma.monthlySettlement.update({ where: { month: monthStart(month) }, data: { reopenedAt: new Date() } });
    return NextResponse.json({ settlement: serializeSettlement(settlement) });
  } catch (error) {
    return handleApiError(error);
  }
}
