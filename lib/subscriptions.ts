import { TransactionType, type Prisma } from "@prisma/client";
import { withLedgerWrite } from "@/lib/ledger-write";
import { dateOnlyKey, moneyToCents, monthStart, todayInShanghai } from "@/lib/domain";
import { badRequest, conflict } from "@/lib/errors";
import { iterateBillingCandidates, type BillingCandidate } from "@/lib/subscription-planner";
import { parseBillingHistory, type BillingPlanData } from "@/lib/billing-history";
import { isBillingPaused, parseBillingPauses } from "@/lib/billing-pauses";
import { prisma } from "@/lib/prisma";
import { transactionSnapshot } from "@/lib/transaction-history";
import type { subscriptionSchema } from "@/lib/validation";
import type { z } from "zod";

type SubscriptionInput = z.infer<typeof subscriptionSchema>;

/**
 * Reject a subscription whose category cannot hold expenses. Both the create
 * and update routes need the same check, and the same wording.
 */
export async function assertExpenseCategory(categoryId: string, db: Prisma.TransactionClient = prisma): Promise<void> {
  const category = await db.category.findFirst({
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

export function subscriptionPlanData(subscription: {
  name: string;
  amountCents: number;
  billingDay: number;
  categoryId: string;
  startMonth: Date;
  endMonth: Date | null;
  note: string | null;
}): BillingPlanData {
  return {
    name: subscription.name,
    amountCents: subscription.amountCents,
    billingDay: subscription.billingDay,
    categoryId: subscription.categoryId,
    startMonth: monthKeyOf(subscription.startMonth),
    endMonth: subscription.endMonth ? monthKeyOf(subscription.endMonth) : null,
    note: subscription.note,
  };
}

/** Run the real sync at most once in this window; other callers reuse the result. */
const SYNC_COOLDOWN_MS = 60_000;

type SyncResult = {
  created: number;
  syncedThrough: string;
  skippedUnknownHistory: number;
  historyWarnings: { subscriptionId: string; knownFrom: string | null }[];
};

let syncGeneration = 0;
let lastSync: { at: number; referenceDate: string; result: SyncResult } | null = null;
let inFlight: { referenceDate: string; promise: Promise<SyncResult> } | null = null;

/**
 * Stream planned occurrences in batches of 500 under one ledger transaction.
 * Each batch reads its categories, lock states and existing occurrence keys,
 * then writes missing charges and their audit history together. The lock cache
 * retains only the preceding batch's months; no full candidate list is held.
 *
 * Two layers of call reduction:
 *  - a successful run is cached for the cooldown window, so back-to-back
 *    requests reuse the result instead of re-querying the database,
 *  - concurrent callers share the in-flight promise.
 * A failed run is never cached, and the shared promise is dropped so one
 * failure cannot poison later callers.
 */
export function syncSubscriptions(referenceDate = todayInShanghai(), tx?: Prisma.TransactionClient): Promise<SyncResult> {
  // A caller already holding the ledger lock must see its uncommitted mutation
  // and must never join a cached/in-flight run on a different connection.
  if (tx) return runSync(referenceDate, tx).catch(syncError);
  if (lastSync && lastSync.referenceDate === referenceDate && Date.now() - lastSync.at < SYNC_COOLDOWN_MS) {
    return Promise.resolve(lastSync.result);
  }
  if (inFlight && inFlight.referenceDate === referenceDate) return inFlight.promise;

  const generation = syncGeneration;
  const promise = withLedgerWrite((db) => runSync(referenceDate, db))
    .then((result) => {
      if (generation === syncGeneration) lastSync = { at: Date.now(), referenceDate, result };
      return result;
    })
    .catch(syncError)
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { referenceDate, promise };
  return promise;
}

function syncError(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "P2028") {
    throw conflict("固定支出同步超时，全部更改已回滚。请缩短新订阅的自动补记区间，较早账目可通过导入恢复");
  }
  throw error;
}

/**
 * Drop the cooldown cache so the next `syncSubscriptions()` actually runs.
 * Must be called after any mutation that changes what a sync would write —
 * subscription create/update/archive/delete and settlement reopen — otherwise
 * a cached run from the last 60 seconds answers the route's own sync call and
 * the mutation never materializes.
 */
export function invalidateSubscriptionSyncCache(): void {
  syncGeneration += 1;
  lastSync = null;
  inFlight = null;
}

/** Test-only: drop the cooldown cache so each case starts from a clean slate. */
export function resetSubscriptionSyncCache() {
  invalidateSubscriptionSyncCache();
}

async function runSync(referenceDate: string, prisma: Prisma.TransactionClient) {
  const subscriptions = await prisma.subscription.findMany({
    select: { id: true, amountCents: true, billingDay: true, categoryId: true, note: true, name: true, startMonth: true, endMonth: true, active: true, billingPauses: true, billingHistory: true },
  });
  const currentMonth = referenceDate.slice(0, 7);
  const historyWarnings = subscriptions.flatMap((subscription) => {
    const knownFrom = parseBillingHistory(subscription.billingHistory)[0]?.effectiveMonth ?? null;
    return monthKeyOf(subscription.startMonth) <= currentMonth && (!knownFrom || knownFrom > monthKeyOf(subscription.startMonth))
      ? [{ subscriptionId: subscription.id, knownFrom }]
      : [];
  });
  const summary = { syncedThrough: dateOnlyKey(new Date(`${referenceDate}T00:00:00.000Z`)), skippedUnknownHistory: historyWarnings.length, historyWarnings };
  const usable = subscriptions.filter((subscription) => subscription.active || parseBillingPauses(subscription.billingPauses).length > 0).map((subscription) => ({
    ...subscription,
    billingPauses: parseBillingPauses(subscription.billingPauses),
  }));
  let created = 0;
  let batch: BillingCandidate[] = [];
  const monthLocks = new Map<string, boolean>();
  const flush = async () => {
    const categories = await prisma.category.findMany({
      where: { id: { in: [...new Set(batch.map((candidate) => candidate.categoryId))] } },
      select: { id: true, type: true, archivedAt: true, billingPauses: true },
    });
    const categoryById = new Map(categories.map((category) => [category.id, { ...category, pauses: parseBillingPauses(category.billingPauses) }]));
    const candidates = batch.filter((candidate) => {
      const category = categoryById.get(candidate.categoryId);
      if (!category || category.type === "INCOME") return false;
      if (category.archivedAt && !category.pauses.some((pause) => pause.end === null)) return false;
      return !isBillingPaused(category.pauses, dateOnlyKey(candidate.dueDate));
    });
    batch = [];
    if (!candidates.length) return;
    const candidateMonths = [...new Set(candidates.map((candidate) => candidate.month))];
    const unknownMonths = candidateMonths.filter((month) => !monthLocks.has(month));
    const [lockedMonths, existingKeys] = await Promise.all([
      unknownMonths.length ? prisma.monthlySettlement.findMany({
        where: { month: { in: unknownMonths.map(monthStart) }, reopenedAt: null },
        select: { month: true },
      }).then((rows) => new Set(rows.map((row) => monthKeyOf(row.month)))) : Promise.resolve(new Set<string>()),
      prisma.transaction.findMany({
        where: { subscriptionOccurrenceKey: { in: candidates.map((candidate) => `${candidate.subscriptionId}:${candidate.month}`) } },
        select: { subscriptionOccurrenceKey: true },
      }).then((rows) => new Set(rows.map((row) => row.subscriptionOccurrenceKey))),
    ]);
    for (const month of unknownMonths) monthLocks.set(month, lockedMonths.has(month));
    const missing = candidates.filter(
      (candidate) => !monthLocks.get(candidate.month) && !existingKeys.has(`${candidate.subscriptionId}:${candidate.month}`),
    );
    const retainedLocks = candidateMonths.map((month) => [month, monthLocks.get(month) ?? false] as const);
    monthLocks.clear();
    for (const [month, locked] of retainedLocks) monthLocks.set(month, locked);
    if (!missing.length) return;
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
    created += result.count;
    if (!Number.isSafeInteger(created)) throw conflict("同步账目数量超出安全计数范围，全部更改已回滚");
    const transactions = await prisma.transaction.findMany({
      where: { subscriptionOccurrenceKey: { in: missing.map((candidate) => `${candidate.subscriptionId}:${candidate.month}`) } },
      include: { category: { select: { name: true } } },
    });
    await prisma.transactionHistory.createMany({
      data: transactions.map((transaction) => ({
        transactionId: transaction.id,
        version: transaction.version,
        action: "create",
        after: transactionSnapshot(transaction),
      })),
      skipDuplicates: true,
    });
  };
  for (const candidate of iterateBillingCandidates(usable, referenceDate)) {
    batch.push(candidate);
    if (batch.length === 500) await flush();
  }
  if (batch.length) await flush();
  return { created, ...summary };
}

function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}
