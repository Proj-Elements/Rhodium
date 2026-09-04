import { dateOnlyKey, monthKey } from "@/lib/domain";
import type { CategoryDTO, SubscriptionDTO } from "@/lib/types";

const subscriptionInclude = { category: true } as const;

type SubscriptionWithCategory = {
  id: string;
  name: string;
  amountCents: number;
  billingDay: number;
  categoryId: string;
  startMonth: Date;
  endMonth: Date | null;
  active: boolean;
  note: string | null;
  category: {
    id: string;
    name: string;
    type: "EXPENSE" | "INCOME" | "BOTH";
    isSystem: boolean;
    sortOrder: number;
    archivedAt: Date | null;
  };
};

/** Whitelist a Prisma Subscription into the client-facing SubscriptionDTO. */
export function serializeSubscription(subscription: SubscriptionWithCategory): SubscriptionDTO {
  return {
    id: subscription.id,
    name: subscription.name,
    amountCents: subscription.amountCents,
    billingDay: subscription.billingDay,
    categoryId: subscription.categoryId,
    category: serializeCategoryModel(subscription.category),
    startMonth: monthKey(subscription.startMonth),
    endMonth: subscription.endMonth ? monthKey(subscription.endMonth) : null,
    active: subscription.active,
    note: subscription.note,
  };
}

function serializeCategoryModel(category: SubscriptionWithCategory["category"]): CategoryDTO {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    isSystem: category.isSystem,
    sortOrder: category.sortOrder,
    archivedAt: category.archivedAt ? dateOnlyKey(category.archivedAt) : null,
  };
}

export { subscriptionInclude };
