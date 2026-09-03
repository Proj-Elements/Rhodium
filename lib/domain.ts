const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

export type TransactionKind = "expense" | "income";

/** Formatters are constructed once per module instead of per call (hot path). */
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
});

const weekdayDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
});

export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("日期格式应为 YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateOnlyKey(date) !== value) throw new Error("日期无效");
  return date;
}

export function parseMonth(value: string): Date {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("月份格式应为 YYYY-MM");
  return new Date(`${value}-01T00:00:00.000Z`);
}

export function dateOnlyKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function monthKey(value: Date): string {
  return value.toISOString().slice(0, 7);
}

/**
 * Canonical month-to-Date converter (first day of month, UTC).
 * `monthStart` remains as the preferred alias; `monthDate` is kept temporarily
 * and deprecated.
 * @deprecated use `monthStart`
 */
export function monthDate(month: string): Date {
  return parseMonth(month);
}

export function addMonths(month: string, offset: number): string {
  const date = parseMonth(month);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return monthKey(date);
}

export function monthStart(month: string): Date {
  return parseMonth(month);
}

/** Last calendar day of the month, UTC. */
export function monthEnd(month: string): Date {
  const date = parseMonth(addMonths(month, 1));
  date.setUTCDate(date.getUTCDate() - 1);
  return date;
}

/** Number of days in the month. */
export function daysInMonth(month: string): number {
  return monthEnd(month).getUTCDate();
}

/** Current date in the app time zone as YYYY-MM-DD. */
export function todayInShanghai(): string {
  const value = Object.fromEntries(dayKeyFormatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/** Clamp a recurring billing day (1-31) onto a real date in the month. */
export function billingDate(month: string, billingDay: number): Date {
  const day = Math.min(Math.max(1, billingDay), daysInMonth(month));
  const date = parseMonth(month);
  date.setUTCDate(day);
  return date;
}

export function moneyToCents(value: string | number): number {
  if (typeof value === "string" && !value.trim()) throw new Error("金额不能为空");
  const numeric = typeof value === "number" ? value : Number(value.replace(/,/g, "").trim());
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error("金额必须是非负数字");
  const cents = Math.round(numeric * 100);
  if (cents > 2_000_000_000) throw new Error("金额超出可记录范围");
  return cents;
}

export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return moneyFormatter.format(cents / 100);
}

export function calculateRemaining(budgetCents: number | null, expenseCents: number): number | null {
  return budgetCents === null ? null : budgetCents - expenseCents;
}

export function calculateUsage(budgetCents: number | null, expenseCents: number): number | null {
  if (!budgetCents || budgetCents <= 0) return null;
  return Math.round((expenseCents / budgetCents) * 100);
}

export function dateLabel(value: string): string {
  return weekdayDateFormatter.format(parseDateOnly(value));
}

export function clampText(value: string | null | undefined, fallback = "未填写备注"): string {
  const text = value?.trim();
  return text || fallback;
}
