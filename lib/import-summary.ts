import type { Category, Prisma } from "@prisma/client";
import type { BackupPayload } from "@/lib/backup-validation";
import type { NormalizedRow } from "@/lib/import-parser";
import type { ImportSummary } from "@/lib/import-preview-controller";
import { monthKey, monthStart } from "@/lib/domain";
import { getLockedMonths } from "@/lib/summary";
import { canonicalBackupValue, restoreBackupHistory } from "@/lib/backup-history";
import { importChunks } from "@/lib/import-batches";
import { AppError } from "@/lib/errors";
import { indexImportCategories, rememberImportCategory, resolveBackupCategory, resolveImportCategory } from "@/lib/import-categories";
export { importChunks } from "@/lib/import-batches";

/** Preview the same target identities that an atomic merge will mutate. */
export async function summarizeImport(db: Prisma.TransactionClient, rows: NormalizedRow[], backup?: BackupPayload): Promise<ImportSummary> {
  const summary: ImportSummary = {
    transactions: { create: 0, update: 0, unchanged: 0 }, categories: { create: 0, update: 0 },
    subscriptions: { create: 0, update: 0 }, budgets: { create: 0, update: 0 }, settlements: { create: 0, update: 0 },
    budgetPreset: { create: 0, update: 0, delete: 0 }, lockedMonths: [], conflicts: [],
  };
  const existingRows = [];
  const ids = backup ? [...new Set(rows.flatMap((row) => row.externalId ? [row.externalId] : []))] : [];
  const idSet = new Set(ids);
  for (const batch of importChunks(ids)) existingRows.push(...await db.transaction.findMany({ where: { id: { in: batch } } }));
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const [categories, subscriptions, budgets, settlements] = await Promise.all([
    db.category.findMany(),
    db.subscription.findMany({ select: { id: true } }),
    backup?.budgets?.length ? db.monthlyBudget.findMany({ select: { month: true } }) : Promise.resolve([]),
    backup?.settlements?.length ? db.monthlySettlement.findMany({ select: { month: true } }) : Promise.resolve([]),
  ]);
  if (backup?.budgetPreset !== undefined) {
    const preset = await db.budgetPreset.findUnique({ where: { id: 1 } });
    if (backup.budgetPreset === null) summary.budgetPreset.delete = preset ? 1 : 0;
    else if (!preset) summary.budgetPreset.create = 1;
    else if (preset.amountCents !== backup.budgetPreset.amountCents) summary.budgetPreset.update = 1;
  }
  const mappedCategories = new Map<string, string>();
  const categoryIndex = indexImportCategories(categories);
  const categoryKeys = new Set(categories.map((row) => `${row.name}|${row.type}`));
  for (const row of backup?.categories ?? []) {
    try {
      const existing = resolveBackupCategory(categoryIndex, row);
      mappedCategories.set(row.id, existing?.id ?? row.id);
      summary.categories[existing ? "update" : "create"] += 1;
      rememberImportCategory(categoryIndex, {
        id: existing?.id ?? row.id, name: row.name, type: (row.type ?? "EXPENSE").toUpperCase() as Category["type"],
        icon: row.icon ?? existing?.icon ?? null,
        systemKey: row.systemKey ?? existing?.systemKey ?? null, isSystem: Boolean(row.systemKey) || existing?.isSystem || false,
        version: existing?.version ?? 1, sortOrder: row.sortOrder ?? existing?.sortOrder ?? 0,
        archivedAt: row.archivedAt !== undefined ? row.archivedAt ? new Date(row.archivedAt) : null : existing?.archivedAt ?? null,
        billingPauses: row.billingPauses ?? existing?.billingPauses ?? [],
        createdAt: existing?.createdAt ?? new Date(0), updatedAt: existing?.updatedAt ?? new Date(0),
      });
    } catch (error) {
      if (error instanceof AppError) summary.conflicts.push(error.message);
      else throw error;
    }
  }
  if (backup) {
    try { await restoreBackupHistory(db, backup, true, mappedCategories); }
    catch (error) {
      if (error instanceof AppError) summary.conflicts.push(error.message);
      else throw error;
    }
  }
  const subscriptionIds = new Set(subscriptions.map((row) => row.id));
  for (const row of backup?.subscriptions ?? []) summary.subscriptions[subscriptionIds.has(row.id) ? "update" : "create"] += 1;
  const categoryTypes = new Map(categories.map((row) => [row.id, String(row.type)]));
  for (const row of backup?.categories ?? []) categoryTypes.set(mappedCategories.get(row.id) ?? row.id, (row.type ?? "EXPENSE").toUpperCase());
  const availableSubscriptions = new Set([...subscriptionIds, ...(backup?.subscriptions ?? []).map((row) => row.id)]);
  for (const row of rows) {
    if (row.subscriptionId && !availableSubscriptions.has(row.subscriptionId)) summary.conflicts.push(`账目关联的订阅不存在：${row.subscriptionId}`);
    if (row.source === "SUBSCRIPTION" && row.type !== "EXPENSE") summary.conflicts.push("订阅发生记录必须是支出");
    if (!backup) {
      try {
        const resolved = resolveImportCategory(categoryIndex, row);
        if (!resolved.existing && !categoryKeys.has(`${resolved.name}|${row.type}`)) {
          summary.categories.create += 1;
          categoryKeys.add(`${resolved.name}|${row.type}`);
        }
      } catch (error) {
        if (error instanceof AppError) summary.conflicts.push(error.message);
        else throw error;
      }
    }
  }
  if (backup) {
    for (const row of rows) {
      const categoryId = mappedCategories.get(row.categoryId ?? "") ?? row.categoryId;
      const categoryType = categoryId ? categoryTypes.get(categoryId) : undefined;
      if (!categoryType || (categoryType !== "BOTH" && categoryType !== row.type)) summary.conflicts.push(`备份账目 ${row.externalId ?? ""} 的分类不存在或收支类型不匹配`);
    }
    for (const row of backup.subscriptions ?? []) {
      const categoryType = categoryTypes.get(mappedCategories.get(row.categoryId) ?? row.categoryId);
      if (categoryType !== "EXPENSE" && categoryType !== "BOTH") summary.conflicts.push(`订阅「${row.name}」的分类不存在或不支持支出`);
      for (const entry of row.billingHistory ?? []) {
        const historicalType = categoryTypes.get(mappedCategories.get(entry.categoryId) ?? entry.categoryId);
        if (historicalType !== "EXPENSE" && historicalType !== "BOTH") summary.conflicts.push(`订阅「${row.name}」的历史分类不存在或不支持支出`);
      }
    }
  }
  const occurrenceOwners = new Map<string, string | null>();
  for (const row of rows) {
    if (row.source !== "SUBSCRIPTION" || !row.subscriptionId || (backup && row.occurrenceKeyProvided && !row.subscriptionOccurrenceKey) || (row.deletedAt && !row.subscriptionOccurrenceKey)) continue;
    const key = `${row.subscriptionId}:${monthKey(row.subscriptionMonth ?? monthStart(monthKey(row.occurredOn)))}`;
    if (occurrenceOwners.has(key)) summary.conflicts.push(`备份包含重复订阅发生键 ${key}`);
    occurrenceOwners.set(key, backup ? row.externalId : null);
  }
  for (const batch of importChunks([...occurrenceOwners.keys()])) {
    const owners = await db.transaction.findMany({ where: { subscriptionOccurrenceKey: { in: batch } }, select: { id: true, subscriptionOccurrenceKey: true } });
    for (const owner of owners) if (owner.subscriptionOccurrenceKey && occurrenceOwners.get(owner.subscriptionOccurrenceKey) !== owner.id) summary.conflicts.push(`订阅发生键 ${owner.subscriptionOccurrenceKey} 已属于另一笔账目`);
  }
  const budgetMonths = new Set(budgets.map((row) => monthKey(row.month)));
  for (const row of backup?.budgets ?? []) summary.budgets[budgetMonths.has(row.month.slice(0, 7)) ? "update" : "create"] += 1;
  const settlementMonths = new Set(settlements.map((row) => monthKey(row.month)));
  for (const row of backup?.settlements ?? []) summary.settlements[settlementMonths.has(row.month.slice(0, 7)) ? "update" : "create"] += 1;
  for (const row of rows) {
    const existing = row.externalId ? existingById.get(row.externalId) : undefined;
    if (!backup || !existing) { summary.transactions.create += 1; continue; }
    const same = existing.type === row.type && existing.amountCents === row.amountCents && existing.occurredOn.getTime() === row.occurredOn.getTime() &&
      existing.categoryId === (mappedCategories.get(row.categoryId ?? "") ?? row.categoryId) && existing.note === row.note &&
      existing.source === row.source && existing.subscriptionId === row.subscriptionId &&
      existing.subscriptionMonth?.getTime() === row.subscriptionMonth?.getTime() && existing.deletedAt?.getTime() === row.deletedAt?.getTime() &&
      existing.reimbursedAt?.getTime() === row.reimbursedAt?.getTime() &&
      (!row.createdAt || existing.createdAt.getTime() === row.createdAt.getTime()) && (!row.updatedAt || existing.updatedAt.getTime() === row.updatedAt.getTime());
    summary.transactions[same ? "unchanged" : "update"] += 1;
  }
  summary.lockedMonths = (await getLockedMonths([...new Set([
    ...rows.map((row) => monthKey(row.occurredOn)), ...existingRows.map((row) => monthKey(row.occurredOn)),
    ...(backup?.budgets ?? []).map((row) => row.month.slice(0, 7)), ...(backup?.settlements ?? []).map((row) => row.month.slice(0, 7)),
  ])], db)).sort();
  for (const settlement of backup?.settlements ?? []) {
    if (settlement.reopenedAt) continue;
    const start = monthStart(settlement.month.slice(0, 7));
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    const monthRows = await db.transaction.findMany({ where: { occurredOn: { gte: start, lt: end } } });
    const finalRows = new Map<string, { type: string; amountCents: number; categoryId: string | null; deletedAt: Date | null; reimbursedAt: Date | null }>(
      monthRows.filter((row) => !idSet.has(row.id)).map((row) => [row.id, row]),
    );
    rows.forEach((row, index) => {
      if (row.occurredOn >= start && row.occurredOn < end) finalRows.set(row.externalId ?? `append:${index}`, { ...row, categoryId: mappedCategories.get(row.categoryId ?? "") ?? row.categoryId });
    });
    let expense = 0; let income = 0; let reimbursed = 0;
    for (const row of finalRows.values()) {
      if (row.deletedAt) continue;
      if (row.type === "EXPENSE") { expense += row.amountCents; if (row.reimbursedAt) reimbursed += row.amountCents; }
      else income += row.amountCents;
    }
    if (expense !== settlement.expenseAmountCents || income !== settlement.incomeAmountCents ||
      (settlement.remainingAmountCents !== undefined && settlement.remainingAmountCents !== null && settlement.budgetAmountCents - expense + reimbursed !== settlement.remainingAmountCents)) {
      summary.conflicts.push(`${settlement.month.slice(0, 7)} 的结算与合并后的账目不一致`);
    }
    if (settlement.categorySnapshot) {
      const actual = new Map<string, { expenseCents: number; outOfPocketCents: number; incomeCents: number }>();
      for (const row of finalRows.values()) {
        if (row.deletedAt || !row.categoryId) continue;
        const total = actual.get(row.categoryId) ?? { expenseCents: 0, outOfPocketCents: 0, incomeCents: 0 };
        if (row.type === "INCOME") total.incomeCents += row.amountCents;
        else { total.expenseCents += row.amountCents; if (!row.reimbursedAt) total.outOfPocketCents += row.amountCents; }
        actual.set(row.categoryId, total);
      }
      const expected = new Map(settlement.categorySnapshot.map((row) => [mappedCategories.get(row.categoryId) ?? row.categoryId, { expenseCents: row.expenseCents, outOfPocketCents: row.outOfPocketCents, incomeCents: row.incomeCents }]));
      if (canonicalBackupValue(Object.fromEntries(actual)) !== canonicalBackupValue(Object.fromEntries(expected))) summary.conflicts.push(`${settlement.month.slice(0, 7)} 的分类快照与合并后的账目不一致`);
    }
  }
  summary.conflicts = [...new Set(summary.conflicts)];
  return summary;
}
