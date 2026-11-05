import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api";
import { dateOnlyKey } from "@/lib/domain";
import { toCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const format = new URL(request.url).searchParams.get("format") || "json";
    if (format !== "json" && format !== "csv") return jsonError("导出格式只能是 JSON 或 CSV", 400);
    const [transactions, categories, budgets, subscriptions, settlements] = await Promise.all([
      prisma.transaction.findMany({ where: format === "csv" ? { deletedAt: null } : undefined, orderBy: { occurredOn: "asc" } }),
      prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.monthlyBudget.findMany({ orderBy: { month: "asc" } }),
      prisma.subscription.findMany({ orderBy: { startMonth: "asc" } }),
      prisma.monthlySettlement.findMany({ orderBy: { month: "asc" } }),
    ]);
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

    if (format === "csv") {
      const csv = toCsv(
        ["日期", "类型", "金额", "分类", "备注", "来源"],
        transactions.map((transaction) => [
          dateOnlyKey(transaction.occurredOn),
          transaction.type === "EXPENSE" ? "支出" : "收入",
          (transaction.amountCents / 100).toFixed(2),
          categoryNames.get(transaction.categoryId) ?? "其他",
          transaction.note ?? "",
          transaction.source === "SUBSCRIPTION" ? "订阅" : "手动",
        ]),
      );
      return new NextResponse(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="rhodium-transactions.csv"' },
      });
    }

    return NextResponse.json(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        categories,
        transactions: transactions.map((item) => ({ ...item, occurredOn: dateOnlyKey(item.occurredOn), subscriptionMonth: item.subscriptionMonth ? dateOnlyKey(item.subscriptionMonth) : null, reimbursedAt: item.reimbursedAt ? item.reimbursedAt.toISOString() : null })),
        budgets: budgets.map((item) => ({ ...item, month: dateOnlyKey(item.month) })),
        subscriptions: subscriptions.map((item) => ({ ...item, startMonth: dateOnlyKey(item.startMonth).slice(0, 7), endMonth: item.endMonth ? dateOnlyKey(item.endMonth).slice(0, 7) : null })),
        settlements: settlements.map((item) => ({ ...item, month: dateOnlyKey(item.month) })),
      },
      { headers: { "Content-Disposition": 'attachment; filename="rhodium-backup.json"' } },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
