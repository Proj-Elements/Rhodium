import { badRequest } from "@/lib/errors";

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
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest("日期格式应为 YYYY-MM-DD，年份范围为 0001–9999");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateOnlyKey(date) !== value) throw badRequest("日期无效");
  return date;
}

export function parseMonth(value: string): Date {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw badRequest("月份格式应为 YYYY-MM，年份范围为 0001–9999");
  return new Date(`${value}-01T00:00:00.000Z`);
}

export function dateOnlyKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function monthKey(value: Date): string {
  return value.toISOString().slice(0, 7);
}

export function addMonths(month: string, offset: number): string {
  const date = parseMonth(month);
  date.setUTCMonth(date.getUTCMonth() + offset);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) throw badRequest("月份超出 0001–9999 年范围");
  return monthKey(date);
}

/** Canonical month-to-Date converter (first day of month, UTC). */
export function monthStart(month: string): Date {
  return parseMonth(month);
}

/** Last calendar day of the month, UTC. */
export function monthEnd(month: string): Date {
  const date = parseMonth(month);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date;
}

/** Number of days in the month. */
export function daysInMonth(month: string): number {
  return monthEnd(month).getUTCDate();
}

/** Current date in the app time zone as YYYY-MM-DD. */
export function todayInShanghai(): string {
  const value = Object.fromEntries(dayKeyFormatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${value.year.padStart(4, "0")}-${value.month}-${value.day}`;
}

/** Clamp a recurring billing day (1-31) onto a real date in the month. */
export function billingDate(month: string, billingDay: number): Date {
  const day = Math.min(Math.max(1, billingDay), daysInMonth(month));
  const date = parseMonth(month);
  date.setUTCDate(day);
  return date;
}

export function moneyToCents(value: string | number): number {
  if (typeof value === "string" && !value.trim()) throw badRequest("金额不能为空");
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw badRequest("金额必须是非负数字");
    if (value >= 20_000_001) throw badRequest("金额超出可记录范围");
    if (value < 0.000001) return 0;
  }
  const decimal = String(value).trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(decimal)) throw badRequest("金额必须是非负数字");
  const [whole, fraction = ""] = decimal.replace(/,/g, "").split(".");
  const integer = whole.replace(/^0+/, "") || "0";
  if (integer.length > 8) throw badRequest("金额超出可记录范围");
  const cents = Number(integer) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0")) + (fraction.charAt(2) >= "5" ? 1 : 0);
  if (cents > 2_000_000_000) throw badRequest("金额超出可记录范围");
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
  if (budgetCents === null) return null;
  if (budgetCents === 0) return expenseCents > 0 ? 100 : 0;
  return Math.round((expenseCents / budgetCents) * 100);
}

export function dateLabel(value: string): string {
  return weekdayDateFormatter.format(parseDateOnly(value));
}
