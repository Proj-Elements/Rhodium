import { Prisma } from "@prisma/client";
import type { BackupPayload } from "@/lib/backup-validation";
import { conflict } from "@/lib/errors";
import { importChunks } from "@/lib/import-batches";

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

async function validateHistoryVersions(tx: Prisma.TransactionClient, backup: BackupPayload) {
  const transactionVersions = new Map((backup.transactions ?? []).map((row) => [row.id, row.version ?? 1]));
  const transactionIds = [...new Set((backup.transactionHistory ?? []).map((row) => row.transactionId))];
  for (const batch of importChunks(transactionIds)) {
    const existing = await tx.transaction.findMany({ where: { id: { in: batch } }, select: { id: true, version: true } });
    for (const row of existing) transactionVersions.set(row.id, Math.max(transactionVersions.get(row.id) ?? 0, row.version));
  }
  for (const row of backup.transactionHistory ?? []) {
    const version = transactionVersions.get(row.transactionId);
    if (version === undefined) throw conflict(`账目 ${row.transactionId} 的历史缺少对应账目`);
    if (row.version > version) throw conflict(`账目 ${row.transactionId} 的历史版本超出合并后的账目版本`);
  }
  const settlementVersions = new Map((backup.settlements ?? []).map((row) => [row.month, row.revision ?? 1]));
  const months = [...new Set((backup.settlementHistory ?? []).map((row) => row.month))];
  for (const batch of importChunks(months)) {
    const existing = await tx.monthlySettlement.findMany({ where: { month: { in: batch.map((month) => new Date(`${month}T00:00:00.000Z`)) } }, select: { month: true, revision: true } });
    for (const row of existing) {
      const month = row.month.toISOString().slice(0, 10);
      settlementVersions.set(month, Math.max(settlementVersions.get(month) ?? 0, row.revision));
    }
  }
  for (const row of backup.settlementHistory ?? []) {
    const revision = settlementVersions.get(row.month);
    if (revision === undefined) throw conflict(`${row.month.slice(0, 7)} 的结算历史缺少对应结算`);
    if (row.revision > revision) throw conflict(`${row.month.slice(0, 7)} 的历史版本超出合并后的结算版本`);
  }
}

/** Restore immutable audit/idempotency records without overwriting a divergent history. */
export async function restoreBackupHistory(tx: Prisma.TransactionClient, backup: BackupPayload, validateOnly = false) {
  await validateHistoryVersions(tx, backup);
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
