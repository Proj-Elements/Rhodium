import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { withLedgerWrite } from "@/lib/ledger-write";
import { subscriptionSchema } from "@/lib/validation";
import { assertExpenseCategory, invalidateSubscriptionSyncCache, subscriptionData, subscriptionPlanData, syncSubscriptions } from "@/lib/subscriptions";
import { serializeSubscriptions, subscriptionInclude } from "@/lib/subscription-serializer";
import { initialBillingHistory } from "@/lib/billing-history";
import { Prisma } from "@prisma/client";
import { creationIdentity, replayCreation } from "@/lib/idempotency";

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
    const identity = creationIdentity(request, "subscription", subscriptionData(body));
    const result = await withLedgerWrite(async (tx) => {
      const replay = await replayCreation(tx, identity);
      if (replay) return { response: replay, replayed: true };
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
      await syncSubscriptions(undefined, tx, { subscriptionIds: [created.id] });
      const response = { subscription: (await serializeSubscriptions([created], tx))[0] };
      if (identity.key) await tx.creationRequest.create({ data: { ...identity, key: identity.key, response: response as unknown as Prisma.InputJsonObject } });
      return { response, replayed: false };
    });
    invalidateSubscriptionSyncCache();
    return NextResponse.json(result.response, { status: 201, headers: { "Idempotent-Replay": String(result.replayed) } });
  } catch (error) {
    return handleApiError(error);
  }
}
