import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { moneyToCents, monthStart } from "@/lib/domain";
import { notFound } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { subscriptionSchema, subscriptionToggleSchema } from "@/lib/validation";
import { syncSubscriptions } from "@/lib/subscriptions";
import { serializeSubscription, subscriptionInclude } from "@/lib/subscription-serializer";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };


export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const existing = await prisma.subscription.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw notFound("固定支出不存在");

    // Toggle-only bodies ({ active }) are validated strictly so unknown fields
    // are rejected instead of silently ignored.
    const toggle = subscriptionToggleSchema.safeParse(body);
    if (toggle.success) {
      const subscription = await prisma.subscription.update({
        where: { id },
        data: { active: toggle.data.active },
        include: subscriptionInclude,
      });
      await syncSubscriptions();
      return NextResponse.json({ subscription: serializeSubscription(subscription) });
    }

    const parsed = subscriptionSchema.parse(body);
    const category = await prisma.category.findFirst({ where: { id: parsed.categoryId, archivedAt: null, OR: [{ type: "EXPENSE" }, { type: "BOTH" }] } });
    if (!category) return jsonError("订阅必须使用有效的支出分类");
    const subscription = await prisma.subscription.update({
      where: { id },
      data: {
        name: parsed.name,
        amountCents: moneyToCents(parsed.amount),
        billingDay: parsed.billingDay,
        categoryId: parsed.categoryId,
        startMonth: monthStart(parsed.startMonth),
        endMonth: parsed.endMonth ? monthStart(parsed.endMonth) : null,
        active: parsed.active,
        note: parsed.note?.trim() || null,
      },
      include: subscriptionInclude,
    });
    await syncSubscriptions();
    return NextResponse.json({ subscription: serializeSubscription(subscription) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const usage = await prisma.transaction.count({ where: { subscriptionId: id } });
    if (usage > 0) {
      // Keep the subscription for its historical ledger entries; just pause it.
      const subscription = await prisma.subscription.update({ where: { id }, data: { active: false }, include: subscriptionInclude });
      return NextResponse.json({ subscription: serializeSubscription(subscription), archived: true });
    }
    await prisma.subscription.delete({ where: { id } });
    return NextResponse.json({ id, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
