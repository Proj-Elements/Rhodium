import { billingDate, monthKey, parseDateOnly } from "@/lib/domain";
import { initialBillingHistory, parseBillingHistory } from "@/lib/billing-history";
import type { BillingPause } from "@/lib/billing-pauses";

export type SubscriptionPlanInput = {
  id: string;
  amountCents: number;
  billingDay: number;
  categoryId: string;
  note: string | null;
  name: string;
  startMonth: Date;
  endMonth: Date | null;
  billingHistory?: unknown;
  billingPauses?: BillingPause[];
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
export function* iterateBillingCandidates(subscriptions: SubscriptionPlanInput[], referenceDate: string): Generator<BillingCandidate> {
  const currentDate = parseDateOnly(referenceDate);
  const currentMonth = referenceDate.slice(0, 7);

  for (const subscription of subscriptions) {
    const history = subscription.billingHistory === undefined ? initialBillingHistory({
      ...subscription,
      startMonth: monthKey(subscription.startMonth),
      endMonth: subscription.endMonth ? monthKey(subscription.endMonth) : null,
    }) : parseBillingHistory(subscription.billingHistory);
    for (let index = 0; index < history.length; index += 1) {
      const plan = history[index];
      let cursor = plan.effectiveMonth > plan.startMonth ? plan.effectiveMonth : plan.startMonth;
      const nextEffectiveMonth = history[index + 1]?.effectiveMonth;
      let lastMonth = plan.endMonth && plan.endMonth < currentMonth ? plan.endMonth : currentMonth;
      if (nextEffectiveMonth && nextEffectiveMonth <= lastMonth) lastMonth = addMonths(nextEffectiveMonth, -1);
      while (cursor <= lastMonth) {
        const dueDate = billingDate(cursor, plan.billingDay);
        const date = dueDate.toISOString().slice(0, 10);
        const pause = subscription.billingPauses?.find((item) => date >= item.start && (item.end === null || date < item.end));
        if (pause) {
          if (pause.end === null) break;
          const resumeMonth = pause.end.slice(0, 7);
          cursor = resumeMonth > cursor ? resumeMonth : addMonths(cursor, 1);
          continue;
        }
        if (dueDate <= currentDate) {
          yield {
            subscriptionId: subscription.id,
            month: cursor,
            dueDate,
            amountCents: plan.amountCents,
            categoryId: plan.categoryId,
            note: plan.note?.trim() || `${plan.name} · 自动记账`,
          };
        }
        if (cursor === lastMonth) break;
        cursor = addMonths(cursor, 1);
      }
    }
  }
}

export function planBillingCandidates(subscriptions: SubscriptionPlanInput[], referenceDate: string): BillingCandidate[] {
  return Array.from(iterateBillingCandidates(subscriptions, referenceDate));
}

function addMonths(month: string, offset: number): string {
  const [year, value] = month.split("-").map(Number);
  const total = year * 12 + (value - 1) + offset;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}
