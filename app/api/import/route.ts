import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { handleApiError, MAX_IMPORT_BODY_BYTES, parseJsonBody } from "@/lib/api";
import { monthKey, monthStart, todayInShanghai } from "@/lib/domain";
import {
  normalizeRow,
  parseBoolean,
  parseCategoryType,
  parseCents,
  parseMonthValue,
  parseSignedCents,
  optionalDate,
  optionalDateTime,
  type NormalizedRow,
} from "@/lib/import-parser";
import { conflict } from "@/lib/errors";
import { changeBillingPause } from "@/lib/billing-pauses";
import { initialBillingHistory } from "@/lib/billing-history";
import { canonicalBackupValue, restoreBackupHistory } from "@/lib/backup-history";
import { importChunks, summarizeImport } from "@/lib/import-summary";
import { recordTransactionHistory, transactionSnapshot } from "@/lib/transaction-history";
import { recordSettlementHistory } from "@/lib/settlement-history";
import { withLedgerWrite } from "@/lib/ledger-write";
import { invalidateSubscriptionSyncCache } from "@/lib/subscriptions";
import { ensureDefaultCategories } from "@/lib/seed";
import { importSchema, type BackupPayload } from "@/lib/backup-validation";
import { CategoryType, Prisma, TransactionType, type Category } from "@prisma/client";

export const dynamic = "force-dynamic";

type Tx = Prisma.TransactionClient;
type StoredTransaction = Prisma.TransactionGetPayload<{ include: { category: { select: { name: true } } } }>;

const CREATE_CHUNK = 500;
const UPSERT_CHUNK = 25;
/** Bound the complete atomic restore so it cannot pin a connection indefinitely. */
const IMPORT_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 15_000 } as const;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

/**
 * Category ids correlate the backup with local natural keys. Subscriptions keep
 * their validated backup identities: names are not unique, so name-based merging
 * would collapse separate recurring expenses and lose occurrence rows.
 */
type IdMap = { categories: Map<string, string>; subscriptions: Map<string, string> };

/**
 * Reconcile the subscriptionOccurrenceKeys a row set wants to write against the
 * keys already in the database. A different stable identity is a restore
 * conflict; dropping either row would silently lose accounting facts.
 */
async function reconcileOccurrenceKeys(tx: Tx, wanted: Map<string, string | null>): Promise<void> {
  const keys = [...wanted.keys()];
  if (!keys.length) return;
  const existing = [];
  for (const batch of importChunks(keys)) existing.push(...await tx.transaction.findMany({
    where: { subscriptionOccurrenceKey: { in: batch } },
    select: { id: true, subscriptionOccurrenceKey: true },
  }));
  for (const row of existing) {
    const key = row.subscriptionOccurrenceKey as string;
    if (wanted.get(key) === row.id) continue;
    throw conflict(`订阅发生键 ${key} 已属于另一笔账目，不能静默丢弃备份记录`);
  }
}

/**
 * Restore the non-transaction parts of a backup.
 *
 * Categories merge on (name, type), subscriptions on their stable ids, and
 * budgets/settlements on month. Only a validated full backup can update existing
 * identities; bare CSV/JSON row lists remain insert-only.
 */
async function importBackup(tx: Tx, backup: BackupPayload, idMap: IdMap) {
  const existingCategories = await tx.category.findMany();
  const categoryByNameType = new Map(existingCategories.map((category) => [`${category.name}|${category.type}`, category]));
  const categoryById = new Map(existingCategories.map((category) => [category.id, category]));

  for (const row of backup.categories ?? []) {
    const name = row.name.trim();
    const type = parseCategoryType(row.type);
    const existing = categoryByNameType.get(`${name}|${type}`);
    if (existing) {
      // Missing legacy fields preserve local metadata; explicit values restore it.
      const metadata = {
        ...(row.icon !== undefined ? { icon: row.icon } : {}),
        ...(row.sortOrder !== undefined ? { sortOrder: row.sortOrder } : {}),
        ...(row.archivedAt !== undefined ? { archivedAt: optionalDateTime(row.archivedAt, "分类归档时间") } : {}),
        ...(row.billingPauses !== undefined ? { billingPauses: row.billingPauses } :
          row.archivedAt !== undefined ? { billingPauses: changeBillingPause(existing.billingPauses, Boolean(row.archivedAt), "0001-01-01") } : {}),
        ...(row.createdAt ? { createdAt: new Date(row.createdAt) } : {}),
        ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt) } : {}),
      };
      if (Object.keys(metadata).length) {
        const updated = await tx.category.update({ where: { id: existing.id }, data: metadata });
        categoryByNameType.set(`${name}|${type}`, updated);
        categoryById.set(existing.id, updated);
      }
      idMap.categories.set(row.id, existing.id);
      continue;
    }
    if (categoryById.has(row.id)) throw conflict(`分类 ID ${row.id} 已被其他分类占用`);
    const created = await tx.category.create({
      data: {
        id: row.id,
        name,
        type,
        icon: row.icon ?? null,
        // isSystem is owned by the seed (it gates archiving in the UI), so an
        // imported category never claims it.
        isSystem: false,
        sortOrder: row.sortOrder ?? 0,
        archivedAt: optionalDateTime(row.archivedAt, "分类归档时间"),
        billingPauses: row.billingPauses ?? (row.archivedAt ? [{ start: "0001-01-01", end: null }] : []),
        ...(row.createdAt ? { createdAt: new Date(row.createdAt) } : {}),
        ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt) } : {}),
      },
    });
    categoryByNameType.set(`${name}|${type}`, created);
    categoryById.set(created.id, created);
    idMap.categories.set(row.id, created.id);
  }

  const backupSubscriptions = backup.subscriptions ?? [];
  if (backupSubscriptions.length) {
    for (const row of backupSubscriptions) {
      const name = row.name.trim();
      const categoryId = idMap.categories.get(row.categoryId) ?? row.categoryId;
      const category = categoryById.get(categoryId);
      if (!category || (category.type !== CategoryType.EXPENSE && category.type !== CategoryType.BOTH)) {
        throw conflict(`订阅「${name}」的分类不存在`);
      }
      const billingDay = Number(row.billingDay);
      if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) throw conflict("订阅扣款日格式不正确");
      const startMonth = parseMonthValue(row.startMonth, "订阅开始月份");
      const endMonth = row.endMonth ? parseMonthValue(row.endMonth, "订阅结束月份") : null;
      if (endMonth && endMonth < startMonth) throw conflict(`订阅「${name}」的结束月份不能早于开始月份`);
      const data = {
        name,
        amountCents: parseCents(row.amountCents, "订阅金额"),
        billingDay,
        categoryId: category.id,
        startMonth,
        endMonth,
        active: parseBoolean(row.active, true),
        billingPauses: row.billingPauses ?? (parseBoolean(row.active, true) ? [] : [{ start: row.startMonth.slice(0, 7) + "-01", end: null }]),
        billingHistory: row.billingHistory ? row.billingHistory.map((entry) => {
          const mappedId = idMap.categories.get(entry.categoryId) ?? entry.categoryId;
          const historicalCategory = categoryById.get(mappedId);
          if (!historicalCategory || (historicalCategory.type !== CategoryType.EXPENSE && historicalCategory.type !== CategoryType.BOTH)) throw conflict(`订阅「${name}」的历史分类不存在`);
          return { ...entry, categoryId: mappedId };
        }) : initialBillingHistory({
          name, amountCents: parseCents(row.amountCents, "订阅金额"), billingDay, categoryId: category.id,
          note: row.note ?? null, startMonth: row.startMonth.slice(0, 7), endMonth: row.endMonth?.slice(0, 7) ?? null,
        }, todayInShanghai().slice(0, 7)),
        note: row.note ?? null,
        ...(row.createdAt ? { createdAt: new Date(row.createdAt) } : {}),
        ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt) } : {}),
      };
      const saved = await tx.subscription.upsert({
        where: { id: row.id },
        create: { id: row.id, ...data },
        update: data,
        select: { id: true },
      });
      idMap.subscriptions.set(row.id, saved.id);
    }
  }

  if (backup.budgetPreset === null) {
    await tx.budgetPreset.deleteMany({ where: { id: 1 } });
  } else if (backup.budgetPreset !== undefined) {
    const { amountCents, updatedAt } = backup.budgetPreset;
    const data = { amountCents, ...(updatedAt ? { updatedAt: new Date(updatedAt) } : {}) };
    await tx.budgetPreset.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  }

  for (const row of backup.budgets ?? []) {
    const month = optionalDate(row.month, "预算月份");
    if (!month) continue;
    const amountCents = parseCents(row.amountCents, "预算金额");
    const data = { amountCents, ...(row.createdAt ? { createdAt: new Date(row.createdAt) } : {}), ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt) } : {}) };
    await tx.monthlyBudget.upsert({ where: { month }, create: { month, ...data }, update: data });
  }

}

/** Restore closed snapshots only after the merged ledger agrees with them. */
async function importSettlements(tx: Tx, backup: BackupPayload, idMap: IdMap) {
  for (const row of backup.settlements ?? []) {
    const month = optionalDate(row.month, "结算月份");
    if (!month) continue;
    const existing = await tx.monthlySettlement.findUnique({ where: { month } });
    const data = {
      month,
      budgetAmountCents: parseCents(row.budgetAmountCents, "结算预算金额", 2_147_483_647),
      expenseAmountCents: parseCents(row.expenseAmountCents, "结算支出金额", 2_147_483_647),
      incomeAmountCents: parseCents(row.incomeAmountCents, "结算收入金额", 2_147_483_647),
      remainingAmountCents:
        row.remainingAmountCents === null || row.remainingAmountCents === undefined
          ? null
          : parseSignedCents(row.remainingAmountCents, "结算剩余金额", -2_147_483_648, 2_147_483_647),
      settledAt: optionalDateTime(row.settledAt, "结算时间") ?? existing?.settledAt ?? new Date(),
      reopenedAt: optionalDateTime(row.reopenedAt, "重新打开时间"),
      revision: row.revision ?? 1,
      categorySnapshot: row.categorySnapshot ? row.categorySnapshot.map((item) => ({ ...item, categoryId: idMap.categories.get(item.categoryId) ?? item.categoryId })) : Prisma.DbNull,
      ...(row.createdAt ? { createdAt: new Date(row.createdAt) } : {}),
      ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt) } : {}),
    };
    if (!data.reopenedAt) {
      const nextMonth = new Date(month);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const totals = await tx.transaction.groupBy({
        by: ["type"],
        where: { deletedAt: null, occurredOn: { gte: month, lt: nextMonth } },
        _sum: { amountCents: true },
      });
      const reimbursed = await tx.transaction.aggregate({
        where: { deletedAt: null, type: "EXPENSE", reimbursedAt: { not: null }, occurredOn: { gte: month, lt: nextMonth } },
        _sum: { amountCents: true },
      });
      const expense = totals.find((item) => item.type === "EXPENSE")?._sum.amountCents ?? 0;
      const income = totals.find((item) => item.type === "INCOME")?._sum.amountCents ?? 0;
      const remaining = data.budgetAmountCents - expense + (reimbursed._sum.amountCents ?? 0);
      if (expense !== data.expenseAmountCents || income !== data.incomeAmountCents ||
          (data.remainingAmountCents !== null && remaining !== data.remainingAmountCents)) {
        throw conflict(`${monthKey(month)} 的结算与合并后的账目不一致，未导入任何数据。请使用空账本恢复，或移除备份中的结算后合并并重新结算`);
      }
      if (row.categorySnapshot) {
        const actual = await tx.transaction.groupBy({
          by: ["categoryId", "type", "reimbursedAt"], where: { deletedAt: null, occurredOn: { gte: month, lt: nextMonth } }, _sum: { amountCents: true },
        });
        const categories = new Map<string, { expenseCents: number; outOfPocketCents: number; incomeCents: number }>();
        for (const entry of actual) {
          const amount = entry._sum.amountCents ?? 0;
          const total = categories.get(entry.categoryId) ?? { expenseCents: 0, outOfPocketCents: 0, incomeCents: 0 };
          if (entry.type === "INCOME") total.incomeCents += amount;
          else { total.expenseCents += amount; if (!entry.reimbursedAt) total.outOfPocketCents += amount; }
          categories.set(entry.categoryId, total);
        }
        const expected = new Map(row.categorySnapshot.map((entry) => [idMap.categories.get(entry.categoryId) ?? entry.categoryId, { expenseCents: entry.expenseCents, outOfPocketCents: entry.outOfPocketCents, incomeCents: entry.incomeCents }]));
        if (canonicalBackupValue(Object.fromEntries(categories)) !== canonicalBackupValue(Object.fromEntries(expected))) throw conflict(`${monthKey(month)} 的分类快照与合并后的账目不一致，未导入任何数据`);
      }
    }
    if (existing) {
      const changed = ["budgetAmountCents", "expenseAmountCents", "incomeAmountCents", "remainingAmountCents", "settledAt", "reopenedAt", "categorySnapshot"].some((key) => canonicalBackupValue(existing[key as keyof typeof existing]) !== canonicalBackupValue(data[key as keyof typeof data]));
      if (changed) {
        const latestHistory = await tx.settlementHistory.findFirst({ where: { month }, orderBy: { revision: "desc" }, select: { revision: true } });
        data.revision = Math.max(existing.revision, row.revision ?? 1, latestHistory?.revision ?? 0) + 1;
        if (data.revision > 2_147_483_647) throw conflict("结算版本已达上限，请使用空账本恢复");
        const saved = await tx.monthlySettlement.update({ where: { month }, data });
        await recordSettlementHistory(tx, saved, "restore_backup");
      } else await tx.monthlySettlement.update({ where: { month }, data: { revision: Math.max(existing.revision, row.revision ?? 1), ...(row.createdAt ? { createdAt: new Date(row.createdAt) } : {}), ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt) } : {}) } });
    } else await tx.monthlySettlement.create({ data });
  }
}

/**
 * Category used when a row names one that does not exist. Prefers the seeded
 * 「其他」 catch-all but degrades to any usable category (and finally creates
 * one) instead of throwing, so a renamed catch-all no longer fails the import.
 */
async function resolveFallbackCategory(tx: Tx, categories: Category[]): Promise<Category> {
  const usable = categories.filter((category) => category.archivedAt === null);
  const existing = usable.find((category) => category.name === "其他" && category.type === CategoryType.BOTH) ?? usable.find((category) => category.type === CategoryType.BOTH);
  if (existing) return existing;
  const names = new Set(categories.filter((category) => category.type === CategoryType.BOTH).map((category) => category.name));
  let suffix = 0;
  while (names.has(suffix ? `导入未分类 ${suffix}` : "导入未分类")) suffix += 1;
  return tx.category.create({ data: { name: suffix ? `导入未分类 ${suffix}` : "导入未分类", type: CategoryType.BOTH, sortOrder: 99 } });
}

/** Full-backup history may reference archived categories; new row imports may not. */
function usableFor(category: Category | undefined, wanted: CategoryType, allowArchived = false): Category | undefined {
  if (!category || (!allowArchived && category.archivedAt !== null)) return undefined;
  return category.type === wanted || category.type === CategoryType.BOTH ? category : undefined;
}

export async function POST(request: Request) {
  try {
    const body = importSchema.parse(await parseJsonBody(request, MAX_IMPORT_BODY_BYTES));

    // Parse + validate every row up front so failures happen before any write.
    let normalizedRows: NormalizedRow[];
    try {
      normalizedRows = body.rows.map((row) => normalizeRow(row, Boolean(body.backup)));
    } catch (error) {
      throw conflict(error instanceof Error ? error.message : "导入数据格式不正确");
    }

    // Only a full backup envelope may address existing rows by id; a bare row
    // list (CSV or hand-built JSON) always inserts, so it cannot overwrite.
    const restoringBackup = Boolean(body.backup);
    const externalIds = restoringBackup
      ? [...new Set(normalizedRows.map((row) => row.externalId).filter((id): id is string => Boolean(id)))]
      : [];

    let imported = 0;
    let summary: Awaited<ReturnType<typeof summarizeImport>> | undefined;
    const idMap: IdMap = { categories: new Map(), subscriptions: new Map() };
    await withLedgerWrite(async (tx) => {
      summary = await summarizeImport(tx, normalizedRows, body.backup);
      if (summary.conflicts.length) throw conflict(`${summary.conflicts.join("；")}，未导入任何数据`);
      if (summary.lockedMonths.length) throw conflict(`${summary.lockedMonths.join("、")} 已结算，请先重新打开后再导入`);
      const existingRows = [];
      for (const batch of importChunks(externalIds)) existingRows.push(...await tx.transaction.findMany({ where: { id: { in: batch } }, include: { category: { select: { name: true } } } }));
      const existingById = new Map(existingRows.map((row) => [row.id, row]));
      await ensureDefaultCategories(tx);
      if (body.backup) await importBackup(tx, body.backup, idMap);
      if (body.backup) await restoreBackupHistory(tx, body.backup);

      // Preload the whole category list once instead of findFirst per row.
      const categories = await tx.category.findMany();
      const byId = new Map(categories.map((category) => [category.id, category]));
      const byNameType = new Map(categories.map((category) => [`${category.name}|${category.type}`, category]));
      const fallbackCategory = await resolveFallbackCategory(tx, categories);

      // Resolve every referenced subscription in one query (was one per row).
      const referencedSubscriptionIds = [
        ...new Set(
          normalizedRows
            .map((row) => (row.subscriptionId ? idMap.subscriptions.get(row.subscriptionId) ?? row.subscriptionId : null))
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const knownSubscriptionIds = new Set<string>();
      for (const batch of importChunks(referencedSubscriptionIds)) {
        for (const row of await tx.subscription.findMany({ where: { id: { in: batch } }, select: { id: true } })) knownSubscriptionIds.add(row.id);
      }

      const prepared = normalizedRows.map((row) => {
        const wantedType = row.type === TransactionType.EXPENSE ? CategoryType.EXPENSE : CategoryType.INCOME;
        // Soft deletion preserves accounting facts; a later restore must not
        // turn a reimbursed expense back into budget consumption.
        const reimbursedAt = row.type === TransactionType.EXPENSE ? row.reimbursedAt : null;
        const mappedCategoryId = row.categoryId ? idMap.categories.get(row.categoryId) ?? row.categoryId : null;
        const category =
          usableFor(mappedCategoryId ? byId.get(mappedCategoryId) : undefined, wantedType, restoringBackup) ??
          usableFor(byNameType.get(`${row.categoryName}|${wantedType}`), wantedType) ??
          usableFor(byNameType.get(`${row.categoryName}|${CategoryType.BOTH}`), wantedType) ??
          fallbackCategory;
        if (restoringBackup && (!mappedCategoryId || !usableFor(byId.get(mappedCategoryId), wantedType, true))) {
          throw conflict(`备份账目 ${row.externalId ?? ""} 的分类不存在或收支类型不匹配`);
        }

        const subscriptionId = row.subscriptionId ? idMap.subscriptions.get(row.subscriptionId) ?? row.subscriptionId : null;
        if (subscriptionId && !knownSubscriptionIds.has(subscriptionId)) {
          throw conflict(`账目关联的订阅不存在：${row.subscriptionId}`);
        }
        const subscriptionMonth = subscriptionId ? row.subscriptionMonth ?? monthStart(monthKey(row.occurredOn)) : null;
        // Rebuilt rather than trusted: remapping a subscription invalidates an
        // imported "<subscriptionId>:<month>" key, and the format must stay in
        // sync with syncSubscriptions().
        // A deleted historical occurrence may have released its key to a live
        // replacement. Reclaiming it here would silently drop one of the rows.
        const releasedOccurrence = (restoringBackup && row.occurrenceKeyProvided && !row.subscriptionOccurrenceKey) || (row.deletedAt && !row.subscriptionOccurrenceKey);
        const occurrenceKey =
          subscriptionId && subscriptionMonth && row.source === "SUBSCRIPTION" && !releasedOccurrence
            ? `${subscriptionId}:${monthKey(subscriptionMonth)}` : null;

        const data: Prisma.TransactionCreateManyInput = {
          type: row.type,
          amountCents: row.amountCents,
          occurredOn: row.occurredOn,
          categoryId: category.id,
          note: row.note,
          source: subscriptionId ? row.source : "MANUAL",
          subscriptionId,
          subscriptionMonth,
          subscriptionOccurrenceKey: occurrenceKey,
          deletedAt: row.deletedAt,
          reimbursedAt,
          ...(row.createdAt ? { createdAt: row.createdAt } : {}),
          ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
          version: row.version ?? 1,
        };
        return { data, externalId: restoringBackup ? row.externalId : null };
      });

      // Map every wanted occurrence key to the transaction id that will own it.
      const wantedKeys = new Map<string, string | null>();
      for (const item of prepared) {
        const key = item.data.subscriptionOccurrenceKey;
        if (key && wantedKeys.has(key)) throw conflict(`备份包含重复订阅发生键 ${key}`);
        if (key) wantedKeys.set(key, item.externalId);
      }
      await reconcileOccurrenceKeys(tx, wantedKeys);

      const inserts: Prisma.TransactionCreateManyInput[] = [];
      const keyedRows: { id: string; data: Omit<Prisma.TransactionCreateManyInput, "id">; before: StoredTransaction }[] = [];
      for (const item of prepared) {
        const existing = item.externalId ? existingById.get(item.externalId) : undefined;
        if (item.externalId && existing) {
          const keys = ["type", "amountCents", "occurredOn", "categoryId", "note", "source", "subscriptionId", "subscriptionMonth", "subscriptionOccurrenceKey", "deletedAt", "reimbursedAt"] as const;
          const changed = keys.some((key) => canonicalBackupValue(existing[key]) !== canonicalBackupValue(item.data[key])) ||
            (["createdAt", "updatedAt"] as const).some((key) => item.data[key] !== undefined && canonicalBackupValue(existing[key]) !== canonicalBackupValue(item.data[key]));
          if (!changed) {
            if ((item.data.version ?? 1) > existing.version) await tx.transaction.update({ where: { id: item.externalId }, data: { version: item.data.version, updatedAt: existing.updatedAt } });
            imported += 1;
            continue;
          }
          const latestHistory = await tx.transactionHistory.findFirst({ where: { transactionId: item.externalId }, orderBy: { version: "desc" }, select: { version: true } });
          item.data.version = Math.max(existing.version, item.data.version ?? 1, latestHistory?.version ?? 0) + 1;
          if (item.data.version > 2_147_483_647) throw conflict("账目版本已达上限，请使用空账本恢复");
          keyedRows.push({ id: item.externalId, data: item.data, before: existing });
        } else inserts.push({ ...item.data, ...(item.externalId ? { id: item.externalId } : {}) });
      }
      for (const batch of chunk(inserts, CREATE_CHUNK)) {
        if (!restoringBackup) {
          const now = new Date();
          const saved = batch.map((row) => ({ ...row, id: row.id ?? randomUUID(), createdAt: row.createdAt ?? now, updatedAt: row.updatedAt ?? now, version: row.version ?? 1 }));
          await tx.transaction.createMany({ data: saved });
          const recorded = await tx.transaction.findMany({ where: { id: { in: saved.map((row) => row.id) } }, include: { category: { select: { name: true } } } });
          await tx.transactionHistory.createMany({ data: recorded.map((row) => ({ transactionId: row.id, version: row.version, action: "import", after: transactionSnapshot(row) })) });
          imported += batch.length;
          continue;
        }
        const result = await tx.transaction.createMany({ data: batch });
        imported += result.count;
      }
      for (const batch of chunk(keyedRows, UPSERT_CHUNK)) {
        await Promise.all(
          batch.map(async (row) => {
            const saved = await tx.transaction.update({ where: { id: row.id }, data: row.data, include: { category: { select: { name: true } } } });
            await recordTransactionHistory(tx, saved, "restore_backup", row.before);
          }),
        );
        imported += batch.length;
      }
      if (body.backup) await importSettlements(tx, body.backup, idMap);
    }, IMPORT_TRANSACTION_OPTIONS);
    invalidateSubscriptionSyncCache();

    return NextResponse.json({ imported, summary });
  } catch (error) {
    return handleApiError(error);
  }
}
