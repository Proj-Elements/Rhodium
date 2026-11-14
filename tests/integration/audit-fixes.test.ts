import { beforeEach, describe, expect, it } from "vitest";
import { POST as createSubscription } from "@/app/api/subscriptions/route";
import { PATCH as patchSubscription } from "@/app/api/subscriptions/[id]/route";
import { PATCH as patchCategory } from "@/app/api/categories/[id]/route";
import { GET as getBudget, PUT as putBudget, DELETE as deleteBudget } from "@/app/api/budgets/[month]/route";
import { GET as getPreset, PUT as putPreset } from "@/app/api/budgets/preset/route";
import { POST as createTransaction } from "@/app/api/transactions/route";
import { PATCH as patchTransaction } from "@/app/api/transactions/[id]/route";
import { GET as transactionHistory } from "@/app/api/transactions/[id]/history/route";
import { GET as settlementHistory } from "@/app/api/settlements/[month]/history/route";
import { POST as settleMonth } from "@/app/api/settlements/[month]/settle/route";
import { POST as reopenMonth } from "@/app/api/settlements/[month]/reopen/route";
import { POST as previewImport } from "@/app/api/import/preview/route";
import { POST as importLedger } from "@/app/api/import/route";
import { GET as exportLedger } from "@/app/api/export/route";
import { addMonths, todayInShanghai } from "@/lib/domain";
import { ensureDefaultCategories, resetSeedCache } from "@/lib/seed";
import { authenticatedHeaders, createCategory, prisma, resetDatabase, routeContext } from "./helpers";

const month = "2024-03";
const context = routeContext({ month });
function request(body: unknown, method = "POST", key?: string) {
  return new Request("http://localhost/api/audit", { method, headers: { ...authenticatedHeaders(), ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body) });
}
const read = () => new Request("http://localhost");
const transactionInput = (categoryId: string) => ({ type: "expense", amount: "10", categoryId, occurredOn: `${month}-05` });

beforeEach(resetDatabase);

describe("audit regressions: creation and concurrency", () => {
  it("replays concurrent subscription creation and rejects a changed payload", async () => {
    const category = await createCategory();
    const payload = { name: "云盘", amount: "10", categoryId: category.id, billingDay: 1, startMonth: todayInShanghai().slice(0, 7) };
    const replies = await Promise.all([createSubscription(request(payload, "POST", "audit-create-0001")), createSubscription(request(payload, "POST", "audit-create-0001"))]);
    expect(replies.map((response) => response.status)).toEqual([201, 201]);
    expect(replies.map((response) => response.headers.get("Idempotent-Replay")).sort()).toEqual(["false", "true"]);
    const bodies = await Promise.all(replies.map((response) => response.json()));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.transaction.count()).toBe(1);
    expect((await createSubscription(request({ ...payload, amount: "20" }, "POST", "audit-create-0001"))).status).toBe(409);
    expect((await createTransaction(request(transactionInput(category.id), "POST", "audit-create-0001"))).status).toBe(201);
    const backup = await (await exportLedger(new Request("http://localhost/api/export"))).json();
    await resetDatabase();
    expect((await importLedger(request({ backup }))).status).toBe(200);
    expect((await createSubscription(request(payload, "POST", "audit-create-0001"))).headers.get("Idempotent-Replay")).toBe("true");
    expect(await prisma.subscription.count()).toBe(1);
  });

  it("refuses a stale full edit after a plan was paused", async () => {
    const category = await createCategory();
    const payload = { name: "云盘", amount: "10", categoryId: category.id, billingDay: 1, startMonth: todayInShanghai().slice(0, 7), active: true };
    const { subscription } = await (await createSubscription(request(payload))).json();
    const target = routeContext({ id: subscription.id });
    expect((await patchSubscription(request({ active: false, expectedVersion: subscription.version }, "PATCH"), target)).status).toBe(200);
    expect((await patchSubscription(request({ ...payload, amount: "20", expectedVersion: subscription.version }, "PATCH"), target)).status).toBe(409);
    expect(await prisma.subscription.findUnique({ where: { id: subscription.id } })).toMatchObject({ active: false, amountCents: 1000 });
  });

  it("refuses stale category edits and keeps renamed seed identities stable", async () => {
    await ensureDefaultCategories();
    const category = await prisma.category.findUniqueOrThrow({ where: { systemKey: "default-0" } });
    const target = routeContext({ id: category.id });
    expect((await patchCategory(request({ name: "餐食", expectedVersion: category.version }, "PATCH"), target)).status).toBe(200);
    expect((await patchCategory(request({ name: "旧页面", expectedVersion: category.version }, "PATCH"), target)).status).toBe(409);
    resetSeedCache();
    await ensureDefaultCategories();
    expect(await prisma.category.count()).toBe(13);
    expect(await prisma.category.count({ where: { name: "餐饮" } })).toBe(0);
  });

  it("protects monthly, future and preset budgets including delete/recreate", async () => {
    const first = await (await getBudget(read(), context)).json();
    expect((await putBudget(request({ amount: "100", expectedVersion: first.version }, "PUT"), context)).status).toBe(200);
    expect((await putBudget(request({ amount: "200", expectedVersion: first.version }, "PUT"), context)).status).toBe(409);
    const beforeDelete = await (await getBudget(read(), context)).json();
    expect((await deleteBudget(new Request(`http://localhost?expectedVersion=${beforeDelete.version}`), context)).status).toBe(200);
    const empty = await (await getBudget(read(), context)).json();
    expect((await putBudget(request({ amount: "100", expectedVersion: empty.version }, "PUT"), context)).status).toBe(200);
    expect((await putBudget(request({ amount: "200", expectedVersion: beforeDelete.version }, "PUT"), context)).status).toBe(409);
    const future = await (await getBudget(read(), context)).json();
    const nextContext = routeContext({ month: "2024-04" });
    const next = await (await getBudget(read(), nextContext)).json();
    await putBudget(request({ amount: "50", expectedVersion: next.version }, "PUT"), nextContext);
    expect((await putBudget(new Request("http://localhost?scope=future", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: "300", expectedVersion: future.futureVersion }) }), context)).status).toBe(409);
    const preset = await (await getPreset()).json();
    expect((await putPreset(request({ amount: "100", expectedVersion: preset.version }, "PUT"))).status).toBe(200);
    expect((await putPreset(request({ amount: "200", expectedVersion: preset.version }, "PUT"))).status).toBe(409);
  });

  it("refuses an old reopen request and pages immutable settlement history", async () => {
    expect((await settleMonth(request({}), context)).status).toBe(200);
    expect((await reopenMonth(request({ expectedVersion: 1 }), context)).status).toBe(200);
    expect((await settleMonth(request({}), context)).status).toBe(200);
    expect((await reopenMonth(request({ expectedVersion: 1 }), context)).status).toBe(409);
    expect(await prisma.monthlySettlement.findFirst()).toMatchObject({ revision: 3, reopenedAt: null });
    const first = await (await settlementHistory(new Request("http://localhost?limit=2"), context)).json();
    expect(first.history.map((entry: { revision: number }) => entry.revision)).toEqual([3, 2]);
    const second = await (await settlementHistory(new Request(`http://localhost?limit=2&cursor=${first.nextCursor}`), context)).json();
    expect(second.history.map((entry: { revision: number }) => entry.revision)).toEqual([1]);
    expect(second.nextCursor).toBeNull();
  });

  it("edits notes on archived categories and pages transaction history", async () => {
    const category = await createCategory();
    const payload = transactionInput(category.id);
    const { transaction } = await (await createTransaction(request(payload))).json();
    await patchCategory(request({ archived: true, expectedVersion: 1 }, "PATCH"), routeContext({ id: category.id }));
    const target = routeContext({ id: transaction.id });
    expect((await patchTransaction(request({ ...payload, note: "补充说明", expectedVersion: 1 }, "PATCH"), target)).status).toBe(200);
    const first = await (await transactionHistory(new Request("http://localhost?limit=1"), target)).json();
    expect(first.history[0].after.note).toBe("补充说明");
    const second = await (await transactionHistory(new Request(`http://localhost?limit=1&cursor=${first.nextCursor}`), target)).json();
    expect(second.history[0].version).toBe(1);
    expect(second.nextCursor).toBeNull();
  });
});

describe("audit regressions: preview and restore", () => {
  it("rejects future closed settlements and subscription income occurrences", async () => {
    const future = addMonths(todayInShanghai().slice(0, 7), 1);
    const backup = { settlements: [{ month: `${future}-01`, budgetAmountCents: 0, expenseAmountCents: 0, incomeAmountCents: 0 }] };
    expect((await previewImport(request({ backup }))).status).toBe(400);
    expect((await importLedger(request({ backup }))).status).toBe(400);
    const income = { transactions: [{ id: "bad-income", amountCents: 1000, occurredOn: `${month}-05`, categoryId: "category", type: "INCOME", source: "SUBSCRIPTION", subscriptionId: "plan", subscriptionMonth: `${month}-01`, subscriptionOccurrenceKey: `plan:${month}` }] };
    expect((await previewImport(request({ backup: income }))).status).toBe(400);
    expect((await importLedger(request({ backup: income }))).status).toBe(400);
    expect(await prisma.monthlySettlement.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("shows preset deletion and preserves newly named categories", async () => {
    await prisma.budgetPreset.create({ data: { id: 1, amountCents: 300000 } });
    const deletion = { backup: { budgetPreset: null } };
    const preview = await (await previewImport(request(deletion))).json();
    expect(preview.summary.budgetPreset).toEqual({ create: 0, update: 0, delete: 1 });
    expect((await importLedger(request(deletion))).status).toBe(200);
    expect(await prisma.budgetPreset.count()).toBe(0);
    const rows = [{ occurredOn: `${month}-05`, amount: "10", category: "第三方宠物" }, { occurredOn: `${month}-06`, amount: "5", category: "第三方宠物" }];
    const before = await (await previewImport(request({ format: "json", rows }))).json();
    expect(before.errors).toEqual([]);
    expect(before.summary.categories.create).toBe(1);
    const imported = await (await importLedger(request({ format: "json", rows }))).json();
    expect(imported.summary).toEqual(before.summary);
    expect(await prisma.category.count({ where: { name: "第三方宠物" } })).toBe(1);
    expect((await prisma.transaction.findMany({ include: { category: true } })).every((row) => row.category.name === "第三方宠物")).toBe(true);
  });

  it("previews missing subscriptions and invalid explicit categories as conflicts", async () => {
    const category = await createCategory();
    for (const extra of [{ source: "SUBSCRIPTION", subscriptionId: "missing-plan", categoryId: category.id }, { categoryId: "missing-category", category: category.name }]) {
      const payload = { format: "json", rows: [{ occurredOn: `${month}-05`, amount: "10", ...extra }] };
      const preview = await (await previewImport(request(payload))).json();
      expect(preview.summary.conflicts.length).toBeGreaterThan(0);
      expect((await importLedger(request(payload))).status).toBe(409);
    }
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("rejects a latest history snapshot that disagrees with a supplied or local entity", async () => {
    const category = await createCategory();
    await createTransaction(request(transactionInput(category.id)));
    const backup = await (await exportLedger(new Request("http://localhost/api/export"))).json();
    backup.transactionHistory[0].after.amountCents = 99900;
    await resetDatabase();
    const preview = await (await previewImport(request({ backup }))).json();
    expect(preview.summary.conflicts.join()).toContain("最新历史与账目内容不一致");
    expect((await importLedger(request({ backup }))).status).toBe(409);
    expect(await prisma.transaction.count()).toBe(0);
    const { transactionHistory: histories, ...entities } = backup;
    expect((await importLedger(request({ backup: entities }))).status).toBe(200);
    expect((await importLedger(request({ backup: { transactionHistory: histories } }))).status).toBe(409);
  });

  it("exports more than one page and restores both records and histories", async () => {
    const rows = Array.from({ length: 505 }, (_, index) => ({ occurredOn: `${month}-05`, amount: "1", category: "分页", note: `row-${index}` }));
    expect((await importLedger(request({ format: "json", rows }))).status).toBe(200);
    const backup = await (await exportLedger(new Request("http://localhost/api/export"))).json();
    expect(backup.transactions).toHaveLength(505);
    expect(backup.transactionHistory).toHaveLength(505);
    expect(new Set(backup.transactions.map((row: { id: string }) => row.id)).size).toBe(505);
    const csv = await (await exportLedger(new Request("http://localhost/api/export?format=csv"))).text();
    expect(csv.trim().split(/\r?\n/)).toHaveLength(506);
    await resetDatabase();
    expect((await importLedger(request({ backup }))).status).toBe(200);
    expect(await prisma.transaction.count()).toBe(505);
    expect(await prisma.transactionHistory.count()).toBe(505);
  });
});
