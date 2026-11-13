import { Prisma } from "@prisma/client";
import type { BackupPayload } from "@/lib/backup-validation";
import { conflict } from "@/lib/errors";
import { importChunks } from "@/lib/import-batches";
import { normalizeRow } from "@/lib/import-parser";
import { dateOnlyKey } from "@/lib/domain";
import { transactionSnapshot } from "@/lib/transaction-history";
import { serializeSettlement } from "@/lib/serializers";

const transactionFields = ["id", "version", "type", "amountCents", "occurredOn", "categoryId", "note", "source", "subscriptionId", "subscriptionMonth", "deletedAt", "reimbursedAt"];
const settlementFields = ["month", "revision", "budgetAmountCents", "expenseAmountCents", "incomeAmountCents", "remainingAmountCents", "reopenedAt", "categorySnapshot"];

function assertMatchingSnapshot(snapshot: unknown, values: Record<string, unknown>, fields: string[], message: string) {
  const actual = snapshot as Record<string, unknown>;
  if (fields.some((key) => canonicalBackupValue(actual[key]) !== canonicalBackupValue(values[key]))) throw conflict(message);
}

/** Stable JSON comparison preserves immutable records regardless of object key order. */
export function canonicalBackupValue(value: unknown): string {
  if (value === Prisma.DbNull || value === Prisma.JsonNull) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalBackupValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalBackupValue(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function mappedSnapshot(value: unknown, categories: ReadonlyMap<string, string>): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const snapshot = value as Record<string, unknown>;
  return {
    ...snapshot,
    ...(typeof snapshot.categoryId === "string" ? { categoryId: categories.get(snapshot.categoryId) ?? snapshot.categoryId } : {}),
    ...(Array.isArray(snapshot.categorySnapshot) ? { categorySnapshot: snapshot.categorySnapshot.map((row) => mappedSnapshot(row, categories)) } : {}),
  };
}

function mapHistoryReferences(backup: BackupPayload, categories: ReadonlyMap<string, string>): BackupPayload {
  if (![...categories].some(([source, target]) => source !== target)) return backup;
  return {
    ...backup,
    transactions: backup.transactions?.map((row) => ({ ...row, categoryId: categories.get(row.categoryId) ?? row.categoryId })),
    settlements: backup.settlements?.map((row) => ({ ...row, categorySnapshot: row.categorySnapshot?.map((item) => ({ ...item, categoryId: categories.get(item.categoryId) ?? item.categoryId })) ?? row.categorySnapshot })),
    transactionHistory: backup.transactionHistory?.map((row) => ({ ...row, after: mappedSnapshot(row.after, categories) as typeof row.after,
      ...(row.before !== undefined ? { before: mappedSnapshot(row.before, categories) as typeof row.before } : {}) })),
    settlementHistory: backup.settlementHistory?.map((row) => ({ ...row, snapshot: mappedSnapshot(row.snapshot, categories) as typeof row.snapshot })),
  };
}

/** Validate history targets and latest business values against the merged entities. */
export async function validateBackupHistoryTargets(tx: Prisma.TransactionClient, backup: BackupPayload) {
  const suppliedTransactions = new Map((backup.transactions ?? []).map((row) => [row.id, row]));
  const transactionHistoryByVersion = new Map((backup.transactionHistory ?? []).map((row) => [`${row.transactionId}:${row.version}`, row]));
  const settlementHistoryByRevision = new Map((backup.settlementHistory ?? []).map((row) => [`${row.month}:${row.revision}`, row]));
  for (const history of backup.transactionHistory ?? []) {
    const entity = suppliedTransactions.get(history.transactionId);
    if (!entity || (entity.version ?? 1) !== history.version) continue;
    const normalized = normalizeRow(entity, true);
    const values = {
      id: entity.id, version: entity.version ?? 1, type: normalized.type, amountCents: normalized.amountCents,
      occurredOn: dateOnlyKey(normalized.occurredOn), categoryId: normalized.categoryId, note: normalized.note,
      source: normalized.source, subscriptionId: normalized.subscriptionId,
      subscriptionMonth: normalized.subscriptionMonth ? dateOnlyKey(normalized.subscriptionMonth) : null,
      deletedAt: normalized.deletedAt?.toISOString() ?? null, reimbursedAt: normalized.reimbursedAt?.toISOString() ?? null,
    };
    assertMatchingSnapshot(history.after, values, transactionFields, `账目 ${entity.id} 的最新历史与账目内容不一致`);
  }
  const suppliedSettlements = new Map((backup.settlements ?? []).map((row) => [row.month, row]));
  for (const history of backup.settlementHistory ?? []) {
    const entity = suppliedSettlements.get(history.month);
    if (!entity || (entity.revision ?? 1) !== history.revision) continue;
    const values = { month: entity.month, revision: entity.revision ?? 1, budgetAmountCents: entity.budgetAmountCents,
      expenseAmountCents: entity.expenseAmountCents, incomeAmountCents: entity.incomeAmountCents,
      remainingAmountCents: entity.remainingAmountCents ?? null, reopenedAt: entity.reopenedAt ? new Date(entity.reopenedAt).toISOString() : null, categorySnapshot: entity.categorySnapshot ?? null };
    assertMatchingSnapshot(history.snapshot, values, settlementFields, `${entity.month.slice(0, 7)} 的最新历史与结算内容不一致`);
  }
  const transactionVersions = new Map((backup.transactions ?? []).map((row) => [row.id, row.version ?? 1]));
  const transactionIds = [...new Set((backup.transactionHistory ?? []).map((row) => row.transactionId))];
  for (const batch of importChunks(transactionIds)) {
    const existing = await tx.transaction.findMany({ where: { id: { in: batch } } });
    for (const row of existing) {
      transactionVersions.set(row.id, Math.max(transactionVersions.get(row.id) ?? 0, row.version));
      if (suppliedTransactions.has(row.id)) continue;
      const latest = transactionHistoryByVersion.get(`${row.id}:${row.version}`);
      if (latest) assertMatchingSnapshot(latest.after, transactionSnapshot(row), transactionFields, `账目 ${row.id} 的最新历史与账目内容不一致`);
    }
  }
  for (const row of backup.transactionHistory ?? []) {
    const version = transactionVersions.get(row.transactionId);
    if (version === undefined) throw conflict(`账目 ${row.transactionId} 的历史缺少对应账目`);
    if (row.version > version) throw conflict(`账目 ${row.transactionId} 的历史版本超出合并后的账目版本`);
  }
  const settlementVersions = new Map((backup.settlements ?? []).map((row) => [row.month, row.revision ?? 1]));
  const months = [...new Set((backup.settlementHistory ?? []).map((row) => row.month))];
  for (const batch of importChunks(months)) {
    const existing = await tx.monthlySettlement.findMany({ where: { month: { in: batch.map((month) => new Date(`${month}T00:00:00.000Z`)) } } });
    for (const row of existing) {
      const month = row.month.toISOString().slice(0, 10);
      settlementVersions.set(month, Math.max(settlementVersions.get(month) ?? 0, row.revision));
      if (suppliedSettlements.has(month)) continue;
      const latest = settlementHistoryByRevision.get(`${month}:${row.revision}`);
      if (latest) assertMatchingSnapshot(latest.snapshot, serializeSettlement(row), settlementFields, `${month.slice(0, 7)} 的最新历史与结算内容不一致`);
    }
  }
  for (const row of backup.settlementHistory ?? []) {
    const revision = settlementVersions.get(row.month);
    if (revision === undefined) throw conflict(`${row.month.slice(0, 7)} 的结算历史缺少对应结算`);
    if (row.revision > revision) throw conflict(`${row.month.slice(0, 7)} 的历史版本超出合并后的结算版本`);
  }
}

/** Restore immutable audit/idempotency records without overwriting a divergent history. */
export async function restoreBackupHistory(tx: Prisma.TransactionClient, backup: BackupPayload, validateOnly = false, categories: ReadonlyMap<string, string> = new Map()) {
  backup = mapHistoryReferences(backup, categories);
  await validateBackupHistoryTargets(tx, backup);
  for (const batch of importChunks(backup.transactionHistory ?? [], 500)) {
    const existing = await tx.transactionHistory.findMany({ where: { OR: [
      { id: { in: batch.map((row) => row.id) } }, ...batch.map((row) => ({ transactionId: row.transactionId, version: row.version })),
    ] } });
    const inserts: Prisma.TransactionHistoryCreateManyInput[] = [];
    for (const row of batch) {
      const data = { ...row, before: row.before ?? null, recordedAt: new Date(row.recordedAt) };
      const previous = existing.find((item) => item.id === row.id || (item.transactionId === row.transactionId && item.version === row.version));
      if (previous) {
        if (canonicalBackupValue(previous) !== canonicalBackupValue(data)) throw conflict(`账目 ${row.transactionId} 的第 ${row.version} 版历史与本地记录冲突，请使用空账本恢复`);
      } else inserts.push({ ...data, before: row.before === undefined || row.before === null ? Prisma.DbNull : jsonInput(row.before), after: jsonInput(row.after) });
    }
    if (inserts.length && !validateOnly) await tx.transactionHistory.createMany({ data: inserts });
  }
  for (const batch of importChunks(backup.settlementHistory ?? [], 500)) {
    const existing = await tx.settlementHistory.findMany({ where: { OR: [
      { id: { in: batch.map((row) => row.id) } }, ...batch.map((row) => ({ month: new Date(`${row.month}T00:00:00.000Z`), revision: row.revision })),
    ] } });
    const inserts: Prisma.SettlementHistoryCreateManyInput[] = [];
    for (const row of batch) {
      const data = { ...row, month: new Date(`${row.month}T00:00:00.000Z`), recordedAt: new Date(row.recordedAt) };
      const previous = existing.find((item) => item.id === row.id || (item.month.getTime() === data.month.getTime() && item.revision === row.revision));
      if (previous) {
        if (canonicalBackupValue(previous) !== canonicalBackupValue(data)) throw conflict(`${row.month.slice(0, 7)} 的第 ${row.revision} 版结算历史与本地记录冲突，请使用空账本恢复`);
      } else inserts.push({ ...data, snapshot: jsonInput(row.snapshot) });
    }
    if (inserts.length && !validateOnly) await tx.settlementHistory.createMany({ data: inserts });
  }
  for (const batch of importChunks(backup.creationRequests ?? [], 500)) {
    const existing = await tx.creationRequest.findMany({ where: { key: { in: batch.map((row) => row.key) } } });
    const byKey = new Map(existing.map((row) => [row.key, row]));
    const inserts: Prisma.CreationRequestCreateManyInput[] = [];
    for (const row of batch) {
      const data = { ...row, createdAt: new Date(row.createdAt) };
      const previous = byKey.get(row.key);
      if (previous) {
        if (canonicalBackupValue(previous) !== canonicalBackupValue(data)) throw conflict(`幂等请求 ${row.key} 与本地记录冲突，请使用空账本恢复`);
      } else inserts.push({ ...data, response: jsonInput(row.response) });
    }
    if (inserts.length && !validateOnly) await tx.creationRequest.createMany({ data: inserts });
  }
}
