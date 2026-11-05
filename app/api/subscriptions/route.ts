import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { withLedgerWrite } from "@/lib/ledger-write";
import { subscriptionSchema } from "@/lib/validation";
import { assertExpenseCategory, invalidateSubscriptionSyncCache, subscriptionData, syncSubscriptions } from "@/lib/subscriptions";
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
    const subscription = await withLedgerWrite(async (tx) => {
      await assertExpenseCategory(body.categoryId, tx);
      const created = await tx.subscription.create({ data: subscriptionData(body), include: subscriptionInclude });
      await syncSubscriptions(undefined, tx);
      return created;
    });
    invalidateSubscriptionSyncCache();
    return NextResponse.json({ subscription: serializeSubscription(subscription) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
