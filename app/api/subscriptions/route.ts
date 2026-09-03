import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { moneyToCents, monthDate } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/seed";
import { subscriptionSchema } from "@/lib/validation";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDefaultCategories();
    const subscriptions = await prisma.subscription.findMany({ include: { category: true }, orderBy: [{ active: "desc" }, { billingDay: "asc" }] });
    return NextResponse.json({ subscriptions });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = subscriptionSchema.parse(await parseJsonBody(request));
    if (body.endMonth && body.endMonth < body.startMonth) return jsonError("结束月份不能早于开始月份");
    const category = await prisma.category.findFirst({ where: { id: body.categoryId, archivedAt: null, OR: [{ type: "EXPENSE" }, { type: "BOTH" }] } });
    if (!category) return jsonError("订阅必须使用有效的支出分类");
    const subscription = await prisma.subscription.create({
      data: {
        name: body.name,
        amountCents: moneyToCents(body.amount),
        billingDay: body.billingDay,
        categoryId: body.categoryId,
        startMonth: monthDate(body.startMonth),
        endMonth: body.endMonth ? monthDate(body.endMonth) : null,
        active: body.active,
        note: body.note?.trim() || null,
      },
      include: { category: true },
    });
    await syncSubscriptions();
    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
