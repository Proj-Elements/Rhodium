import { CategoryType, TransactionType } from "@prisma/client";
import { moneyToCents, monthStart, parseDateOnly } from "@/lib/domain";

export type NormalizedRow = {
  occurredOn: Date;
  amountCents: number;
  type: TransactionType;
  categoryName: string;
  categoryId: string | null;
  note: string | null;
  subscriptionId: string | null;
  source: "MANUAL" | "SUBSCRIPTION";
  subscriptionMonth: Date | null;
  subscriptionOccurrenceKey: string | null;
  deletedAt: Date | null;
  reimbursedAt: Date | null;
  externalId: string | null;
};

type Row = Record<string, unknown>;

function value(row: Row, key: string, chineseKey: string): unknown {
  return row[key] ?? row[chineseKey];
}

function text(input: unknown, label: string): string {
  if (typeof input !== "string" || !input.trim()) throw new Error(`${label}不能为空`);
  return input;
}

export function parseAmountToCents(input: unknown, label = "金额"): number {
  if (typeof input === "number") return moneyToCents(input);
  return moneyToCents(text(input, label).replace(/,/g, ""));
}

/** Integer-cents parser for backup payloads (amountCents fields). */
export function parseCents(input: unknown, label: string): number {
  if (input === null || input === undefined || input === "") throw new Error(`${label}不能为空`);
  const numeric = typeof input === "number" ? input : Number(String(input).replace(/,/g, "").trim());
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 2_000_000_000) throw new Error(`${label}格式不正确`);
  return numeric;
}

export function parseSignedCents(input: unknown, label: string): number {
  const numeric = typeof input === "number" ? input : Number(String(input ?? "").replace(/,/g, "").trim());
  if (!Number.isInteger(numeric) || Math.abs(numeric) > 2_000_000_000) throw new Error(`${label}格式不正确`);
  return numeric;
}

export function parseBoolean(input: unknown, fallback: boolean): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    if (["false", "0", "no"].includes(input.toLowerCase())) return false;
    if (["true", "1", "yes"].includes(input.toLowerCase())) return true;
  }
  return fallback;
}

export function parseCategoryType(input: unknown): CategoryType {
  const raw = String(input || "EXPENSE").toUpperCase();
  return raw === "INCOME" ? CategoryType.INCOME : raw === "BOTH" ? CategoryType.BOTH : CategoryType.EXPENSE;
}

export function parseTransactionType(input: unknown): TransactionType {
  const raw = String(input ?? "expense").trim().toLowerCase();
  if (!raw || raw === "expense" || raw.includes("支出")) return TransactionType.EXPENSE;
  if (raw === "income" || raw.includes("收入")) return TransactionType.INCOME;
  throw new Error("类型只能是支出或收入");
}

export function parseMonthValue(input: unknown, label: string): Date {
  const raw = String(input || "").slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) throw new Error(`${label}格式应为 YYYY-MM`);
  return monthStart(raw);
}

export function optionalDate(input: unknown, label: string): Date | null {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string") throw new Error(`${label}格式不正确`);
  return parseDateOnly(input);
}

export function optionalDateTime(input: unknown, label: string): Date | null {
  if (input === undefined || input === null || input === "") return null;
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) throw new Error(`${label}格式不正确`);
  return date;
}

/**
 * Normalize one imported row into strict domain values, throwing a Chinese
 * error message on the first invalid field (the route attaches row numbers).
 */
export function normalizeRow(row: Row): NormalizedRow {
  const dateText = text(value(row, "occurredOn", "日期"), "日期");
  const occurredOn = parseDateOnly(dateText);

  const rawAmount = value(row, "amount", "金额");
  const amountCents =
    rawAmount !== undefined && rawAmount !== null && rawAmount !== ""
      ? parseAmountToCents(rawAmount)
      : parseCents(row.amountCents, "金额");

  const type = parseTransactionType(value(row, "type", "类型"));
  const categoryName = String(value(row, "category", "分类") ?? "").trim() || "其他";
  const note = String(value(row, "note", "备注") ?? "").trim() || null;
  const subscriptionId = typeof row.subscriptionId === "string" && row.subscriptionId.trim() ? row.subscriptionId.trim() : null;
  const rawSource = String(row.source || "").trim().toUpperCase();
  const source = (rawSource === "SUBSCRIPTION" || rawSource === "订阅") && subscriptionId ? ("SUBSCRIPTION" as const) : ("MANUAL" as const);

  return {
    occurredOn,
    amountCents,
    type,
    categoryName,
    categoryId: typeof row.categoryId === "string" && row.categoryId.trim() ? row.categoryId.trim() : null,
    note,
    subscriptionId,
    source,
    subscriptionMonth: optionalDate(row.subscriptionMonth, "订阅月份"),
    subscriptionOccurrenceKey: typeof row.subscriptionOccurrenceKey === "string" && row.subscriptionOccurrenceKey.trim() ? row.subscriptionOccurrenceKey.trim() : null,
    deletedAt: optionalDateTime(row.deletedAt, "删除时间"),
    reimbursedAt: optionalDateTime(row.reimbursedAt ?? row["报销时间"], "报销时间"),
    externalId: typeof row.id === "string" && row.id.trim() ? row.id.trim() : null,
  };
}

/**
 * Per-row validation for the preview endpoint: must mirror `normalizeRow`
 * exactly — a row the preview rejects still blocks the 确认导入 button in the
 * UI, so any stricter rule silently makes valid files unimportable.
 */
export function validateRowShallow(row: Row): void {
  const dateText = String(value(row, "occurredOn", "日期") ?? "");
  parseDateOnly(dateText);
  const rawAmount = value(row, "amount", "金额");
  if (rawAmount === undefined || rawAmount === null || rawAmount === "") parseCents(row.amountCents, "金额");
  else parseAmountToCents(rawAmount);
  parseTransactionType(value(row, "type", "类型"));
}
