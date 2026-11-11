import { parseDateOnly } from "@/lib/domain";

export type BillingPause = { start: string; end: string | null };

export function parseBillingPauses(value: unknown): BillingPause[] {
  if (!Array.isArray(value)) throw new Error("暂停历史必须是数组");
  const pauses = value.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("start" in item) || !("end" in item) || typeof item.start !== "string" || (item.end !== null && typeof item.end !== "string")) throw new Error("暂停历史格式不正确");
    parseDateOnly(item.start);
    if (item.end !== null) {
      parseDateOnly(item.end);
      if (item.end < item.start) throw new Error("暂停结束时间不能早于开始时间");
    }
    return { start: item.start, end: item.end };
  });
  const sorted = [...pauses].sort((first, second) => first.start.localeCompare(second.start));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    if (previous.end === null || previous.end > sorted[index].start) throw new Error("暂停历史不能重叠");
  }
  return sorted;
}

export function changeBillingPause(value: unknown, paused: boolean, today: string): BillingPause[] {
  parseDateOnly(today);
  const pauses = parseBillingPauses(value);
  if (paused) return pauses.some((item) => item.end === null) ? pauses : [...pauses, { start: today, end: null }];
  return pauses.map((item) => item.end === null ? { ...item, end: today < item.start ? item.start : today } : item);
}

export function isBillingPaused(pauses: BillingPause[], date: string): boolean {
  return pauses.some((pause) => date >= pause.start && (pause.end === null || date < pause.end));
}
