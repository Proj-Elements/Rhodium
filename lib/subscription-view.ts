import { addMonths, billingDate, dateOnlyKey } from "@/lib/domain";
import type { SubscriptionDTO } from "@/lib/types";
import { effectiveBillingPlan } from "@/lib/billing-history";
import { isBillingPaused } from "@/lib/billing-pauses";

export type SubscriptionState = "current" | "upcoming" | "ended" | "paused" | "archived";

export function subscriptionCountsForMonth(subscription: SubscriptionDTO, today: string): boolean {
  const month = today.slice(0, 7);
  const plan = effectiveBillingPlan(subscription.billingHistory, month);
  if (!plan || plan.startMonth > month || (plan.endMonth && plan.endMonth < month)) return false;
  const date = dateOnlyKey(billingDate(month, plan.billingDay));
  const category = subscription.currentCategory ?? subscription.category;
  if (category.id !== plan.categoryId) return false;
  if ((!subscription.active && !subscription.billingPauses.length) || (category.archivedAt && !category.billingPauses?.length)) return false;
  return !isBillingPaused([...subscription.billingPauses, ...(category.billingPauses ?? [])], date);
}

/** Classify display state without treating future, expired or archived items as current spending. */
export function subscriptionState(subscription: SubscriptionDTO, today: string): SubscriptionState {
  if (!subscription.active) return "paused";
  const month = today.slice(0, 7);
  const history = subscription.billingHistory ?? [];
  const plan = history.length ? effectiveBillingPlan(history, month) : subscription;
  if (!plan || plan.startMonth.slice(0, 7) > month) return "upcoming";
  const category = subscription.currentCategory ?? subscription.category;
  if (category.archivedAt && plan.categoryId === category.id) return "archived";
  if (plan.endMonth && plan.endMonth.slice(0, 7) < month) {
    return history.some((item) => item.effectiveMonth > month && (!item.endMonth || item.endMonth >= item.effectiveMonth)) ? "upcoming" : "ended";
  }
  return "current";
}

/** Next scheduled ledger date, clamped to month end; null for non-billing items. */
export function nextSubscriptionDate(subscription: SubscriptionDTO, today: string): string | null {
  if (!subscription.active) return null;
  const currentMonth = today.slice(0, 7);
  const history = subscription.billingHistory?.length ? subscription.billingHistory : [{
    ...subscription,
    effectiveMonth: subscription.startMonth.slice(0, 7),
    startMonth: subscription.startMonth.slice(0, 7),
    endMonth: subscription.endMonth?.slice(0, 7) ?? null,
  }];
  for (let index = 0; index < history.length; index += 1) {
    const plan = history[index];
    let month = [currentMonth, plan.effectiveMonth, plan.startMonth].sort().at(-1)!;
    const nextEffectiveMonth = history[index + 1]?.effectiveMonth;
    while ((!plan.endMonth || month <= plan.endMonth) && (!nextEffectiveMonth || month < nextEffectiveMonth)) {
      const category = plan.categoryId === subscription.currentCategory?.id ? subscription.currentCategory : subscription.category;
      if (category.archivedAt && plan.categoryId === category.id) break;
      const date = dateOnlyKey(billingDate(month, plan.billingDay));
      if (date < today) {
        month = addMonths(month, 1);
        continue;
      }
      const pause = [...(subscription.billingPauses ?? []), ...(plan.categoryId === category.id ? category.billingPauses ?? [] : [])].find((item) => isBillingPaused([item], date));
      if (!pause) return date;
      if (pause.end === null) break;
      const resumeMonth = pause.end.slice(0, 7);
      month = resumeMonth > month ? resumeMonth : addMonths(month, 1);
    }
  }
  return null;
}

/** Reflect the server's distinct hard-delete and historical-item archive outcomes. */
export function applySubscriptionRemoval(
  items: SubscriptionDTO[],
  id: string,
  result: { deleted?: boolean; subscription?: SubscriptionDTO },
): SubscriptionDTO[] {
  if (result.deleted) return items.filter((item) => item.id !== id);
  return items.map((item) =>
    item.id === id ? result.subscription || { ...item, active: false } : item,
  );
}
