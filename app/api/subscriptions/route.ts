import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { moneyToCents, monthStart } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { subscriptionSchema } from "@/lib/validation";
import { syncSubscriptions } from "@/lib/subscriptions";
import { serializeSubscription, subscriptionInclude } from "@/lib/subscription-serializer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const subscriptions = await prisma.subscription.findMany({ include: subscriptionInclude, orderBy: [{ active: "desc" }, { billingDay: "asc" }] });
    return NextResponse.json({ subscriptions: subscriptions.map(serializeSubscription) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = subscriptionSchema.parse(await parseJsonBody(request));
    const category = await prisma.category.findFirst({ where: { id: body.categoryId, archivedAt: null, OR: [{ type: "EXPENSE" }, { type: "BOTH" }] } });
    if (!category) return NextResponse.json({ error: "订阅必须使用有效的支出分类" }, { status: 400 });
    const subscription = await prisma.subscription.create({
      data: {
        name: body.name,
        amountCents: moneyToCents(body.amount),
        billingDay: body.billingDay,
        categoryId: body.categoryId,
        startMonth: monthStart(body.startMonth),
        endMonth: body.endMonth ? monthStart(body.endMonth) : null,
        active: body.active,
        note: body.note?.trim() || null,
      },
      include: subscriptionInclude,
    });
    await syncSubscriptions();
    return NextResponse.json({ subscription: serializeSubscription(subscription) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
