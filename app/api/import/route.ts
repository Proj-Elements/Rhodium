import { NextResponse } from "next/server";
import { handleApiError, MAX_IMPORT_BODY_BYTES, parseJsonBody } from "@/lib/api";
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
import { importSchema } from "@/lib/validation";
import { isMonthLocked } from "@/lib/summary";
import { CategoryType, type Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
type Tx = Prisma.TransactionClient;

/**
 * Collect all unique subscriptionOccurrenceKeys a row set would write, then
 * clear any that already exist with identical data. Re-importing the same
 * backup previously crashed the whole import with a P2002 unique violation.
 */
async function dedupeOccurrenceKeys(tx: Tx, rows: NormalizedRow[]) {
  const keys = [...new Set(rows.map((row) => row.subscriptionOccurrenceKey).filter((key): key is string => Boolean(key)))];
  if (!keys.length) return;
  const existing = await tx.transaction.findMany({
    where: { subscriptionOccurrenceKey: { in: keys } },
    select: { subscriptionOccurrenceKey: true, deletedAt: true },
  });
  const deletedKeys = new Set(existing.filter((item) => item.deletedAt).map((item) => item.subscriptionOccurrenceKey));
  const staleKeys = keys.filter((key) => deletedKeys.has(key));
  if (staleKeys.length) {
    // A deleted auto-entry is being re-imported: reuse the key by clearing the old row.
    await tx.transaction.updateMany({ where: { subscriptionOccurrenceKey: { in: staleKeys } }, data: { subscriptionOccurrenceKey: null } });
  }
}

async function importBackup(tx: Tx, backup: Row, categoryIdMap: Map<string, string>) {
  const backupCategories = Array.isArray(backup.categories) ? (backup.categories as Row[]) : [];
  for (const row of backupCategories) {
    if (typeof row.id !== "string" || typeof row.name !== "string" || !row.name.trim()) continue;
    const type = parseCategoryType(row.type);
    const sameName = await tx.category.findFirst({ where: { name: row.name.trim(), type } });
    if (sameName && sameName.id !== row.id) {
      categoryIdMap.set(row.id, sameName.id);
      continue;
    }
    const data = {
      name: row.name.trim(),
      type,
      isSystem: parseBoolean(row.isSystem, false),
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
      archivedAt: optionalDateTime(row.archivedAt, "分类归档时间"),
    };
    await tx.category.upsert({ where: { id: row.id }, create: { id: row.id, ...data }, update: data });
    categoryIdMap.set(row.id, row.id);
  }

  const backupSubscriptions = Array.isArray(backup.subscriptions) ? (backup.subscriptions as Row[]) : [];
  for (const row of backupSubscriptions) {
    if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.categoryId !== "string") continue;
    const categoryId = categoryIdMap.get(row.categoryId) ?? row.categoryId;
    const category = await tx.category.findFirst({ where: { id: categoryId, type: { in: [CategoryType.EXPENSE, CategoryType.BOTH] } } });
    if (!category) throw conflict(`订阅「${row.name}」的分类不存在`);
    const billingDay = Number(row.billingDay);
    if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) throw conflict("订阅扣款日格式不正确");
    const data = {
      name: row.name.trim(),
      amountCents: parseCents(row.amountCents, "订阅金额"),
      billingDay,
      categoryId,
      startMonth: parseMonthValue(row.startMonth, "订阅开始月份"),
      endMonth: row.endMonth ? parseMonthValue(row.endMonth, "订阅结束月份") : null,
      active: parseBoolean(row.active, true),
      note: typeof row.note === "string" ? row.note.trim() || null : null,
    };
    await tx.subscription.upsert({ where: { id: row.id }, create: { id: row.id, ...data }, update: data });
  }

  const backupBudgets = Array.isArray(backup.budgets) ? (backup.budgets as Row[]) : [];
  for (const row of backupBudgets) {
    if (typeof row.month !== "string") continue;
    const month = optionalDate(row.month, "预算月份");
    if (!month) continue;
    const amountCents = parseCents(row.amountCents, "预算金额");
    await tx.monthlyBudget.upsert({ where: { month }, create: month ? { month, amountCents } : { month, amountCents }, update: { amountCents } });
  }

  const backupSettlements = Array.isArray(backup.settlements) ? (backup.settlements as Row[]) : [];
  for (const row of backupSettlements) {
    if (typeof row.month !== "string") continue;
    const month = optionalDate(row.month, "结算月份");
    if (!month) continue;
    const data = {
      month,
      budgetAmountCents: parseCents(row.budgetAmountCents, "结算预算金额"),
      expenseAmountCents: parseCents(row.expenseAmountCents, "结算支出金额"),
      incomeAmountCents: parseCents(row.incomeAmountCents, "结算收入金额"),
      remainingAmountCents: row.remainingAmountCents === null || row.remainingAmountCents === undefined ? null : parseSignedCents(row.remainingAmountCents, "结算剩余金额"),
      settledAt: optionalDateTime(row.settledAt, "结算时间") ?? new Date(),
      reopenedAt: optionalDateTime(row.reopenedAt, "重新打开时间"),
    };
    await tx.monthlySettlement.upsert({ where: { month }, create: data, update: data });
  }
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

    const months = [...new Set(normalizedRows.map((row) => `${row.occurredOn.toISOString().slice(0, 7)}`))];
    const lockedMonths = (
      await Promise.all(months.map(async (month) => ({ month, locked: await isMonthLocked(month) })))
    )
      .filter((item) => item.locked)
      .map((item) => item.month);
    if (lockedMonths.length) throw conflict(`${lockedMonths.join("、")} 已结算，请先重新打开后再导入`);

    await ensureDefaultCategories();
    let imported = 0;
    const categoryIdMap = new Map<string, string>();

    await prisma.$transaction(async (tx) => {
      if (body.backup) await importBackup(tx, body.backup, categoryIdMap);

      // Preload the whole category list once instead of findFirst per row.
      const categories = await tx.category.findMany();
      type CategoryKey = { byId: Map<string, typeof categories[number]>; byNameType: Map<string, typeof categories[number]> };
      const index: CategoryKey = { byId: new Map(), byNameType: new Map() };
      for (const category of categories) {
        index.byId.set(category.id, category);
        index.byNameType.set(`${category.name}|${category.type}`, category);
      }

      const expenseFallback = index.byNameType.get("其他|BOTH") ?? (await tx.category.findFirstOrThrow({ where: { name: "其他" } }));

      await dedupeOccurrenceKeys(tx, normalizedRows);

      for (const row of normalizedRows) {
        const wantedType = row.type === "EXPENSE" ? CategoryType.EXPENSE : CategoryType.INCOME;
        const byId = row.categoryId ? index.byId.get(row.categoryId) : undefined;
        const byName = index.byNameType.get(`${row.categoryName}|${wantedType}`) ?? index.byNameType.get(`${row.categoryName}|${CategoryType.BOTH}`);
        const category = (body.backup ? undefined : activeOrUndefined(byId)) ?? activeOrUndefined(byName);
        if (row.subscriptionId && !(await tx.subscription.findUnique({ where: { id: row.subscriptionId }, select: { id: true } }))) {
          throw conflict(`账目关联的订阅不存在：${row.subscriptionId}`);
        }
        const data = {
          type: row.type,
          amountCents: row.amountCents,
          occurredOn: row.occurredOn,
          categoryId: category?.id ?? expenseFallback.id,
          note: row.note,
          source: row.source,
          subscriptionId: row.subscriptionId,
          subscriptionMonth: row.subscriptionMonth,
          subscriptionOccurrenceKey: row.subscriptionOccurrenceKey,
          deletedAt: row.deletedAt,
        };
        if (row.externalId) await tx.transaction.upsert({ where: { id: row.externalId }, create: { id: row.externalId, ...data }, update: data });
        else await tx.transaction.create({ data });
        imported += 1;
      }
    });

    return NextResponse.json({ imported });
  } catch (error) {
    return handleApiError(error);
  }
}

function activeOrUndefined<T extends { archivedAt: Date | null }>(category: T | undefined): T | undefined {
  return category && category.archivedAt === null ? category : undefined;
}
