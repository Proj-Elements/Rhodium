import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { moneyToCents, monthDate } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { subscriptionSchema } from "@/lib/validation";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const body = await parseJsonBody(request);
    if (typeof body.active === "boolean" && Object.keys(body).length === 1) {
      const subscription = await prisma.subscription.update({ where: { id: params.id }, data: { active: body.active }, include: { category: true } });
      await syncSubscriptions();
      return NextResponse.json({ subscription });
    }
    const parsed = subscriptionSchema.parse(body);
    if (parsed.endMonth && parsed.endMonth < parsed.startMonth) return jsonError("结束月份不能早于开始月份");
    const category = await prisma.category.findFirst({ where: { id: parsed.categoryId, archivedAt: null, OR: [{ type: "EXPENSE" }, { type: "BOTH" }] } });
    if (!category) return jsonError("订阅必须使用有效的支出分类");
    const subscription = await prisma.subscription.update({
      where: { id: params.id },
      data: {
        name: parsed.name,
        amountCents: moneyToCents(parsed.amount),
        billingDay: parsed.billingDay,
        categoryId: parsed.categoryId,
        startMonth: monthDate(parsed.startMonth),
        endMonth: parsed.endMonth ? monthDate(parsed.endMonth) : null,
        active: parsed.active,
        note: parsed.note?.trim() || null,
      },
      include: { category: true },
    });
    await syncSubscriptions();
    return NextResponse.json({ subscription });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const usage = await prisma.transaction.count({ where: { subscriptionId: params.id } });
    if (usage > 0) {
      const subscription = await prisma.subscription.update({ where: { id: params.id }, data: { active: false }, include: { category: true } });
      return NextResponse.json({ subscription, archived: true });
    }
    await prisma.subscription.delete({ where: { id: params.id } });
    return NextResponse.json({ id: params.id, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
