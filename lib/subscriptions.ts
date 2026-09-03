import { TransactionType } from "@prisma/client";
import { dateOnlyKey, monthStart, todayInShanghai } from "@/lib/domain";
import { planBillingCandidates } from "@/lib/subscription-planner";
import { prisma } from "@/lib/prisma";

/** Run the real sync at most once in this window; other callers reuse the result. */
const SYNC_COOLDOWN_MS = 60_000;

let lastSyncAt = 0;
let lastSyncPromise: Promise<{ created: number; syncedThrough: string }> | null = null;

/**
 * Batched subscription sync (fixed the previous N+1: one query per month for
 * lock state and one per occurrence for existence).
 *
 * Candidate occurrences are planned in memory (see subscription-planner), then:
 *  1. one findMany fetches locked months,
 *  2. one findMany fetches existing occurrence keys,
 *  3. createMany inserts the remainder (race-safe via the unique key).
 *
 * Calls are debounced: within the cooldown window every caller shares the
 * in-flight/last result instead of re-querying the database.
 */
export function syncSubscriptions(referenceDate = todayInShanghai()) {
  const now = Date.now();
  if (lastSyncPromise && now - lastSyncAt < SYNC_COOLDOWN_MS) return lastSyncPromise;
  lastSyncAt = now;
  lastSyncPromise = runSync(referenceDate).finally(() => {
    lastSyncPromise = null;
  });
  return lastSyncPromise;
}

async function runSync(referenceDate: string) {
  const subscriptions = await prisma.subscription.findMany({
    where: { active: true },
    select: { id: true, amountCents: true, billingDay: true, categoryId: true, note: true, name: true, startMonth: true, endMonth: true },
  });

  const candidates = planBillingCandidates(subscriptions, referenceDate);
  if (!candidates.length) return { created: 0, syncedThrough: dateOnlyKey(new Date(`${referenceDate}T00:00:00.000Z`)) };

  const candidateMonths = [...new Set(candidates.map((candidate) => candidate.month))];
  const [lockedMonths, existingKeys] = await Promise.all([
    prisma.monthlySettlement.findMany({
      where: { month: { in: candidateMonths.map(monthStart) }, reopenedAt: null },
      select: { month: true },
    }).then((rows) => new Set(rows.map((row) => monthKeyOf(row.month)))),
    prisma.transaction.findMany({
      where: { subscriptionOccurrenceKey: { in: candidates.map((candidate) => `${candidate.subscriptionId}:${candidate.month}`) } },
      select: { subscriptionOccurrenceKey: true },
    }).then((rows) => new Set(rows.map((row) => row.subscriptionOccurrenceKey))),
  ]);

  const missing = candidates.filter(
    (candidate) => !lockedMonths.has(candidate.month) && !existingKeys.has(`${candidate.subscriptionId}:${candidate.month}`),
  );
  if (!missing.length) return { created: 0, syncedThrough: dateOnlyKey(new Date(`${referenceDate}T00:00:00.000Z`)) };

  const result = await prisma.transaction.createMany({
    data: missing.map((candidate) => ({
      type: TransactionType.EXPENSE,
      amountCents: candidate.amountCents,
      occurredOn: candidate.dueDate,
      categoryId: candidate.categoryId,
      note: candidate.note,
      source: "SUBSCRIPTION" as const,
      subscriptionId: candidate.subscriptionId,
      subscriptionMonth: monthStart(candidate.month),
      subscriptionOccurrenceKey: `${candidate.subscriptionId}:${candidate.month}`,
    })),
    skipDuplicates: true,
  });

  return { created: result.count, syncedThrough: dateOnlyKey(new Date(`${referenceDate}T00:00:00.000Z`)) };
}

function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}
