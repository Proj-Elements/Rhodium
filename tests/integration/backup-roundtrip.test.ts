import { beforeEach, describe, expect, it } from "vitest";
import { GET as exportLedger } from "@/app/api/export/route";
import { POST as importLedger } from "@/app/api/import/route";
import { POST as previewImport } from "@/app/api/import/preview/route";
import { PATCH as editTransaction } from "@/app/api/transactions/[id]/route";
import { POST as settleMonth } from "@/app/api/settlements/[month]/settle/route";
import { monthStart, parseDateOnly } from "@/lib/domain";
import { transactionSnapshot } from "@/lib/transaction-history";
import { serializeSettlement } from "@/lib/serializers";
import { authenticatedHeaders, prisma, resetDatabase, routeContext } from "./helpers";

function importRequest(backup: Record<string, unknown>, rows: unknown[] = []) {
  return new Request("http://localhost/api/import", {
    method: "POST", headers: authenticatedHeaders(),
    body: JSON.stringify({ backup: { ...backup, ...(rows.length ? { transactions: rows } : {}) } }),
  });
}

async function exportBackup() {
  const response = await exportLedger(new Request("http://localhost/api/export?format=json"));
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(resetDatabase);

describe("lossless JSON backup restore", () => {
  it("does not create an unexportable record from a future creation stamp without an update stamp", async () => {
    const backup = { categories: [{ id: "future-created", name: "未来创建", createdAt: "2099-01-01T00:00:00Z" }] };
    expect((await importLedger(importRequest(backup))).status).toBe(400);
    expect(await prisma.category.count()).toBe(0);
    expect((await exportBackup()).categories).toEqual([]);
  });
  it.each(["0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00"])("rejects UTC-overflowing metadata without poisoning later backups: %s", async (createdAt) => {
    const backup = { categories: [{ id: "overflow-date", name: "时间边界", type: "EXPENSE", createdAt }] };
    expect((await previewImport(importRequest(backup))).status).toBe(400);
    expect((await importLedger(importRequest(backup))).status).toBe(400);
    expect(await prisma.category.count()).toBe(0);
    expect((await exportBackup()).categories).toEqual([]);
  });
  it("can recover long notes written by legacy row imports", async () => {
    const category = await prisma.category.create({ data: { name: "旧备注" } });
    await prisma.transaction.create({ data: { type: "EXPENSE", categoryId: category.id, amountCents: 100, occurredOn: monthStart("2024-05"), note: "测".repeat(201) } });
    const backup = await exportBackup();
    await resetDatabase();
    expect((await importLedger(importRequest(backup, backup.transactions))).status).toBe(200);
    expect((await prisma.transaction.findFirstOrThrow()).note).toBe("测".repeat(201));
  });

  it("bounds preview samples while retaining complete legacy notes in the restore", async () => {
    const category = await prisma.category.create({ data: { name: "长备注预览" } });
    const note = "历史".repeat(10_000);
    const backup = { transactions: [{ id: "long-preview", categoryId: category.id, type: "EXPENSE", amountCents: 100, occurredOn: "2024-05-01", note }] };
    const preview = await previewImport(importRequest(backup));
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview[0].note).toBe(note.slice(0, 200));
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: "long-preview" } })).note).toBe(note);
  });
  it.each([0, 150_000])("round-trips the default budget %i into an empty ledger", async (amountCents) => {
    await prisma.budgetPreset.create({ data: { id: 1, amountCents } });
    const backup = await exportBackup();
    expect(backup.budgetPreset).toMatchObject({ amountCents });
    await resetDatabase();
    expect((await importLedger(importRequest(backup, backup.transactions))).status).toBe(200);
    expect(await prisma.budgetPreset.findUnique({ where: { id: 1 } })).toMatchObject({ amountCents });
  });

  it("restores an absent preset but preserves it for legacy backups without the field", async () => {
    const backup = await exportBackup();
    expect(backup.budgetPreset).toBeNull();
    await prisma.budgetPreset.create({ data: { id: 1, amountCents: 50_000 } });
    expect((await importLedger(importRequest({ version: 1 }))).status).toBe(200);
    expect(await prisma.budgetPreset.findUnique({ where: { id: 1 } })).toMatchObject({ amountCents: 50_000 });
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.budgetPreset.findUnique({ where: { id: 1 } })).toBeNull();
  });

  it("preserves archived historical categories without reactivating them", async () => {
    const archivedAt = new Date("2024-06-01T00:00:00Z");
    const category = await prisma.category.create({ data: { name: "旧爱好", archivedAt, icon: "leaf" } });
    await prisma.transaction.create({ data: { type: "EXPENSE", categoryId: category.id, amountCents: 2300, occurredOn: parseDateOnly("2024-05-10") } });
    const backup = await exportBackup();
    await resetDatabase();
    expect((await importLedger(importRequest(backup, backup.transactions))).status).toBe(200);
    const restored = await prisma.transaction.findFirstOrThrow({ include: { category: true } });
    expect(restored.category).toMatchObject({ name: "旧爱好", icon: "leaf", archivedAt });
    expect(restored.amountCents).toBe(2300);
  });

  it("restores archive metadata when a seeded natural-key category already exists", async () => {
    const archivedAt = new Date("2024-06-01T00:00:00Z");
    await prisma.category.create({ data: { name: "餐饮", type: "EXPENSE", isSystem: true, archivedAt } });
    const backup = await exportBackup();
    await resetDatabase();
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.category.findUnique({ where: { name_type: { name: "餐饮", type: "EXPENSE" } } })).toMatchObject({ archivedAt });
  });

  it("restores category ordering even when seeding creates the category first", async () => {
    await prisma.category.create({ data: { name: "餐饮", type: "EXPENSE", isSystem: true, sortOrder: 42 } });
    const backup = await exportBackup();
    await resetDatabase();
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.category.findUnique({ where: { name_type: { name: "餐饮", type: "EXPENSE" } } })).toMatchObject({ sortOrder: 42 });
  });

  it("keeps distinct same-name subscriptions and occurrences across repeated restore", async () => {
    const category = await prisma.category.create({ data: { name: "会员", type: "EXPENSE" } });
    for (const amountCents of [1000, 2000]) {
      const subscription = await prisma.subscription.create({ data: { name: "音乐会员", categoryId: category.id, amountCents, billingDay: 1, startMonth: monthStart("2024-05") } });
      await prisma.transaction.create({ data: {
        type: "EXPENSE", categoryId: category.id, amountCents, occurredOn: parseDateOnly("2024-05-01"),
        source: "SUBSCRIPTION", subscriptionId: subscription.id, subscriptionMonth: monthStart("2024-05"),
        subscriptionOccurrenceKey: `${subscription.id}:2024-05`,
      } });
    }
    const backup = await exportBackup();
    await resetDatabase();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await importLedger(importRequest(backup, backup.transactions))).status).toBe(200);
      expect(await prisma.subscription.count()).toBe(2);
      const rows = await prisma.transaction.findMany({ orderBy: { amountCents: "asc" }, include: { subscription: true } });
      expect(rows.map((row) => row.amountCents)).toEqual([1000, 2000]);
      expect(rows.map((row) => row.subscription?.amountCents)).toEqual([1000, 2000]);
      expect(new Set(rows.map((row) => row.subscriptionId)).size).toBe(2);
    }
  });

  it("does not overwrite an unrelated subscription merely because its name matches", async () => {
    const category = await prisma.category.create({ data: { name: "会员" } });
    const local = await prisma.subscription.create({ data: { name: "音乐会员", categoryId: category.id, amountCents: 9000, billingDay: 1, startMonth: monthStart("2024-05") } });
    const backup = { version: 1, subscriptions: [{ id: "foreign-subscription", name: "音乐会员", categoryId: category.id, amountCents: 1000, billingDay: 1, startMonth: "2024-05" }] };
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(2);
    expect(await prisma.subscription.findUnique({ where: { id: local.id } })).toMatchObject({ amountCents: 9000 });
  });

  it("rejects duplicate subscription correlation IDs before any writes", async () => {
    const category = await prisma.category.create({ data: { name: "会员" } });
    const row = { id: "duplicate", name: "音乐会员", categoryId: category.id, amountCents: 1000, billingDay: 1, startMonth: "2024-05" };
    expect((await importLedger(importRequest({ version: 1, subscriptions: [row, { ...row, amountCents: 2000 }] }))).status).toBe(400);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("keeps released soft-deleted occurrences alongside their live replacements", async () => {
    const category = await prisma.category.create({ data: { name: "会员" } });
    const subscription = await prisma.subscription.create({ data: {
      name: "音乐", categoryId: category.id, amountCents: 1000, billingDay: 1, startMonth: monthStart("2024-05"),
    } });
    const occurrence = {
      type: "EXPENSE" as const, categoryId: category.id, amountCents: 1000, occurredOn: parseDateOnly("2024-05-01"),
      source: "SUBSCRIPTION" as const, subscriptionId: subscription.id, subscriptionMonth: monthStart("2024-05"),
    };
    await prisma.transaction.create({ data: { ...occurrence, deletedAt: new Date("2024-05-02"), subscriptionOccurrenceKey: null } });
    await prisma.transaction.create({ data: { ...occurrence, subscriptionOccurrenceKey: `${subscription.id}:2024-05` } });
    const backup = await exportBackup();
    await resetDatabase();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await importLedger(importRequest(backup, backup.transactions));
      expect(response.status).toBe(200);
      expect(await prisma.transaction.count()).toBe(2);
      expect(await prisma.transaction.count({ where: { deletedAt: null } })).toBe(1);
      expect(await prisma.transaction.count({ where: { deletedAt: { not: null }, subscriptionOccurrenceKey: null } })).toBe(1);
    }
  });

  it("round-trips legal settlement aggregates above the per-transaction amount ceiling", async () => {
    const category = await prisma.category.create({ data: { name: "大额历史" } });
    await prisma.transaction.createMany({ data: [1, 2].map(() => ({
      type: "EXPENSE" as const, categoryId: category.id, amountCents: 1_050_000_000, occurredOn: monthStart("2024-05"),
    })) });
    await prisma.monthlySettlement.create({ data: {
      month: monthStart("2024-05"), budgetAmountCents: 0, expenseAmountCents: 2_100_000_000,
      incomeAmountCents: 0, remainingAmountCents: -2_100_000_000,
    } });
    const backup = await exportBackup();
    await resetDatabase();
    expect((await importLedger(importRequest(backup, backup.transactions))).status).toBe(200);
    expect(await prisma.monthlySettlement.findUnique({ where: { month: monthStart("2024-05") } })).toMatchObject({
      expenseAmountCents: 2_100_000_000, remainingAmountCents: -2_100_000_000,
    });
  });

  it("previews and rejects an inconsistent merged settlement without changing any data", async () => {
    const category = await prisma.category.create({ data: { name: "合并冲突" } });
    await prisma.transaction.create({ data: { id: "local", type: "EXPENSE", categoryId: category.id, amountCents: 200, occurredOn: monthStart("2024-05") } });
    const backup = {
      version: 2,
      transactions: [{ id: "incoming", categoryId: category.id, type: "EXPENSE", amountCents: 100, occurredOn: "2024-05-01" }],
      budgets: [{ month: "2024-05-01", amountCents: 1000 }],
      settlements: [{ month: "2024-05-01", budgetAmountCents: 1000, expenseAmountCents: 100, incomeAmountCents: 0, remainingAmountCents: 900 }],
    };
    const preview = await previewImport(new Request("http://localhost/api/import/preview", { method: "POST", headers: authenticatedHeaders(), body: JSON.stringify({ backup }) }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).summary.conflicts[0]).toContain("结算与合并后的账目不一致");
    const response = await importLedger(importRequest(backup));
    expect(response.status).toBe(409);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await prisma.monthlyBudget.count()).toBe(0);
    expect(await prisma.monthlySettlement.count()).toBe(0);
  });

  it("preserves transaction timestamps in an empty restore and never revives an old concurrency version", async () => {
    const category = await prisma.category.create({ data: { name: "版本恢复" } });
    const createdAt = new Date("2024-05-01T08:00:00.000Z");
    const updatedAt = new Date("2024-05-02T08:00:00.000Z");
    const backup = { version: 2, transactions: [{ id: "versioned", categoryId: category.id, type: "EXPENSE", amountCents: 100, occurredOn: "2024-05-01", version: 2, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() }] };
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.transaction.findUnique({ where: { id: "versioned" } })).toMatchObject({ version: 2, createdAt, updatedAt });
    await prisma.transaction.update({ where: { id: "versioned" }, data: { amountCents: 200, version: 5 } });
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.transaction.findUnique({ where: { id: "versioned" } })).toMatchObject({ amountCents: 100, version: 6 });
    expect(await prisma.transactionHistory.findFirst({ where: { transactionId: "versioned" } })).toMatchObject({ action: "restore_backup", version: 6 });
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.transaction.findUnique({ where: { id: "versioned" } })).toMatchObject({ version: 6 });
    expect(await prisma.transactionHistory.count()).toBe(1);
  });

  it("does not discard a stable backup transaction when another identity holds its subscription occurrence", async () => {
    const category = await prisma.category.create({ data: { name: "发生冲突" } });
    const subscription = await prisma.subscription.create({ data: { name: "会员", categoryId: category.id, amountCents: 100, billingDay: 1, startMonth: monthStart("2024-05") } });
    await prisma.transaction.create({ data: { id: "local-owner", categoryId: category.id, type: "EXPENSE", amountCents: 100, occurredOn: monthStart("2024-05"), source: "SUBSCRIPTION", subscriptionId: subscription.id, subscriptionMonth: monthStart("2024-05"), subscriptionOccurrenceKey: `${subscription.id}:2024-05` } });
    const backup = { version: 2, transactions: [{ id: "backup-owner", categoryId: category.id, type: "EXPENSE", amountCents: 100, occurredOn: "2024-05-01", source: "SUBSCRIPTION", subscriptionId: subscription.id, subscriptionMonth: "2024-05-01", subscriptionOccurrenceKey: `${subscription.id}:2024-05` }] };
    const response = await importLedger(importRequest(backup));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("另一笔账目");
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("keeps a newer archived revision when its accounting values already match", async () => {
    const category = await prisma.category.create({ data: { name: "相同内容新版本" } });
    const transaction = await prisma.transaction.create({ data: { id: "same-values", type: "EXPENSE", categoryId: category.id, amountCents: 100, occurredOn: monthStart("2024-05") } });
    const backup = { version: 2, transactions: [{ ...transaction, occurredOn: "2024-05-01", version: 5 }], transactionHistory: [{ id: "newer-history", transactionId: transaction.id, version: 5, action: "edit", after: transactionSnapshot({ ...transaction, version: 5 }), recordedAt: "2024-05-01T00:00:00.000Z" }] };
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.transaction.findUnique({ where: { id: transaction.id } })).toMatchObject({ version: 5 });
    expect((await exportBackup()).transactions[0].version).toBe(5);
  });

  it("round-trips immutable histories and durable creation keys and rejects divergent history", async () => {
    const category = await prisma.category.create({ data: { name: "完整追溯" } });
    const transaction = await prisma.transaction.create({ data: { type: "EXPENSE", categoryId: category.id, amountCents: 100, occurredOn: monthStart("2024-05"), version: 3, note: "原记录" } });
    await prisma.transactionHistory.create({ data: { transactionId: transaction.id, version: 3, action: "create", after: transactionSnapshot(transaction) } });
    const settlement = await prisma.monthlySettlement.create({ data: { month: monthStart("2024-05"), budgetAmountCents: 0, expenseAmountCents: 100, incomeAmountCents: 0, revision: 2, reopenedAt: new Date("2024-05-02T00:00:00.000Z") } });
    await prisma.settlementHistory.create({ data: { month: monthStart("2024-05"), revision: 2, action: "reopen", snapshot: serializeSettlement(settlement) } });
    await prisma.creationRequest.create({ data: { key: "durable-key", requestHash: "hash", response: { transaction: { id: transaction.id } } } });
    const backup = await exportBackup();
    await resetDatabase();
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.transactionHistory.count()).toBe(1);
    expect(await prisma.settlementHistory.count()).toBe(1);
    expect(await prisma.creationRequest.findUnique({ where: { key: "durable-key" } })).toMatchObject({ requestHash: "hash" });
    const divergent = structuredClone(backup);
    divergent.transactionHistory[0].after.note = "篡改";
    expect((await importLedger(importRequest(divergent))).status).toBe(409);
    expect((await prisma.transactionHistory.findFirstOrThrow()).after).toMatchObject({ note: "原记录" });
  });

  it.each(["transaction", "settlement"] as const)("rejects future %s history in a partial restore without blocking the next write", async (entity) => {
    const category = await prisma.category.create({ data: { name: "历史版本边界" } });
    const transaction = await prisma.transaction.create({ data: { type: "EXPENSE", categoryId: category.id, amountCents: 100, occurredOn: monthStart("2024-05") } });
    await prisma.monthlySettlement.create({ data: { month: monthStart("2024-05"), budgetAmountCents: 0, expenseAmountCents: 100, incomeAmountCents: 0, reopenedAt: new Date("2024-05-02T00:00:00.000Z") } });
    const history = entity === "transaction"
      ? { transactionHistory: [{ id: "future", transactionId: transaction.id, version: 2, action: "edit", after: { id: transaction.id, version: 2 }, recordedAt: "2024-05-02T00:00:00.000Z" }] }
      : { settlementHistory: [{ id: "future", month: "2024-05-01", revision: 2, action: "settle", snapshot: { month: "2024-05", revision: 2 }, recordedAt: "2024-05-02T00:00:00.000Z" }] };
    const backup = { version: 2, ...history };
    const preview = await previewImport(importRequest(backup));
    expect(preview.status).toBe(200);
    expect((await preview.json()).summary.conflicts).toEqual([expect.stringContaining("历史版本超出合并后")]);
    expect((await importLedger(importRequest(backup))).status).toBe(409);
    expect(await prisma.transactionHistory.count()).toBe(0);
    expect(await prisma.settlementHistory.count()).toBe(0);
    const response = entity === "transaction"
      ? await editTransaction(new Request("http://localhost/api/transactions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "expense", amount: "1.00", categoryId: category.id, occurredOn: "2024-05-01", note: "仍可编辑", expectedVersion: 1 }) }), routeContext({ id: transaction.id }))
      : await settleMonth(new Request("http://localhost/api/settlements/2024-05/settle", { method: "POST" }), routeContext({ month: "2024-05" }));
    expect(response.status).toBe(200);
    await exportBackup();
  });

  it.each(["transaction", "settlement"] as const)("requires a target entity for partial %s history", async (entity) => {
    const history = entity === "transaction"
      ? { transactionHistory: [{ id: "orphan", transactionId: "missing", version: 1, action: "create", after: { id: "missing", version: 1 }, recordedAt: "2024-05-01T00:00:00.000Z" }] }
      : { settlementHistory: [{ id: "orphan", month: "2024-05-01", revision: 1, action: "settle", snapshot: { month: "2024-05", revision: 1 }, recordedAt: "2024-05-01T00:00:00.000Z" }] };
    const backup = { version: 2, ...history };
    const preview = await previewImport(importRequest(backup));
    expect((await preview.json()).summary.conflicts).toEqual([expect.stringContaining("缺少对应")]);
    expect((await importLedger(importRequest(backup))).status).toBe(409);
    expect(await prisma.transactionHistory.count()).toBe(0);
    expect(await prisma.settlementHistory.count()).toBe(0);
  });

  it("accepts partial history for existing entity versions", async () => {
    const category = await prisma.category.create({ data: { name: "补全历史" } });
    const transaction = await prisma.transaction.create({ data: { type: "EXPENSE", categoryId: category.id, amountCents: 100, occurredOn: monthStart("2024-05"), version: 3 } });
    await prisma.monthlySettlement.create({ data: { month: monthStart("2024-05"), budgetAmountCents: 0, expenseAmountCents: 100, incomeAmountCents: 0, revision: 3, reopenedAt: new Date("2024-05-02T00:00:00.000Z") } });
    const backup = { version: 2,
      transactionHistory: [{ id: "past-transaction", transactionId: transaction.id, version: 2, action: "edit", after: { id: transaction.id, version: 2 }, recordedAt: "2024-05-01T00:00:00.000Z" }],
      settlementHistory: [{ id: "past-settlement", month: "2024-05-01", revision: 2, action: "reopen", snapshot: { month: "2024-05", revision: 2 }, recordedAt: "2024-05-01T00:00:00.000Z" }],
    };
    expect((await previewImport(importRequest(backup))).status).toBe(200);
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.transactionHistory.count()).toBe(1);
    expect(await prisma.settlementHistory.count()).toBe(1);
    await exportBackup();
  });

  it("restores more than PostgreSQL's single-query bind limit atomically with closing metadata last", async () => {
    const category = await prisma.category.create({ data: { name: "大备份" } });
    for (let offset = 0; offset < 33_001; offset += 1000) await prisma.transaction.createMany({ data: Array.from({ length: Math.min(1000, 33_001 - offset) }, (_, index) => ({ id: `large-${offset + index}`, type: "EXPENSE" as const, categoryId: category.id, amountCents: 1, occurredOn: monthStart("2024-05") })) });
    await prisma.monthlySettlement.create({ data: { month: monthStart("2024-05"), budgetAmountCents: 40_000, expenseAmountCents: 33_001, incomeAmountCents: 0, remainingAmountCents: 6_999 } });
    const backup = await exportBackup();
    await resetDatabase();
    const response = await importLedger(importRequest(backup));
    expect(response.status).toBe(200);
    expect(await prisma.transaction.count()).toBe(33_001);
    expect(await prisma.monthlySettlement.findUnique({ where: { month: monthStart("2024-05") } })).toMatchObject({ expenseAmountCents: 33_001, reopenedAt: null });
  });
});
