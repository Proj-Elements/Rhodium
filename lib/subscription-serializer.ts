import type { SubscriptionDTO } from "@/lib/types";
import { serializeCategory } from "@/lib/serializers";

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
    category: serializeCategory(subscription.category),
    startMonth: subscription.startMonth.toISOString().slice(0, 7),
    endMonth: subscription.endMonth ? subscription.endMonth.toISOString().slice(0, 7) : null,
    active: subscription.active,
    note: subscription.note,
  };
}

export { subscriptionInclude };
