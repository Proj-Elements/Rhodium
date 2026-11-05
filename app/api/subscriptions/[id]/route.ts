import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { withLedgerWrite } from "@/lib/ledger-write";
import { subscriptionSchema, subscriptionToggleSchema } from "@/lib/validation";
import { assertExpenseCategory, invalidateSubscriptionSyncCache, subscriptionData, syncSubscriptions } from "@/lib/subscriptions";
import { serializeSubscription, subscriptionInclude } from "@/lib/subscription-serializer";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const toggle = subscriptionToggleSchema.safeParse(body);
    const parsed = toggle.success ? null : subscriptionSchema.parse(body);
    const subscription = await withLedgerWrite(async (tx) => {
      const existing = await tx.subscription.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw notFound("固定支出不存在");
      if (parsed) await assertExpenseCategory(parsed.categoryId, tx);
      const updated = await tx.subscription.update({
        where: { id },
        data: toggle.success ? { active: toggle.data.active } : subscriptionData(parsed!),
        include: subscriptionInclude,
      });
      // Commit the plan and its materialized occurrences together. A sync failure
      // rolls back the edit instead of returning an error for a committed change.
      await syncSubscriptions(undefined, tx);
      return updated;
    });
    invalidateSubscriptionSyncCache();
    return NextResponse.json({ subscription: serializeSubscription(subscription) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    // All sync writers hold this same lock, so usage cannot appear between the
    // count and delete and be detached by ON DELETE SET NULL.
    const archived = await withLedgerWrite(async (tx) => {
      const usage = await tx.transaction.count({ where: { subscriptionId: id } });
      if (usage > 0) return tx.subscription.update({ where: { id }, data: { active: false }, include: subscriptionInclude });
      await tx.subscription.delete({ where: { id } });
      return null;
    });
    invalidateSubscriptionSyncCache();
    if (archived) return NextResponse.json({ subscription: serializeSubscription(archived), archived: true });
    return NextResponse.json({ id, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
