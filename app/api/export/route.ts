import { NextResponse } from "next/server";
import { jsonError, handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function dateOnly(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export async function GET(request: Request) {
  try {
    const format = new URL(request.url).searchParams.get("format") || "json";
    if (format !== "json" && format !== "csv") return jsonError("导出格式只能是 JSON 或 CSV");
    const [transactions, categories, budgets, subscriptions, settlements] = await Promise.all([
    prisma.transaction.findMany({ where: format === "csv" ? { deletedAt: null } : undefined, orderBy: { occurredOn: "asc" } }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.monthlyBudget.findMany({ orderBy: { month: "asc" } }),
    prisma.subscription.findMany({ orderBy: { startMonth: "asc" } }),
    prisma.monthlySettlement.findMany({ orderBy: { month: "asc" } }),
  ]);

  if (format === "csv") {
    const rows = ["日期,类型,金额,分类,备注,来源", ...transactions.map((transaction) => [
      dateOnly(transaction.occurredOn),
      transaction.type === "EXPENSE" ? "支出" : "收入",
      (transaction.amountCents / 100).toFixed(2),
      categories.find((category) => category.id === transaction.categoryId)?.name || "其他",
      transaction.note || "",
      transaction.source === "SUBSCRIPTION" ? "订阅" : "手动",
    ].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))];
    return new NextResponse(`\uFEFF${rows.join("\n")}`, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="yueyu-transactions.csv"' },
    });
  }

    return NextResponse.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      categories,
      transactions: transactions.map((item) => ({ ...item, occurredOn: dateOnly(item.occurredOn), subscriptionMonth: dateOnly(item.subscriptionMonth) })),
      budgets: budgets.map((item) => ({ ...item, month: dateOnly(item.month) })),
      subscriptions: subscriptions.map((item) => ({ ...item, startMonth: dateOnly(item.startMonth)?.slice(0, 7), endMonth: dateOnly(item.endMonth)?.slice(0, 7) || null })),
      settlements: settlements.map((item) => ({ ...item, month: dateOnly(item.month) })),
    }, { headers: { "Content-Disposition": 'attachment; filename="yueyu-backup.json"' } });
  } catch (error) {
    return handleApiError(error);
  }
}
