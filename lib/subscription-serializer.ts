import type { SubscriptionDTO } from "@/lib/types";
import { serializeCategory, type CategoryLike } from "@/lib/serializers";
import { effectiveBillingPlan, parseBillingHistory } from "@/lib/billing-history";
import { parseBillingPauses } from "@/lib/billing-pauses";
import { todayInShanghai } from "@/lib/domain";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const subscriptionInclude = { category: true } as const;

type SubscriptionWithCategory = {
  id: string;
  version?: number;
  name: string;
  amountCents: number;
  billingDay: number;
  categoryId: string;
  startMonth: Date;
  endMonth: Date | null;
  active: boolean;
  note: string | null;
  billingHistory?: unknown;
  billingPauses?: unknown;
  category: CategoryLike;
};

function serializeBillingCategory(category: CategoryLike & { billingPauses?: unknown }) {
  return { ...serializeCategory(category), billingPauses: parseBillingPauses(category.billingPauses ?? []) };
}

/** Whitelist a Prisma Subscription into the client-facing SubscriptionDTO. */
export function serializeSubscription(subscription: SubscriptionWithCategory, today = todayInShanghai(), currentCategory?: CategoryLike | null): SubscriptionDTO {
  const billingHistory = parseBillingHistory(subscription.billingHistory ?? []);
  const month = today.slice(0, 7);
  const currentPlan = effectiveBillingPlan(billingHistory, month);
  const category = currentCategory === undefined
    ? (currentPlan?.categoryId === subscription.categoryId ? subscription.category : null)
    : currentCategory;
  return {
    id: subscription.id,
    version: subscription.version ?? 1,
    name: subscription.name,
    amountCents: subscription.amountCents,
    billingDay: subscription.billingDay,
    categoryId: subscription.categoryId,
    category: serializeBillingCategory(subscription.category),
    startMonth: subscription.startMonth.toISOString().slice(0, 7),
    endMonth: subscription.endMonth ? subscription.endMonth.toISOString().slice(0, 7) : null,
    active: subscription.active,
    note: subscription.note,
    billingHistory,
    billingPauses: parseBillingPauses(subscription.billingPauses ?? []),
    billingEffectiveMonth: billingHistory.at(-1)?.effectiveMonth ?? null,
    currentAmountCents: currentPlan && currentPlan.startMonth <= month && (!currentPlan.endMonth || month <= currentPlan.endMonth) ? currentPlan.amountCents : null,
    currentCategory: category ? serializeBillingCategory(category) : null,
  };
}

export async function serializeSubscriptions(subscriptions: SubscriptionWithCategory[], db: Prisma.TransactionClient = prisma, today = todayInShanghai()): Promise<SubscriptionDTO[]> {
  const month = today.slice(0, 7);
  const categoryIds = [...new Set(subscriptions.flatMap((subscription) => {
    const plan = effectiveBillingPlan(parseBillingHistory(subscription.billingHistory ?? []), month);
    return plan ? [plan.categoryId] : [];
  }))];
  const byId = new Map<string, CategoryLike>();
  for (let offset = 0; offset < categoryIds.length; offset += 500) {
    const categories = await db.category.findMany({ where: { id: { in: categoryIds.slice(offset, offset + 500) } } });
    for (const category of categories) byId.set(category.id, category);
  }
  return subscriptions.map((subscription) => {
    const plan = effectiveBillingPlan(parseBillingHistory(subscription.billingHistory ?? []), month);
    return serializeSubscription(subscription, today, plan ? byId.get(plan.categoryId) ?? null : null);
  });
}

export { subscriptionInclude };
