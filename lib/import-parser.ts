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
  occurrenceKeyProvided: boolean;
  deletedAt: Date | null;
  reimbursedAt: Date | null;
  externalId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  version: number | null;
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
  return moneyToCents(text(input, label));
}

/** Parse integer cents; aggregates may use the full database Int range. */
export function parseCents(input: unknown, label: string, maximum = 2_000_000_000): number {
  if (input === null || input === undefined || input === "") throw new Error(`${label}不能为空`);
  if (typeof input !== "number" && (typeof input !== "string" || !/^\d+$/.test(input.trim()))) throw new Error(`${label}格式不正确`);
  const numeric = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > maximum) throw new Error(`${label}格式不正确`);
  return numeric;
}

export function parseSignedCents(input: unknown, label: string, minimum = -2_000_000_000, maximum = 2_000_000_000): number {
  if (typeof input !== "number" && (typeof input !== "string" || !/^-?\d+$/.test(input.trim()))) throw new Error(`${label}格式不正确`);
  const numeric = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isSafeInteger(numeric) || numeric < minimum || numeric > maximum) throw new Error(`${label}格式不正确`);
  return numeric;
}

export function parseBoolean(input: unknown, fallback: boolean): boolean {
  if (input === undefined || input === null || input === "") return fallback;
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    if (["false", "0", "no"].includes(input.toLowerCase())) return false;
    if (["true", "1", "yes"].includes(input.toLowerCase())) return true;
  }
  throw new Error("布尔值格式不正确");
}

export function parseCategoryType(input: unknown): CategoryType {
  const raw = String(input || "EXPENSE").toUpperCase();
  if (raw === "EXPENSE") return CategoryType.EXPENSE;
  if (raw === "INCOME") return CategoryType.INCOME;
  if (raw === "BOTH") return CategoryType.BOTH;
  throw new Error("分类类型只能是支出、收入或双向");
}

export function parseTransactionType(input: unknown): TransactionType {
  const raw = String(input ?? "expense").trim().toLowerCase();
  if (!raw || raw === "expense" || raw === "支出") return TransactionType.EXPENSE;
  if (raw === "income" || raw === "收入") return TransactionType.INCOME;
  throw new Error("类型只能是支出或收入");
}

export function parseMonthValue(input: unknown, label: string): Date {
  if (typeof input !== "string" || !/^\d{4}-(0[1-9]|1[0-2])(?:-01)?$/.test(input)) throw new Error(`${label}格式应为 YYYY-MM 或月初日期`);
  return monthStart(input.slice(0, 7));
}

export function optionalDate(input: unknown, label: string): Date | null {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string") throw new Error(`${label}格式不正确`);
  return parseDateOnly(input);
}

export function optionalDateTime(input: unknown, label: string): Date | null {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string") throw new Error(`${label}格式不正确`);
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(input);
  if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59) throw new Error(`${label}格式不正确`);
  try {
    parseDateOnly(parts[1]);
  } catch {
    throw new Error(`${label}格式不正确`);
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error(`${label}格式不正确`);
  return date;
}

/**
 * Normalize one imported row into strict domain values, throwing a Chinese
 * error message on the first invalid field (the route attaches row numbers).
 */
export function normalizeRow(row: Row, restoringBackup = false): NormalizedRow {
  const dateText = text(value(row, "occurredOn", "日期"), "日期");
  const occurredOn = parseDateOnly(dateText);

  const rawAmount = value(row, "amount", "金额");
  const amountCents =
    rawAmount !== undefined && rawAmount !== null && rawAmount !== ""
      ? parseAmountToCents(rawAmount)
      : parseCents(row.amountCents, "金额");

  const type = parseTransactionType(value(row, "type", "类型"));
  const categoryName = String(value(row, "category", "分类") ?? "").trim() || "其他";
  const rawNote = value(row, "note", "备注");
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") throw new Error("备注必须是文本");
  const note = restoringBackup ? rawNote ?? null : rawNote?.trim() || null;
  // Old row imports did not cap notes. Preserve those historical values when
  // recovering a backup, but keep new entries inside the normal form contract.
  if (!restoringBackup && note && note.length > 200) throw new Error("备注不能超过 200 字");
  const subscriptionId = typeof row.subscriptionId === "string" && row.subscriptionId.trim() ? row.subscriptionId.trim() : null;
  const rawSource = String(row.source || "").trim().toUpperCase();
  if (rawSource && !["MANUAL", "手动", "SUBSCRIPTION", "订阅"].includes(rawSource)) throw new Error("来源只能是手动或订阅");
  const source = (rawSource === "SUBSCRIPTION" || rawSource === "订阅") && subscriptionId ? ("SUBSCRIPTION" as const) : ("MANUAL" as const);
  const subscriptionMonth = optionalDate(row.subscriptionMonth, "订阅月份");
  if (subscriptionMonth && subscriptionMonth.getUTCDate() !== 1) throw new Error("订阅月份必须是月初日期");
  if (source === "MANUAL" && (subscriptionId || subscriptionMonth || row.subscriptionOccurrenceKey)) throw new Error("手动账目不能包含订阅关联");
  if (source === "SUBSCRIPTION" && type !== "EXPENSE") throw new Error("订阅发生记录必须是支出");
  const createdAt = optionalDateTime(row.createdAt, "创建时间");
  const updatedAt = optionalDateTime(row.updatedAt, "更新时间");
  if (createdAt && updatedAt && updatedAt < createdAt) throw new Error("更新时间不能早于创建时间");
  const version = row.version === undefined || row.version === null ? null : parseCents(row.version, "版本", 2_147_483_647);
  if (version !== null && version < 1) throw new Error("版本必须是正整数");

  return {
    occurredOn,
    amountCents,
    type,
    categoryName,
    categoryId: typeof row.categoryId === "string" && row.categoryId.trim() ? row.categoryId.trim() : null,
    note,
    subscriptionId,
    source,
    subscriptionMonth,
    subscriptionOccurrenceKey: typeof row.subscriptionOccurrenceKey === "string" && row.subscriptionOccurrenceKey.trim() ? row.subscriptionOccurrenceKey.trim() : null,
    occurrenceKeyProvided: Object.hasOwn(row, "subscriptionOccurrenceKey"),
    deletedAt: optionalDateTime(row.deletedAt, "删除时间"),
    reimbursedAt: optionalDateTime(row.reimbursedAt ?? row["报销时间"], "报销时间"),
    externalId: typeof row.id === "string" && row.id.trim() ? row.id.trim() : null,
    createdAt: restoringBackup ? createdAt : null,
    updatedAt: restoringBackup ? updatedAt : null,
    version: restoringBackup ? version : null,
  };
}

/**
 * Per-row validation for the preview endpoint: must mirror `normalizeRow`
 * exactly — a row the preview rejects still blocks the 确认导入 button in the
 * UI, so any stricter rule silently makes valid files unimportable.
 */
export function validateRowShallow(row: Row, restoringBackup = false): void {
  normalizeRow(row, restoringBackup);
}
