import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { withLedgerWrite } from "@/lib/ledger-write";
import { subscriptionSchema } from "@/lib/validation";
import { assertExpenseCategory, invalidateSubscriptionSyncCache, subscriptionData, subscriptionPlanData, syncSubscriptions } from "@/lib/subscriptions";
import { serializeSubscriptions, subscriptionInclude } from "@/lib/subscription-serializer";
import { initialBillingHistory } from "@/lib/billing-history";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const subscriptions = await prisma.$transaction(async (tx) => {
      const rows = await tx.subscription.findMany({ include: subscriptionInclude, orderBy: [{ active: "desc" }, { billingDay: "asc" }] });
      return serializeSubscriptions(rows, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return NextResponse.json({ subscriptions });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = subscriptionSchema.parse(await parseJsonBody(request));
    const subscription = await withLedgerWrite(async (tx) => {
      await assertExpenseCategory(body.categoryId, tx);
      const data = subscriptionData(body);
      const created = await tx.subscription.create({
        data: {
          ...data,
          billingHistory: initialBillingHistory(subscriptionPlanData(data)),
          billingPauses: body.active ? [] : [{ start: `${body.startMonth}-01`, end: null }],
        },
        include: subscriptionInclude,
      });
      await syncSubscriptions(undefined, tx);
      return (await serializeSubscriptions([created], tx))[0];
    });
    invalidateSubscriptionSyncCache();
    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
