import { Prisma, TransactionType } from "@prisma/client";
import { addMonths, billingDate, dateOnlyKey, monthDate, monthKey, parseDateOnly, todayInShanghai } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { isMonthLocked } from "@/lib/summary";

export async function syncSubscriptions(referenceDate = todayInShanghai()) {
  const currentDate = parseDateOnly(referenceDate);
  const currentMonth = referenceDate.slice(0, 7);
  const subscriptions = await prisma.subscription.findMany({
    where: { active: true },
    include: { category: true },
  });
  let created = 0;

  for (const subscription of subscriptions) {
    const firstMonth = monthKey(subscription.startMonth);
    const lastMonth = subscription.endMonth ? monthKey(subscription.endMonth) : currentMonth;
    if (firstMonth > currentMonth || firstMonth > lastMonth) continue;

    let cursor = firstMonth;
    while (cursor <= currentMonth && cursor <= lastMonth) {
      const dueDate = billingDate(cursor, subscription.billingDay);
      if (dueDate <= currentDate && !(await isMonthLocked(cursor))) {
        const existing = await prisma.transaction.findFirst({
          where: { subscriptionOccurrenceKey: `${subscription.id}:${cursor}` },
          select: { id: true },
        });

        if (!existing) {
          try {
            await prisma.transaction.create({
              data: {
                type: TransactionType.EXPENSE,
                amountCents: subscription.amountCents,
                occurredOn: dueDate,
                categoryId: subscription.categoryId,
                note: subscription.note?.trim() || `${subscription.name} · 自动记账`,
                source: "SUBSCRIPTION",
                subscriptionId: subscription.id,
                subscriptionMonth: monthDate(cursor),
                subscriptionOccurrenceKey: `${subscription.id}:${cursor}`,
              },
            });
            created += 1;
          } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
          }
        }
      }
      cursor = addMonths(cursor, 1);
    }
  }

  return { created, syncedThrough: dateOnlyKey(currentDate) };
}
