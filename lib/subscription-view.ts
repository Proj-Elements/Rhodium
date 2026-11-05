import { addMonths, billingDate, dateOnlyKey } from "@/lib/domain";
import type { SubscriptionDTO } from "@/lib/types";

export type SubscriptionState = "current" | "upcoming" | "ended" | "paused" | "archived";

/** Classify display state without treating future, expired or archived items as current spending. */
export function subscriptionState(subscription: SubscriptionDTO, today: string): SubscriptionState {
  if (!subscription.active) return "paused";
  if (subscription.category.archivedAt) return "archived";
  const month = today.slice(0, 7);
  if (subscription.startMonth.slice(0, 7) > month) return "upcoming";
  if (subscription.endMonth && subscription.endMonth.slice(0, 7) < month) return "ended";
  return "current";
}

/** Next scheduled ledger date, clamped to month end; null for non-billing items. */
export function nextSubscriptionDate(subscription: SubscriptionDTO, today: string): string | null {
  const state = subscriptionState(subscription, today);
  if (state !== "current" && state !== "upcoming") return null;
  const startMonth = subscription.startMonth.slice(0, 7);
  const currentMonth = today.slice(0, 7);
  let month = startMonth > currentMonth ? startMonth : currentMonth;
  let date = dateOnlyKey(billingDate(month, subscription.billingDay));
  if (date < today) {
    month = addMonths(month, 1);
    date = dateOnlyKey(billingDate(month, subscription.billingDay));
  }
  return subscription.endMonth && month > subscription.endMonth.slice(0, 7) ? null : date;
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
