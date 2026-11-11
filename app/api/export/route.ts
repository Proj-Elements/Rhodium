import { NextResponse } from "next/server";
import { handleApiError, jsonError, MAX_IMPORT_BODY_BYTES } from "@/lib/api";
import { dateOnlyKey } from "@/lib/domain";
import { toCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import { BACKUP_VERSION, MAX_BACKUP_ROWS, importSchema } from "@/lib/backup-validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const format = new URL(request.url).searchParams.get("format") || "json";
    if (format !== "json" && format !== "csv") return jsonError("导出格式只能是 JSON 或 CSV", 400);
    // A repeatable-read snapshot keeps related tables consistent even while a
    // writer commits; backups must not mix categories/subscriptions from one
    // revision with transaction rows from another.
    const maximum = format === "json" ? MAX_BACKUP_ROWS + 1 : undefined;
    const [transactions, categories, budgets, subscriptions, settlements, budgetPreset, transactionHistory, settlementHistory, creationRequests] = await prisma.$transaction((tx) => Promise.all([
      tx.transaction.findMany({ where: format === "csv" ? { deletedAt: null } : undefined, orderBy: { occurredOn: "asc" }, take: maximum }),
      tx.category.findMany({ orderBy: { sortOrder: "asc" }, take: maximum }),
      tx.monthlyBudget.findMany({ orderBy: { month: "asc" }, take: maximum }),
      tx.subscription.findMany({ orderBy: { startMonth: "asc" }, take: maximum }),
      tx.monthlySettlement.findMany({ orderBy: { month: "asc" }, take: maximum }),
      tx.budgetPreset.findUnique({ where: { id: 1 } }),
      format === "json" ? tx.transactionHistory.findMany({ orderBy: { recordedAt: "asc" }, take: maximum }) : Promise.resolve([]),
      format === "json" ? tx.settlementHistory.findMany({ orderBy: { recordedAt: "asc" }, take: maximum }) : Promise.resolve([]),
      format === "json" ? tx.creationRequest.findMany({ orderBy: { createdAt: "asc" }, take: maximum }) : Promise.resolve([]),
    ]), { isolationLevel: "RepeatableRead" });
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

    if (format === "csv") {
      const csv = toCsv(
        ["日期", "类型", "金额", "分类", "备注", "来源", "报销时间"],
        transactions.map((transaction) => [
          dateOnlyKey(transaction.occurredOn),
          transaction.type === "EXPENSE" ? "支出" : "收入",
          (transaction.amountCents / 100).toFixed(2),
          categoryNames.get(transaction.categoryId) ?? "其他",
          transaction.note ?? "",
          transaction.source === "SUBSCRIPTION" ? "订阅" : "手动",
          transaction.reimbursedAt?.toISOString() ?? "",
        ]),
      );
      return new NextResponse(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="rhodium-transactions.csv"' },
      });
    }

    const backup = {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        categories,
        budgetPreset: budgetPreset ? { amountCents: budgetPreset.amountCents, updatedAt: budgetPreset.updatedAt } : null,
        transactions: transactions.map((item) => ({ ...item, occurredOn: dateOnlyKey(item.occurredOn), subscriptionMonth: item.subscriptionMonth ? dateOnlyKey(item.subscriptionMonth) : null, reimbursedAt: item.reimbursedAt ? item.reimbursedAt.toISOString() : null })),
        budgets: budgets.map((item) => ({ ...item, month: dateOnlyKey(item.month) })),
        subscriptions: subscriptions.map((item) => ({ ...item, startMonth: dateOnlyKey(item.startMonth).slice(0, 7), endMonth: item.endMonth ? dateOnlyKey(item.endMonth).slice(0, 7) : null })),
        settlements: settlements.map((item) => ({ ...item, month: dateOnlyKey(item.month) })),
        transactionHistory,
        settlementHistory: settlementHistory.map((item) => ({ ...item, month: dateOnlyKey(item.month) })),
        creationRequests,
      };
    const json = JSON.stringify(backup);
    const restorePayload = { backup: JSON.parse(json) };
    // Never label a file as a complete backup if this version cannot recover it.
    // Both sides use the same row/metadata bounds and the same UTF-8 byte cap.
    if (!importSchema.safeParse(restorePayload).success || Buffer.byteLength(JSON.stringify(restorePayload)) > MAX_IMPORT_BODY_BYTES) {
      return jsonError("账本超出 JSON 恢复容量（64 MB、10 万条账目）；请使用 PostgreSQL 数据库备份保留完整数据", 413);
    }
    return new NextResponse(json, { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="rhodium-backup.json"' } });
  } catch (error) {
    return handleApiError(error);
  }
}
