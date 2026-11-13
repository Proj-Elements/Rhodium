import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { handleApiError, jsonError, MAX_IMPORT_BODY_BYTES } from "@/lib/api";
import { dateOnlyKey } from "@/lib/domain";
import { toCsv } from "@/lib/csv";
import { BACKUP_VERSION, MAX_BACKUP_ROWS, backupSchema } from "@/lib/backup-validation";
import { validateBackupHistoryTargets } from "@/lib/backup-history";
import { backupCapacityMessage, createExportBuffer } from "@/lib/export-buffer";
import { withLedgerRead } from "@/lib/ledger-write";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 500;
type ExportRow = { id?: string; key?: string };
type BackupSection = "categories" | "transactions" | "budgets" | "subscriptions" | "settlements" | "transactionHistory" | "settlementHistory" | "creationRequests";
type Section = { name: BackupSection; read: (tx: Prisma.TransactionClient, cursor?: string) => Promise<ExportRow[]>; dates?: Record<string, "month" | "date"> };

function page(cursor?: string) {
  return { orderBy: { id: "asc" as const }, take: PAGE_SIZE, ...(cursor ? { where: { id: { gt: cursor } } } : {}) };
}

const sections: Section[] = [
  { name: "categories", read: (tx, cursor) => tx.category.findMany(page(cursor)) },
  { name: "transactions", read: (tx, cursor) => tx.transaction.findMany(page(cursor)), dates: { occurredOn: "date", subscriptionMonth: "date" } },
  { name: "budgets", read: (tx, cursor) => tx.monthlyBudget.findMany(page(cursor)), dates: { month: "date" } },
  { name: "subscriptions", read: (tx, cursor) => tx.subscription.findMany(page(cursor)), dates: { startMonth: "month", endMonth: "month" } },
  { name: "settlements", read: (tx, cursor) => tx.monthlySettlement.findMany(page(cursor)), dates: { month: "date" } },
  { name: "transactionHistory", read: (tx, cursor) => tx.transactionHistory.findMany(page(cursor)) },
  { name: "settlementHistory", read: (tx, cursor) => tx.settlementHistory.findMany(page(cursor)), dates: { month: "date" } },
  { name: "creationRequests", read: (tx, cursor) => tx.creationRequest.findMany({ orderBy: { key: "asc" }, take: PAGE_SIZE, ...(cursor ? { where: { key: { gt: cursor } } } : {}) }) },
];

function serializedRow(row: object, dates: Section["dates"] = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date
    ? dates[key] === "month" ? dateOnlyKey(value).slice(0, 7) : dates[key] === "date" ? dateOnlyKey(value) : value.toISOString()
    : value]));
}

async function exportJson(tx: Prisma.TransactionClient) {
  // The restore request wraps this JSON in {backup: ...}; include those bytes in the cap.
  const output = createExportBuffer(MAX_IMPORT_BODY_BYTES - Buffer.byteLength('{"backup":}'));
  const preset = await tx.budgetPreset.findUnique({ where: { id: 1 } });
  const budgetPreset = preset ? { amountCents: preset.amountCents, updatedAt: preset.updatedAt.toISOString() } : null;
  backupSchema.parse({ budgetPreset });
  output.append(`{"version":${BACKUP_VERSION},"exportedAt":${JSON.stringify(new Date().toISOString())},"budgetPreset":${JSON.stringify(budgetPreset)}`);
  for (const section of sections) {
    output.append(`,${JSON.stringify(section.name)}:[`);
    let cursor: string | undefined;
    let count = 0;
    while (true) {
      const rows = await section.read(tx, cursor);
      if (!rows.length) break;
      if (rows.length > MAX_BACKUP_ROWS - count) throw new AppError(backupCapacityMessage, 413);
      const parsed = backupSchema.safeParse({ [section.name]: rows.map((row) => serializedRow(row, section.dates)) });
      if (!parsed.success) throw new AppError(backupCapacityMessage, 413);
      if (section.name === "transactionHistory" || section.name === "settlementHistory") await validateBackupHistoryTargets(tx, parsed.data);
      for (const row of parsed.data[section.name] ?? []) {
        if (count++) output.append(",");
        output.append(JSON.stringify(row));
      }
      cursor = rows.at(-1)!.id ?? rows.at(-1)!.key;
      if (rows.length < PAGE_SIZE) break;
    }
    output.append("]");
  }
  output.append("}");
  return output.finish();
}

async function exportCsv(tx: Prisma.TransactionClient) {
  const headers = ["日期", "类型", "金额", "分类", "备注", "来源", "报销时间"];
  const header = toCsv(headers, []);
  const output = createExportBuffer();
  output.append(header);
  let cursor: string | undefined;
  while (true) {
    const rows = await tx.transaction.findMany({
      where: { deletedAt: null },
      select: { id: true, occurredOn: true, type: true, amountCents: true, note: true, source: true, reimbursedAt: true, category: { select: { name: true } } },
      orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    output.append(toCsv(headers, rows.map((transaction) => [
      dateOnlyKey(transaction.occurredOn), transaction.type === "EXPENSE" ? "支出" : "收入",
      (transaction.amountCents / 100).toFixed(2), transaction.category.name, transaction.note ?? "",
      transaction.source === "SUBSCRIPTION" ? "订阅" : "手动", transaction.reimbursedAt?.toISOString() ?? "",
    ])).slice(header.length));
    cursor = rows.at(-1)!.id;
    if (rows.length < PAGE_SIZE) break;
  }
  return output.finish();
}

export async function GET(request: Request) {
  try {
    const format = new URL(request.url).searchParams.get("format") || "json";
    if (format !== "json" && format !== "csv") return jsonError("导出格式只能是 JSON 或 CSV", 400);
    const stream = await withLedgerRead((tx) => format === "json" ? exportJson(tx) : exportCsv(tx), { timeout: 120_000 });
    return new NextResponse(stream, { headers: {
      "Content-Type": format === "json" ? "application/json" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${format === "json" ? "rhodium-backup.json" : "rhodium-transactions.csv"}"`,
    } });
  } catch (error) {
    return handleApiError(error);
  }
}
