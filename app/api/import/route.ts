import { NextResponse } from "next/server";
import { CategoryType, TransactionType } from "@prisma/client";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { isMonthLocked } from "@/lib/summary";
import { monthDate, moneyToCents, parseDateOnly } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/seed";
import { importSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

function value(row: Record<string, unknown>, key: string, chineseKey: string) {
  return row[key] ?? row[chineseKey];
}

function optionalDate(valueToParse: unknown, label: string) {
  if (valueToParse === undefined || valueToParse === null || valueToParse === "") return null;
  if (typeof valueToParse !== "string") throw new Error(`${label}格式不正确`);
  return parseDateOnly(valueToParse);
}

function optionalDateTime(valueToParse: unknown, label: string) {
  if (valueToParse === undefined || valueToParse === null || valueToParse === "") return null;
  const date = new Date(String(valueToParse));
  if (Number.isNaN(date.getTime())) throw new Error(`${label}格式不正确`);
  return date;
}

function parseCents(valueToParse: unknown, label: string) {
  if (typeof valueToParse === "number") {
    if (!Number.isInteger(valueToParse) || valueToParse < 0 || valueToParse > 2_000_000_000) throw new Error(`${label}格式不正确`);
    return valueToParse;
  }
  if (typeof valueToParse !== "string" || !valueToParse.trim()) throw new Error(`${label}不能为空`);
  const numeric = Number(valueToParse.replace(/,/g, "").trim());
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 2_000_000_000) throw new Error(`${label}格式不正确`);
  return numeric;
}

function parseAmount(valueToParse: unknown, label: string) {
  if (typeof valueToParse === "number" && !Number.isInteger(valueToParse)) return moneyToCents(valueToParse);
  if (typeof valueToParse === "number") return moneyToCents(valueToParse);
  if (typeof valueToParse !== "string" || !valueToParse.trim()) throw new Error(`${label}不能为空`);
  return moneyToCents(valueToParse);
}

function parseSignedCents(valueToParse: unknown, label: string) {
  if (typeof valueToParse === "number") {
    if (!Number.isInteger(valueToParse) || Math.abs(valueToParse) > 2_000_000_000) throw new Error(`${label}格式不正确`);
    return valueToParse;
  }
  if (typeof valueToParse !== "string" || !valueToParse.trim()) throw new Error(`${label}不能为空`);
  const numeric = Number(valueToParse.replace(/,/g, "").trim());
  if (!Number.isInteger(numeric) || numeric < -2_000_000_000 || numeric > 2_000_000_000) throw new Error(`${label}格式不正确`);
  return numeric;
}

function parseBoolean(valueToParse: unknown, fallback: boolean) {
  if (typeof valueToParse === "boolean") return valueToParse;
  if (typeof valueToParse === "string") {
    if (["false", "0", "no"].includes(valueToParse.toLowerCase())) return false;
    if (["true", "1", "yes"].includes(valueToParse.toLowerCase())) return true;
  }
  return fallback;
}

function parseCategoryType(valueToParse: unknown) {
  const raw = String(valueToParse || "EXPENSE").toUpperCase();
  return raw === "INCOME" ? CategoryType.INCOME : raw === "BOTH" ? CategoryType.BOTH : CategoryType.EXPENSE;
}

function parseTransactionType(valueToParse: unknown) {
  const raw = String(valueToParse ?? "expense").trim().toLowerCase();
  if (!raw || raw === "expense" || raw.includes("支出")) return TransactionType.EXPENSE;
  if (raw === "income" || raw.includes("收入")) return TransactionType.INCOME;
  throw new Error("类型只能是支出或收入");
}

function parseMonthValue(valueToParse: unknown, label: string) {
  const raw = String(valueToParse || "").slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) throw new Error(`${label}格式应为 YYYY-MM`);
  return monthDate(raw);
}

export async function POST(request: Request) {
  try {
    const body = importSchema.parse(await parseJsonBody(request));
    const normalizedRows = body.rows.map((row) => {
      const date = String(value(row, "occurredOn", "日期") ?? "");
      const rawAmount = value(row, "amount", "金额");
      const amountCents = rawAmount !== undefined && rawAmount !== null && rawAmount !== "" ? parseAmount(rawAmount, "金额") : parseCents(row.amountCents, "金额");
      const type = parseTransactionType(value(row, "type", "类型"));
      return { row, date, occurredOn: parseDateOnly(date), amountCents, type };
    });
    const months = [...new Set(normalizedRows.map(({ date }) => date.slice(0, 7)))];
    const lockedMonths = (await Promise.all(months.map(async (month) => ({ month, locked: await isMonthLocked(month) })))).filter((item) => item.locked).map((item) => item.month);
    if (lockedMonths.length) return jsonError(`${lockedMonths.join("、")} 已结算，请先重新打开后再导入`);

    await ensureDefaultCategories();
    let imported = 0;
    const categoryIdMap = new Map<string, string>();
    await prisma.$transaction(async (transaction) => {
      if (body.backup) {
        const backup = body.backup;
        const backupCategories = Array.isArray(backup.categories) ? backup.categories : [];
        for (const raw of backupCategories) {
          const row = raw as Record<string, unknown>;
          if (typeof row.id !== "string" || typeof row.name !== "string" || !row.name.trim()) continue;
          const type = parseCategoryType(row.type);
          const existing = await transaction.category.findUnique({ where: { id: row.id } });
          const sameName = await transaction.category.findFirst({ where: { name: row.name.trim(), type } });
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
          await transaction.category.upsert({
            where: { id: row.id },
            create: { id: row.id, ...data },
            update: data,
          });
          categoryIdMap.set(row.id, row.id);
        }

        const backupSubscriptions = Array.isArray(backup.subscriptions) ? backup.subscriptions : [];
        for (const raw of backupSubscriptions) {
          const row = raw as Record<string, unknown>;
          if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.categoryId !== "string") continue;
          const categoryId = categoryIdMap.get(row.categoryId) || row.categoryId;
          const category = await transaction.category.findFirst({ where: { id: categoryId, type: { in: [CategoryType.EXPENSE, CategoryType.BOTH] } } });
          if (!category) throw new Error(`订阅「${row.name}」的分类不存在`);
          const amountCents = parseCents(row.amountCents, "订阅金额");
          const billingDay = Number(row.billingDay);
          if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) throw new Error("订阅扣款日格式不正确");
          const data = {
            name: row.name.trim(),
            amountCents,
            billingDay,
            categoryId,
            startMonth: parseMonthValue(row.startMonth, "订阅开始月份"),
            endMonth: row.endMonth ? parseMonthValue(row.endMonth, "订阅结束月份") : null,
            active: parseBoolean(row.active, true),
            note: typeof row.note === "string" ? row.note.trim() || null : null,
          };
          if (data.endMonth && data.endMonth < data.startMonth) throw new Error("订阅结束月份不能早于开始月份");
          await transaction.subscription.upsert({ where: { id: row.id }, create: { id: row.id, ...data }, update: data });
        }

        const backupBudgets = Array.isArray(backup.budgets) ? backup.budgets : [];
        for (const raw of backupBudgets) {
          const row = raw as Record<string, unknown>;
          if (typeof row.month !== "string") continue;
          const month = parseDateOnly(row.month);
          const amountCents = parseCents(row.amountCents, "预算金额");
          await transaction.monthlyBudget.upsert({ where: { month }, create: typeof row.id === "string" ? { id: row.id, month, amountCents } : { month, amountCents }, update: { amountCents } });
        }

        const backupSettlements = Array.isArray(backup.settlements) ? backup.settlements : [];
        for (const raw of backupSettlements) {
          const row = raw as Record<string, unknown>;
          if (typeof row.month !== "string") continue;
          const month = parseDateOnly(row.month);
          const data = {
            month,
            budgetAmountCents: parseCents(row.budgetAmountCents, "结算预算金额"),
            expenseAmountCents: parseCents(row.expenseAmountCents, "结算支出金额"),
            incomeAmountCents: parseCents(row.incomeAmountCents, "结算收入金额"),
            remainingAmountCents: row.remainingAmountCents === null || row.remainingAmountCents === undefined ? null : parseSignedCents(row.remainingAmountCents, "结算剩余金额"),
            settledAt: optionalDateTime(row.settledAt, "结算时间") || new Date(),
            reopenedAt: optionalDateTime(row.reopenedAt, "重新打开时间"),
          };
          await transaction.monthlySettlement.upsert({ where: { month }, create: typeof row.id === "string" ? { id: row.id, ...data } : data, update: { budgetAmountCents: data.budgetAmountCents, expenseAmountCents: data.expenseAmountCents, incomeAmountCents: data.incomeAmountCents, remainingAmountCents: data.remainingAmountCents, settledAt: data.settledAt, reopenedAt: data.reopenedAt } });
        }
      }

      const expenseFallback = await transaction.category.findFirstOrThrow({ where: { name: "其他", type: CategoryType.BOTH } });
      for (const normalized of normalizedRows) {
        const { row, occurredOn, amountCents, type } = normalized;
        const categoryName = String(value(row, "category", "分类") ?? "其他").trim() || "其他";
        const rawCategoryId = typeof row.categoryId === "string" ? row.categoryId.trim() : "";
        const mappedCategoryId = categoryIdMap.get(rawCategoryId) || rawCategoryId;
        const categoryById = rawCategoryId ? await transaction.category.findFirst({ where: { id: mappedCategoryId, ...(body.backup ? {} : { archivedAt: null }), OR: [{ type: type === TransactionType.EXPENSE ? CategoryType.EXPENSE : CategoryType.INCOME }, { type: CategoryType.BOTH }] } }) : null;
        const category = categoryById ?? await transaction.category.findFirst({ where: { name: categoryName, archivedAt: null, OR: [{ type: type === TransactionType.EXPENSE ? CategoryType.EXPENSE : CategoryType.INCOME }, { type: CategoryType.BOTH }] } });
        const rawSubscriptionId = typeof row.subscriptionId === "string" ? row.subscriptionId.trim() : "";
        const subscriptionId = rawSubscriptionId || null;
        if (subscriptionId && !(await transaction.subscription.findUnique({ where: { id: subscriptionId }, select: { id: true } }))) throw new Error(`账目关联的订阅不存在：${subscriptionId}`);
        const rawSource = String(row.source || "").trim().toUpperCase();
        const source = (rawSource === "SUBSCRIPTION" || rawSource === "订阅") && subscriptionId ? "SUBSCRIPTION" as const : "MANUAL" as const;
        const data = {
          type,
          amountCents,
          occurredOn,
          categoryId: category?.id ?? expenseFallback.id,
          note: String(value(row, "note", "备注") ?? "").trim() || null,
          source,
          subscriptionId,
          subscriptionMonth: optionalDate(row.subscriptionMonth, "订阅月份"),
          subscriptionOccurrenceKey: typeof row.subscriptionOccurrenceKey === "string" ? row.subscriptionOccurrenceKey.trim() || null : null,
          deletedAt: optionalDateTime(row.deletedAt, "删除时间"),
        };
        if (typeof row.id === "string" && row.id.trim()) await transaction.transaction.upsert({ where: { id: row.id }, create: { id: row.id, ...data }, update: data });
        else await transaction.transaction.create({ data });
        imported += 1;
      }
    });
    return NextResponse.json({ imported });
  } catch (error) {
    return handleApiError(error);
  }
}
