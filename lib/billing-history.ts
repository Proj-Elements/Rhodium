import { addMonths } from "@/lib/domain";

export type BillingPlanData = {
  amountCents: number;
  billingDay: number;
  categoryId: string;
  name: string;
  note: string | null;
  startMonth: string;
  endMonth: string | null;
};

export type BillingPlan = BillingPlanData & { effectiveMonth: string };

const monthPattern = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;

export function parseBillingHistory(value: unknown): BillingPlan[] {
  if (!Array.isArray(value)) throw new Error("扣款计划历史必须是数组");
  const history: BillingPlan[] = value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("扣款计划历史格式不正确");
    const plan = item as Record<string, unknown>;
    if (typeof plan.effectiveMonth !== "string" || !monthPattern.test(plan.effectiveMonth) ||
        typeof plan.startMonth !== "string" || !monthPattern.test(plan.startMonth) ||
        (plan.endMonth !== null && (typeof plan.endMonth !== "string" || !monthPattern.test(plan.endMonth))) ||
        (typeof plan.endMonth === "string" && plan.endMonth < plan.startMonth) ||
        typeof plan.amountCents !== "number" || !Number.isInteger(plan.amountCents) || plan.amountCents < 0 || plan.amountCents > 2_000_000_000 ||
        typeof plan.billingDay !== "number" || !Number.isInteger(plan.billingDay) || plan.billingDay < 1 || plan.billingDay > 31 ||
        typeof plan.categoryId !== "string" || !plan.categoryId.trim() || plan.categoryId.length > 60 ||
        typeof plan.name !== "string" || !plan.name.trim() || plan.name.length > 80 ||
        (plan.note !== null && typeof plan.note !== "string")) throw new Error("扣款计划历史格式不正确");
    return {
      effectiveMonth: plan.effectiveMonth,
      amountCents: plan.amountCents,
      billingDay: plan.billingDay,
      categoryId: plan.categoryId,
      name: plan.name,
      note: plan.note,
      startMonth: plan.startMonth,
      endMonth: plan.endMonth,
    };
  });
  history.sort((first, second) => first.effectiveMonth.localeCompare(second.effectiveMonth));
  if (new Set(history.map((plan) => plan.effectiveMonth)).size !== history.length) throw new Error("扣款计划历史不能包含重复生效月份");
  return history;
}

export function initialBillingHistory(plan: BillingPlanData, effectiveMonth = plan.startMonth): BillingPlan[] {
  return parseBillingHistory([{ ...plan, effectiveMonth }]);
}

export function effectiveBillingPlan(history: BillingPlan[], month: string): BillingPlan | null {
  return history.findLast((plan) => plan.effectiveMonth <= month) ?? null;
}

export function scheduleBillingPlan(value: unknown, plan: BillingPlanData, today: string): BillingPlan[] {
  const history = parseBillingHistory(value);
  const currentMonth = today.slice(0, 7);
  const nextMonth = addMonths(currentMonth, 1);
  const firstMonth = history[0]?.effectiveMonth;
  const requestedFutureMonth = plan.startMonth > nextMonth ? plan.startMonth : nextMonth;
  const effectiveMonth = firstMonth && firstMonth > currentMonth
    ? (firstMonth < requestedFutureMonth ? firstMonth : requestedFutureMonth)
    : nextMonth;
  return parseBillingHistory([...history.filter((item) => item.effectiveMonth < effectiveMonth), { ...plan, effectiveMonth }]);
}
