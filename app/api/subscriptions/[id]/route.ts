import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { withLedgerWrite } from "@/lib/ledger-write";
import { subscriptionSchema, subscriptionToggleSchema } from "@/lib/validation";
import { assertExpenseCategory, invalidateSubscriptionSyncCache, subscriptionData, subscriptionPlanData, syncSubscriptions } from "@/lib/subscriptions";
import { serializeSubscriptions, subscriptionInclude } from "@/lib/subscription-serializer";
import { changeBillingPause } from "@/lib/billing-pauses";
import { initialBillingHistory, parseBillingHistory, scheduleBillingPlan } from "@/lib/billing-history";
import { todayInShanghai } from "@/lib/domain";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const toggle = subscriptionToggleSchema.safeParse(body);
    const parsed = toggle.success ? null : subscriptionSchema.parse(body);
    const subscription = await withLedgerWrite(async (tx) => {
      const existing = await tx.subscription.findUnique({ where: { id } });
      if (!existing) throw notFound("固定支出不存在");
      if (parsed) await assertExpenseCategory(parsed.categoryId, tx);
      const today = todayInShanghai();
      const data = toggle.success ? { active: toggle.data.active } : subscriptionData(parsed!);
      const oldPlan = subscriptionPlanData(existing);
      const newPlan = parsed ? subscriptionPlanData(subscriptionData(parsed)) : oldPlan;
      const existingHistory = parseBillingHistory(existing.billingHistory);
      const history = existingHistory.length ? existingHistory : initialBillingHistory(oldPlan, today.slice(0, 7));
      const changed = JSON.stringify(oldPlan) !== JSON.stringify(newPlan);
      const updated = await tx.subscription.update({
        where: { id },
        data: {
          ...data,
          billingPauses: changeBillingPause(existing.billingPauses, !data.active, today),
          ...(changed ? { billingHistory: scheduleBillingPlan(history, newPlan, today) } : {}),
        },
        include: subscriptionInclude,
      });
      // Commit the plan and its materialized occurrences together. A sync failure
      // rolls back the edit instead of returning an error for a committed change.
      await syncSubscriptions(undefined, tx);
      return (await serializeSubscriptions([updated], tx, today))[0];
    });
    invalidateSubscriptionSyncCache();
    return NextResponse.json({ subscription });
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
      const existing = await tx.subscription.findUnique({ where: { id } });
      if (!existing) throw notFound("固定支出不存在");
      const usage = await tx.transaction.count({ where: { subscriptionId: id } });
      if (usage > 0) {
        const updated = await tx.subscription.update({
          where: { id },
          data: { active: false, billingPauses: changeBillingPause(existing.billingPauses, true, todayInShanghai()) },
          include: subscriptionInclude,
        });
        return (await serializeSubscriptions([updated], tx))[0];
      }
      await tx.subscription.delete({ where: { id } });
      return null;
    });
    invalidateSubscriptionSyncCache();
    if (archived) return NextResponse.json({ subscription: archived, archived: true });
    return NextResponse.json({ id, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
