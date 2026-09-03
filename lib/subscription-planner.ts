import { billingDate, monthKey, parseDateOnly } from "@/lib/domain";

export type SubscriptionPlanInput = {
  id: string;
  amountCents: number;
  billingDay: number;
  categoryId: string;
  note: string | null;
  name: string;
  startMonth: Date;
  endMonth: Date | null;
};

export type BillingCandidate = {
  subscriptionId: string;
  month: string;
  dueDate: Date;
  amountCents: number;
  categoryId: string;
  note: string;
};

/**
 * Pure planner: which (subscription, month) occurrences should exist as of
 * `referenceDate`? Used by the batched sync; unit-tested for billing-day
 * clamping, start/end windows, and already-passed filtering.
 */
export function planBillingCandidates(subscriptions: SubscriptionPlanInput[], referenceDate: string): BillingCandidate[] {
  const currentDate = parseDateOnly(referenceDate);
  const currentMonth = referenceDate.slice(0, 7);
  const candidates: BillingCandidate[] = [];

  for (const subscription of subscriptions) {
    const firstMonth = monthKey(subscription.startMonth);
    const lastMonth = subscription.endMonth ? monthKey(subscription.endMonth) : currentMonth;
    if (firstMonth > currentMonth || firstMonth > lastMonth) continue;

    let cursor = firstMonth;
    while (cursor <= currentMonth && cursor <= lastMonth) {
      const dueDate = billingDate(cursor, subscription.billingDay);
      if (dueDate <= currentDate) {
        candidates.push({
          subscriptionId: subscription.id,
          month: cursor,
          dueDate,
          amountCents: subscription.amountCents,
          categoryId: subscription.categoryId,
          note: subscription.note?.trim() || `${subscription.name} · 自动记账`,
        });
      }
      cursor = addMonths(cursor, 1);
    }
  }
  return candidates;
}

function addMonths(month: string, offset: number): string {
  const [year, value] = month.split("-").map(Number);
  const total = year * 12 + (value - 1) + offset;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}
