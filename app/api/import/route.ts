import { NextResponse } from "next/server";
import { handleApiError, MAX_IMPORT_BODY_BYTES, parseJsonBody } from "@/lib/api";
import { monthKey, monthStart } from "@/lib/domain";
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
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/seed";
import { importSchema, type BackupPayload } from "@/lib/validation";
import { getLockedMonths } from "@/lib/summary";
import { CategoryType, TransactionType, type Category, type Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type Tx = Prisma.TransactionClient;

const CREATE_CHUNK = 500;
const UPSERT_CHUNK = 25;
/** Long enough for a 5000-row restore, bounded so a stuck import cannot pin a connection. */
const IMPORT_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 15_000 } as const;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

/**
 * Backup ids are *correlation* keys only: they line up rows inside one payload
 * (a transaction pointing at a category, a subscription pointing at a category)
 * and are never written as database primary keys. A restore therefore merges into
 * the existing ledger instead of overwriting rows the caller names by id.
 */
type IdMap = { categories: Map<string, string>; subscriptions: Map<string, string> };

/**
 * Reconcile the subscriptionOccurrenceKeys a row set wants to write against the
 * keys already in the database. Returns the keys that must be dropped from the
 * incoming rows because a live transaction already represents that occurrence.
 *
 * Keys held by soft-deleted rows are released so the occurrence can be
 * re-imported; keys held by a live row are left alone (re-importing them used to
 * abort the whole restore with a P2002 unique violation).
 */
async function reconcileOccurrenceKeys(tx: Tx, wanted: Map<string, string | null>): Promise<Set<string>> {
  const keys = [...wanted.keys()];
  if (!keys.length) return new Set();
  const existing = await tx.transaction.findMany({
    where: { subscriptionOccurrenceKey: { in: keys } },
    select: { id: true, subscriptionOccurrenceKey: true, deletedAt: true },
  });

  const release: string[] = [];
  const taken = new Set<string>();
  for (const row of existing) {
    const key = row.subscriptionOccurrenceKey as string;
    if (row.deletedAt) release.push(key);
    else if (wanted.get(key) !== row.id) taken.add(key);
  }

  if (release.length) {
    await tx.transaction.updateMany({ where: { subscriptionOccurrenceKey: { in: release } }, data: { subscriptionOccurrenceKey: null } });
  }
  return taken;
}

/**
 * Restore the non-transaction parts of a backup.
 *
 * Every entity is matched on its natural key — categories on (name, type),
 * subscriptions on name, budgets and settlements on month — so an import merges
 * into the existing ledger. Backup ids only populate `idMap` so transaction rows
 * referencing them can be re-pointed at the local row.
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
      // Old backups omit icon; restoring one must not erase a newer choice.
      if (row.icon !== undefined && row.icon !== existing.icon) {
        const updated = await tx.category.update({ where: { id: existing.id }, data: { icon: row.icon } });
        categoryByNameType.set(`${name}|${type}`, updated);
        categoryById.set(existing.id, updated);
      }
      idMap.categories.set(row.id, existing.id);
      continue;
    }
    const created = await tx.category.create({
      data: {
        name,
        type,
        icon: row.icon ?? null,
        // isSystem is owned by the seed (it gates archiving in the UI), so an
        // imported category never claims it.
        isSystem: false,
        sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
        archivedAt: optionalDateTime(row.archivedAt, "分类归档时间"),
      },
    });
    categoryByNameType.set(`${name}|${type}`, created);
    categoryById.set(created.id, created);
    idMap.categories.set(row.id, created.id);
  }

  const backupSubscriptions = backup.subscriptions ?? [];
  if (backupSubscriptions.length) {
    const names = [...new Set(backupSubscriptions.map((row) => row.name.trim()))];
    const existingSubscriptions = await tx.subscription.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
    const subscriptionByName = new Map(existingSubscriptions.map((item) => [item.name, item.id]));

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
        note: typeof row.note === "string" ? row.note.trim() || null : null,
      };
      const existingId = subscriptionByName.get(name);
      const saved = existingId
        ? await tx.subscription.update({ where: { id: existingId }, data, select: { id: true } })
        : await tx.subscription.create({ data, select: { id: true } });
      subscriptionByName.set(name, saved.id);
      idMap.subscriptions.set(row.id, saved.id);
    }
  }

  for (const row of backup.budgets ?? []) {
    const month = optionalDate(row.month, "预算月份");
    if (!month) continue;
    const amountCents = parseCents(row.amountCents, "预算金额");
    await tx.monthlyBudget.upsert({ where: { month }, create: { month, amountCents }, update: { amountCents } });
  }

  for (const row of backup.settlements ?? []) {
    const month = optionalDate(row.month, "结算月份");
    if (!month) continue;
    const data = {
      month,
      budgetAmountCents: parseCents(row.budgetAmountCents, "结算预算金额"),
      expenseAmountCents: parseCents(row.expenseAmountCents, "结算支出金额"),
      incomeAmountCents: parseCents(row.incomeAmountCents, "结算收入金额"),
      remainingAmountCents:
        row.remainingAmountCents === null || row.remainingAmountCents === undefined
          ? null
          : parseSignedCents(row.remainingAmountCents, "结算剩余金额"),
      settledAt: optionalDateTime(row.settledAt, "结算时间") ?? new Date(),
      reopenedAt: optionalDateTime(row.reopenedAt, "重新打开时间"),
    };
    await tx.monthlySettlement.upsert({ where: { month }, create: data, update: data });
  }
}

/**
 * Category used when a row names one that does not exist. Prefers the seeded
 * 「其他」 catch-all but degrades to any usable category (and finally creates
 * one) instead of throwing, so a renamed catch-all no longer fails the import.
 */
async function resolveFallbackCategory(tx: Tx, categories: Category[]): Promise<Category> {
  const usable = categories.filter((category) => category.archivedAt === null);
  return (
    usable.find((category) => category.name === "其他" && category.type === CategoryType.BOTH) ??
    usable.find((category) => category.type === CategoryType.BOTH) ??
    usable.find((category) => category.type === CategoryType.EXPENSE) ??
    (await tx.category.create({ data: { name: "其他", type: CategoryType.BOTH, isSystem: true, sortOrder: 99 } }))
  );
}

/** Returns the category only when it is active and usable for `wanted`. */
function usableFor(category: Category | undefined, wanted: CategoryType): Category | undefined {
  if (!category || category.archivedAt !== null) return undefined;
  return category.type === wanted || category.type === CategoryType.BOTH ? category : undefined;
}

export async function POST(request: Request) {
  try {
    const body = importSchema.parse(await parseJsonBody(request, MAX_IMPORT_BODY_BYTES));

    // Parse + validate every row up front so failures happen before any write.
    let normalizedRows: NormalizedRow[];
    try {
      normalizedRows = body.rows.map((row) => normalizeRow(row));
    } catch (error) {
      throw conflict(error instanceof Error ? error.message : "导入数据格式不正确");
    }

    // Only a full backup envelope may address existing rows by id; a bare row
    // list (CSV or hand-built JSON) always inserts, so it cannot overwrite.
    const restoringBackup = Boolean(body.backup);
    const externalIds = restoringBackup
      ? [...new Set(normalizedRows.map((row) => row.externalId).filter((id): id is string => Boolean(id)))]
      : [];

    // Locked months are rejected for both the incoming dates *and* the months
    // the targeted rows currently live in, so an update cannot silently mutate a
    // settled month by moving a row out of it.
    const targetMonths = normalizedRows.map((row) => monthKey(row.occurredOn));
    const existingMonths = externalIds.length
      ? (await prisma.transaction.findMany({ where: { id: { in: externalIds } }, select: { occurredOn: true } })).map((item) =>
          monthKey(item.occurredOn),
        )
      : [];
    const lockedMonths = await getLockedMonths([...new Set([...targetMonths, ...existingMonths])]);
    if (lockedMonths.length) throw conflict(`${lockedMonths.sort().join("、")} 已结算，请先重新打开后再导入`);

    await ensureDefaultCategories();
    let imported = 0;
    const idMap: IdMap = { categories: new Map(), subscriptions: new Map() };

    await prisma.$transaction(async (tx) => {
      if (body.backup) await importBackup(tx, body.backup, idMap);

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
      const knownSubscriptionIds = new Set(
        referencedSubscriptionIds.length
          ? (await tx.subscription.findMany({ where: { id: { in: referencedSubscriptionIds } }, select: { id: true } })).map((item) => item.id)
          : [],
      );

      const prepared = normalizedRows.map((row) => {
        const wantedType = row.type === TransactionType.EXPENSE ? CategoryType.EXPENSE : CategoryType.INCOME;
        const mappedCategoryId = row.categoryId ? idMap.categories.get(row.categoryId) ?? row.categoryId : null;
        const category =
          usableFor(mappedCategoryId ? byId.get(mappedCategoryId) : undefined, wantedType) ??
          usableFor(byNameType.get(`${row.categoryName}|${wantedType}`), wantedType) ??
          usableFor(byNameType.get(`${row.categoryName}|${CategoryType.BOTH}`), wantedType) ??
          fallbackCategory;

        const subscriptionId = row.subscriptionId ? idMap.subscriptions.get(row.subscriptionId) ?? row.subscriptionId : null;
        if (subscriptionId && !knownSubscriptionIds.has(subscriptionId)) {
          throw conflict(`账目关联的订阅不存在：${row.subscriptionId}`);
        }
        const subscriptionMonth = subscriptionId ? row.subscriptionMonth ?? monthStart(monthKey(row.occurredOn)) : null;
        // Rebuilt rather than trusted: remapping a subscription invalidates an
        // imported "<subscriptionId>:<month>" key, and the format must stay in
        // sync with syncSubscriptions().
        const occurrenceKey =
          subscriptionId && subscriptionMonth && row.source === "SUBSCRIPTION" ? `${subscriptionId}:${monthKey(subscriptionMonth)}` : null;

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
        };
        return { data, externalId: restoringBackup ? row.externalId : null };
      });

      // Map every wanted occurrence key to the transaction id that will own it.
      const wantedKeys = new Map<string, string | null>();
      for (const item of prepared) {
        const key = item.data.subscriptionOccurrenceKey;
        if (key) wantedKeys.set(key, item.externalId);
      }
      const takenKeys = await reconcileOccurrenceKeys(tx, wantedKeys);

      const inserts: Prisma.TransactionCreateManyInput[] = [];
      const keyedRows: { id: string; data: Omit<Prisma.TransactionCreateManyInput, "id"> }[] = [];
      const seenKeys = new Set<string>();
      for (const item of prepared) {
        const key = item.data.subscriptionOccurrenceKey;
        // The occurrence is already on the ledger (or earlier in this payload):
        // skip instead of failing the restore or double-counting the expense.
        if (key && (takenKeys.has(key) || seenKeys.has(key))) continue;
        if (key) seenKeys.add(key);
        // Rows carrying an id must keep upsert semantics: delete+create would
        // reset createdAt, which the transaction list uses as a tiebreaker.
        if (item.externalId) keyedRows.push({ id: item.externalId, data: item.data });
        else inserts.push(item.data);
      }
      for (const batch of chunk(inserts, CREATE_CHUNK)) {
        const result = await tx.transaction.createMany({ data: batch });
        imported += result.count;
      }
      for (const batch of chunk(keyedRows, UPSERT_CHUNK)) {
        await Promise.all(
          batch.map((row) => tx.transaction.upsert({ where: { id: row.id }, create: { id: row.id, ...row.data }, update: row.data })),
        );
        imported += batch.length;
      }

    }, IMPORT_TRANSACTION_OPTIONS);

    return NextResponse.json({ imported });
  } catch (error) {
    return handleApiError(error);
  }
}
