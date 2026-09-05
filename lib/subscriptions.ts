import { TransactionType } from "@prisma/client";
import { dateOnlyKey, moneyToCents, monthStart, todayInShanghai } from "@/lib/domain";
import { badRequest } from "@/lib/errors";
import { planBillingCandidates } from "@/lib/subscription-planner";
import { prisma } from "@/lib/prisma";
import type { subscriptionSchema } from "@/lib/validation";
import type { z } from "zod";

type SubscriptionInput = z.infer<typeof subscriptionSchema>;

/**
 * Reject a subscription whose category cannot hold expenses. Both the create
 * and update routes need the same check, and the same wording.
 */
export async function assertExpenseCategory(categoryId: string): Promise<void> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, archivedAt: null, OR: [{ type: "EXPENSE" }, { type: "BOTH" }] },
    select: { id: true },
  });
  if (!category) throw badRequest("订阅必须使用有效的支出分类");
}

/** Map validated input onto the Prisma columns shared by create and update. */
export function subscriptionData(input: SubscriptionInput) {
  return {
    name: input.name,
    amountCents: moneyToCents(input.amount),
    billingDay: input.billingDay,
    categoryId: input.categoryId,
    startMonth: monthStart(input.startMonth),
    endMonth: input.endMonth ? monthStart(input.endMonth) : null,
    active: input.active,
    note: input.note?.trim() || null,
  };
}

/** Run the real sync at most once in this window; other callers reuse the result. */
const SYNC_COOLDOWN_MS = 60_000;

type SyncResult = { created: number; syncedThrough: string };

let lastSync: { at: number; referenceDate: string; result: SyncResult } | null = null;
let inFlight: { referenceDate: string; promise: Promise<SyncResult> } | null = null;

/**
 * Batched subscription sync (fixed the previous N+1: one query per month for
 * lock state and one per occurrence for existence).
 *
 * Candidate occurrences are planned in memory (see subscription-planner), then:
 *  1. one findMany fetches locked months,
 *  2. one findMany fetches existing occurrence keys,
 *  3. createMany inserts the remainder (race-safe via the unique key).
 *
 * Two layers of call reduction:
 *  - a successful run is cached for the cooldown window, so back-to-back
 *    requests reuse the result instead of re-querying the database,
 *  - concurrent callers share the in-flight promise.
 * A failed run is never cached, and the shared promise is dropped so one
 * failure cannot poison later callers.
 */
export function syncSubscriptions(referenceDate = todayInShanghai()): Promise<SyncResult> {
  if (lastSync && lastSync.referenceDate === referenceDate && Date.now() - lastSync.at < SYNC_COOLDOWN_MS) {
    return Promise.resolve(lastSync.result);
  }
  if (inFlight && inFlight.referenceDate === referenceDate) return inFlight.promise;

  const promise = runSync(referenceDate)
    .then((result) => {
      lastSync = { at: Date.now(), referenceDate, result };
      return result;
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { referenceDate, promise };
  return promise;
}

/**
 * Drop the cooldown cache so the next `syncSubscriptions()` actually runs.
 * Must be called after any mutation that changes what a sync would write —
 * subscription create/update/archive/delete and settlement reopen — otherwise
 * a cached run from the last 60 seconds answers the route's own sync call and
 * the mutation never materializes.
 */
export function invalidateSubscriptionSyncCache(): void {
  lastSync = null;
  inFlight = null;
}

/** Test-only: drop the cooldown cache so each case starts from a clean slate. */
export function resetSubscriptionSyncCache() {
  invalidateSubscriptionSyncCache();
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
