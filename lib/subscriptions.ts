import { TransactionType, type Prisma } from "@prisma/client";
import { withLedgerWrite } from "@/lib/ledger-write";
import { addMonths, dateOnlyKey, moneyToCents, monthEnd, monthStart, parseDateOnly, todayInShanghai } from "@/lib/domain";
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

export type SyncResult = {
  created: number;
  syncedThrough: string;
  skippedUnknownHistory: number;
  historyWarnings: { subscriptionId: string; knownFrom: string | null }[];
};

type SyncScope = { subscriptionIds?: string[]; month?: string; fromMonth?: string; throughMonth?: string };

let syncGeneration = 0;
let lastSync: { at: number; referenceDate: string; result: SyncResult } | null = null;
let inFlight: { referenceDate: string; promise: Promise<SyncResult> } | null = null;

/**
 * Background/manual runs commit at most 12 months of one subscription per
 * ledger transaction and persist their progress. Each occurrence and its audit
 * entry commit together; failed runs resume from the last successful batch.
 * Calls with an existing transaction remain atomic with the enclosing mutation.
 *
 * Two layers of call reduction:
 *  - a successful run is cached for the cooldown window, so back-to-back
 *    requests reuse the result instead of re-querying the database,
 *  - concurrent callers share the in-flight promise.
 * A failed run is never cached, and the shared promise is dropped so one
 * failure cannot poison later callers.
 */
export function syncSubscriptions(referenceDate = todayInShanghai(), tx?: Prisma.TransactionClient, scope: SyncScope = {}): Promise<SyncResult> {
  parseDateOnly(referenceDate);
  // A caller already holding the ledger lock must see its uncommitted mutation
  // and must never join a cached/in-flight run on a different connection.
  if (tx) return runSync(referenceDate, tx, scope).catch(syncError);
  if (Object.keys(scope).length) return withLedgerWrite((db) => runSync(referenceDate, db, scope)).catch(syncError);
  if (lastSync && lastSync.referenceDate === referenceDate && Date.now() - lastSync.at < SYNC_COOLDOWN_MS) {
    return Promise.resolve(lastSync.result);
  }
  if (inFlight && inFlight.referenceDate === referenceDate) return inFlight.promise;

  const generation = syncGeneration;
  const promise = runBatchedSync(referenceDate)
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

async function runBatchedSync(referenceDate: string): Promise<SyncResult> {
  const result: SyncResult = { created: 0, syncedThrough: referenceDate, skippedUnknownHistory: 0, historyWarnings: [] };
  const currentMonth = referenceDate.slice(0, 7);
  // Snapshot only the identities before writing. A keyset scan can skip a new
  // subscription inserted behind its cursor; those creates are synced by their
  // own route, while this snapshot guarantees every pre-existing plan is seen.
  const subscriptionIds = (await prisma.subscription.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
  })).map((subscription) => subscription.id);
  for (let offset = 0; offset < subscriptionIds.length; offset += 100) {
    const batch = subscriptionIds.slice(offset, offset + 100);
    for (const subscriptionId of batch) {
      let done = false;
      let reported = false;
      while (!done) {
        const step = await withLedgerWrite(async (tx) => {
          const existing = await tx.subscription.findUnique({ where: { id: subscriptionId } });
          if (!existing) return null;
          const knownFrom = parseBillingHistory(existing.billingHistory)[0]?.effectiveMonth;
          let fromMonth = knownFrom && knownFrom > monthKeyOf(existing.startMonth) ? knownFrom : monthKeyOf(existing.startMonth);
          if (existing.syncedThrough) {
            const previousMonth = monthKeyOf(existing.syncedThrough);
            fromMonth = dateOnlyKey(existing.syncedThrough) === dateOnlyKey(monthEnd(previousMonth)) && previousMonth < currentMonth ? addMonths(previousMonth, 1) : previousMonth;
          }
          if (fromMonth > currentMonth || !knownFrom) fromMonth = currentMonth;
          const monthsLeft = (Number(currentMonth.slice(0, 4)) - Number(fromMonth.slice(0, 4))) * 12 + Number(currentMonth.slice(5, 7)) - Number(fromMonth.slice(5, 7));
          const throughMonth = addMonths(fromMonth, Math.min(11, monthsLeft));
          const synced = await runSync(referenceDate, tx, { subscriptionIds: [subscriptionId], fromMonth, throughMonth });
          await tx.subscription.update({ where: { id: subscriptionId }, data: { syncedThrough: throughMonth === currentMonth ? new Date(`${referenceDate}T00:00:00.000Z`) : monthEnd(throughMonth) } });
          return { synced, done: throughMonth === currentMonth };
        }, { timeout: 15_000 });
        if (!step) break;
        done = step.done;
        result.created += step.synced.created;
        if (!reported) {
          result.historyWarnings.push(...step.synced.historyWarnings);
          reported = true;
        }
      }
    }
  }
  result.skippedUnknownHistory = result.historyWarnings.length;
  return result;
}

function syncError(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "P2028") {
    throw conflict("固定支出同步超时，当前批次已回滚；已完成的批次会保留。请读取账本核对，稍后重试将继续补记");
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

async function runSync(referenceDate: string, prisma: Prisma.TransactionClient, scope: SyncScope = {}) {
  const subscriptions = await prisma.subscription.findMany({
    ...(scope.subscriptionIds ? { where: { id: { in: scope.subscriptionIds } } } : {}),
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
  for (const candidate of iterateBillingCandidates(usable, referenceDate, { fromMonth: scope.month ?? scope.fromMonth, throughMonth: scope.month ?? scope.throughMonth })) {
    batch.push(candidate);
    if (batch.length === 500) await flush();
  }
  if (batch.length) await flush();
  if (scope.subscriptionIds && !scope.month && !scope.fromMonth && !scope.throughMonth) await prisma.subscription.updateMany({ where: { id: { in: scope.subscriptionIds } }, data: { syncedThrough: new Date(`${referenceDate}T00:00:00.000Z`) } });
  return { created, ...summary };
}

function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}
