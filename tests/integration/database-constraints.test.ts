import { beforeEach, describe, expect, it } from "vitest";
import { createCategory, prisma, resetDatabase } from "./helpers";
import { parseDateOnly } from "@/lib/domain";

beforeEach(resetDatabase);

describe("PostgreSQL ledger invariants", () => {
  it("rejects invalid money, year zero, non-month starts and billing days outside the calendar", async () => {
    const category = await createCategory();
    const data = { categoryId: category.id, type: "EXPENSE" as const, amountCents: 100, occurredOn: parseDateOnly("2024-03-05") };
    await expect(prisma.transaction.create({ data: { ...data, amountCents: -1 } })).rejects.toThrow(/Transaction_amount_check/);
    await expect(prisma.transaction.create({ data: { ...data, occurredOn: new Date("0000-01-01T00:00:00Z") } })).rejects.toThrow(/Transaction_date_check/);
    await expect(prisma.monthlyBudget.create({ data: { month: parseDateOnly("2024-03-02"), amountCents: 0 } })).rejects.toThrow(/MonthlyBudget_month_check/);
    await expect(prisma.subscription.create({ data: { name: "非法日", categoryId: category.id, amountCents: 100, billingDay: 32, startMonth: parseDateOnly("2024-03-01") } })).rejects.toThrow(/Subscription_billing_day_check/);
    await expect(prisma.budgetPreset.create({ data: { id: 2, amountCents: 0 } })).rejects.toThrow(/BudgetPreset_singleton_check/);
  });

  it("rejects income occurrences, manual subscription links and mismatched occurrence keys", async () => {
    const category = await createCategory();
    const subscription = await prisma.subscription.create({ data: { name: "订阅", categoryId: category.id, amountCents: 100, billingDay: 5, startMonth: parseDateOnly("2024-03-01") } });
    const data = { categoryId: category.id, type: "EXPENSE" as const, amountCents: 100, occurredOn: parseDateOnly("2024-03-05"), source: "SUBSCRIPTION" as const, subscriptionId: subscription.id, subscriptionMonth: parseDateOnly("2024-03-01"), subscriptionOccurrenceKey: `${subscription.id}:2024-03` };
    await expect(prisma.transaction.create({ data: { ...data, type: "INCOME" } })).rejects.toThrow(/Transaction_subscription_check/);
    await expect(prisma.transaction.create({ data: { ...data, source: "MANUAL" } })).rejects.toThrow(/Transaction_subscription_check/);
    await expect(prisma.transaction.create({ data: { ...data, subscriptionOccurrenceKey: `${subscription.id}:2024-04` } })).rejects.toThrow(/Transaction_subscription_check/);
    expect((await prisma.transaction.create({ data })).amountCents).toBe(100);
  });

  it("rejects malformed JSON plans and overlapping pauses", async () => {
    const category = await createCategory();
    await expect(prisma.category.update({ where: { id: category.id }, data: { billingPauses: [{ start: "2024-02-30", end: null }] } })).rejects.toThrow(/Category_pauses_check/);
    await expect(prisma.category.update({ where: { id: category.id }, data: { billingPauses: [{ start: "2024-01-01", end: null }, { start: "2024-02-01", end: null }] } })).rejects.toThrow(/Category_pauses_check/);
    await expect(prisma.subscription.create({ data: { name: "坏历史", categoryId: category.id, amountCents: 0, billingDay: 1, startMonth: parseDateOnly("2024-03-01"), billingHistory: [{ effectiveMonth: "2024-03" }] } })).rejects.toThrow(/Subscription_history_check/);
  });

  it("rejects contradictory settlement snapshots and mismatched history identity", async () => {
    const category = await createCategory();
    await expect(prisma.monthlySettlement.create({ data: { month: parseDateOnly("2024-03-01"), budgetAmountCents: 1000, expenseAmountCents: 100, incomeAmountCents: 0, remainingAmountCents: 900, categorySnapshot: [{ categoryId: category.id, categoryName: category.name, expenseCents: 200, outOfPocketCents: 200, incomeCents: 0 }] } })).rejects.toThrow(/MonthlySettlement_totals_check/);
    await expect(prisma.transactionHistory.create({ data: { transactionId: "actual", version: 1, action: "create", after: { id: "different", version: 1 } } })).rejects.toThrow(/TransactionHistory_identity_check/);
    expect((await prisma.transactionHistory.create({ data: { transactionId: "partial", version: 1, action: "create", after: { id: "partial", version: 1 } } })).version).toBe(1);
    await expect(prisma.transactionHistory.create({ data: { transactionId: "actual", version: 1, action: "create", after: { id: "actual", version: 1, amountCents: -1 } } })).rejects.toThrow(/TransactionHistory_identity_check/);
    await expect(prisma.settlementHistory.create({ data: { month: parseDateOnly("2024-03-01"), revision: 1, action: "settle", snapshot: { month: "2024-04-01", revision: 1 } } })).rejects.toThrow(/SettlementHistory_identity_check/);
    await expect(prisma.settlementHistory.create({ data: { month: parseDateOnly("2024-03-01"), revision: 1, action: "settle", snapshot: { month: "2024-03", revision: 1, expenseAmountCents: -1 } } })).rejects.toThrow(/SettlementHistory_identity_check/);
  });

  it("installs usable trigram search indexes", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('Transaction_note_search_idx', 'Category_name_search_idx', 'Subscription_name_search_idx')`;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.indexdef.includes("USING gin") && row.indexdef.includes("gin_trgm_ops"))).toBe(true);
    const plans = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<Record<string, string>[]>`EXPLAIN SELECT id FROM "Transaction" WHERE note ILIKE '%searchable%'`;
    });
    expect(JSON.stringify(plans)).toContain("Transaction_note_search_idx");
  });
});
