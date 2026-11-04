import { CategoryType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as exportBackup } from "@/app/api/export/route";
import { POST as importBackup } from "@/app/api/import/route";
import { GET as getSettlementSummary } from "@/app/api/settlements/[month]/route";
import { GET as listTransactions, POST as createTransaction } from "@/app/api/transactions/route";
import { DELETE as deleteTransaction, PATCH as patchTransaction } from "@/app/api/transactions/[id]/route";
import { monthStart } from "@/lib/domain";
import { getMonthSummary } from "@/lib/summary";
import { createCategory, prisma, resetDatabase, routeContext } from "./helpers";
const MONTH = "2024-03";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** find-or-create：首个 API 调用会播种同名系统分类，不能重复建。 */
async function findOrCreateCategory(name: string, type: CategoryType) {
  return (await prisma.category.findFirst({ where: { name, type } })) ?? createCategory(name, type);
}

async function createExpense(amount: string, occurredOn: string) {
  const category = await findOrCreateCategory("餐饮", CategoryType.EXPENSE);
  const response = await createTransaction(
    jsonRequest("http://localhost/api/transactions", "POST", {
      type: "expense",
      amount,
      occurredOn,
      categoryId: category.id,
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { transaction: { id: string } }).transaction.id;
}

function reimburse(id: string) {
  return patchTransaction(
    jsonRequest(`http://localhost/api/transactions/${id}`, "PATCH", { reimburse: true }),
    routeContext({ id }),
  );
}

function unreimburse(id: string, body: unknown = { unreimburse: true }) {
  return patchTransaction(
    jsonRequest(`http://localhost/api/transactions/${id}`, "PATCH", body),
    routeContext({ id }),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

describe("PATCH /api/transactions/[id] { reimburse: true }", () => {
  it("stamps reimbursedAt and keeps amount, category and date untouched", async () => {
    const id = await createExpense("12.34", `${MONTH}-10`);

    const response = await reimburse(id);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { transaction: { reimbursedAt: string | null; amountCents: number } };
    expect(payload.transaction.reimbursedAt).not.toBeNull();
    expect(payload.transaction.amountCents).toBe(1_234);

    const stored = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(stored.reimbursedAt).not.toBeNull();
    // 报销不动账目本体：金额、日期、分类原样保留。
    expect(stored.amountCents).toBe(1_234);
    expect(stored.occurredOn).toEqual(new Date(`${MONTH}-10T00:00:00.000Z`));
  });

  it("is idempotent: reimbursing twice returns the same row", async () => {
    const id = await createExpense("10.00", `${MONTH}-10`);
    expect((await reimburse(id)).status).toBe(200);
    const first = (await prisma.transaction.findUniqueOrThrow({ where: { id } })).reimbursedAt;

    const second = await reimburse(id);
    expect(second.status).toBe(200);
    const stored = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(stored.reimbursedAt).toEqual(first);
  });

  it("refuses income rows and deleted rows", async () => {
    const category = await createCategory("工资", CategoryType.INCOME);
    const incomeId = (
      await (
        await createTransaction(
          jsonRequest("http://localhost/api/transactions", "POST", {
            type: "income",
            amount: "88",
            occurredOn: `${MONTH}-11`,
            categoryId: category.id,
          }),
        )
      ).json()
    ).transaction.id as string;
    const incomeResponse = await reimburse(incomeId);
    expect(incomeResponse.status).toBe(409);
    expect(await incomeResponse.json()).toMatchObject({ error: "只有支出才能标记报销" });

    const expenseId = await createExpense("10.00", `${MONTH}-12`);
    await deleteTransaction(new Request("http://localhost", { method: "DELETE" }), routeContext({ id: expenseId }));
    const deletedResponse = await reimburse(expenseId);
    expect(deletedResponse.status).toBe(409);
    expect(await deletedResponse.json()).toMatchObject({ error: "这条账目已被删除，无法报销" });
  });

  it("refuses inside a settled month", async () => {
    const id = await createExpense("10.00", `${MONTH}-10`);
    await prisma.monthlySettlement.create({
      data: { month: monthStart(MONTH), budgetAmountCents: 0, expenseAmountCents: 0, incomeAmountCents: 0, remainingAmountCents: 0 },
    });

    const response = await reimburse(id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "本月已经结算，请先重新打开本月" });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id } })).reimbursedAt).toBeNull();
  });

  it("rejects unknown extra fields and answers 404 for a missing id", async () => {
    const id = await createExpense("10.00", `${MONTH}-10`);
    const extra = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${id}`, "PATCH", { reimburse: true, amount: "1" }),
      routeContext({ id }),
    );
    expect(extra.status).toBe(400);

    const missing = await patchTransaction(
      jsonRequest("http://localhost/api/transactions/missing", "PATCH", { reimburse: true }),
      routeContext({ id: "missing" }),
    );
    expect(missing.status).toBe(404);
  });

  it("clears the reimbursement on a full edit and preserves it across delete/restore", async () => {
    const id = await createExpense("10.00", `${MONTH}-10`);
    await reimburse(id);

    // 完整编辑会撤销报销（先取消再改金额，避免已报销账目被偷偷改动）。
    const category = await findOrCreateCategory("交通", CategoryType.EXPENSE);
    const edited = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${id}`, "PATCH", {
        type: "expense",
        amount: "20.00",
        occurredOn: `${MONTH}-15`,
        categoryId: category.id,
      }),
      routeContext({ id }),
    );
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { transaction: { reimbursedAt: string | null } }).transaction.reimbursedAt).toBeNull();

    await reimburse(id);
    await deleteTransaction(new Request("http://localhost", { method: "DELETE" }), routeContext({ id }));
    const restored = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${id}`, "PATCH", { restore: true }),
      routeContext({ id }),
    );
    expect(restored.status).toBe(200);
    // 删除/恢复不触碰报销状态。
    expect(((await restored.json()) as { transaction: { reimbursedAt: string | null } }).transaction.reimbursedAt).not.toBeNull();
  });
});

describe("reimbursement flows through the aggregates", () => {
  it("dashboard excludes reimbursed expenses from totals, budget and category breakdown", async () => {
    const reimbursedId = await createExpense("30.00", `${MONTH}-05`);
    const keptId = await createExpense("70.00", `${MONTH}-06`);
    await reimburse(reimbursedId);

    const response = await getDashboard(new Request(`http://localhost/api/dashboard?month=${MONTH}`));
    const payload = (await response.json()) as {
      expenseCents: number;
      outOfPocketCents: number;
      reimbursedCents: number;
      reimbursedCount: number;
      remainingCents: number | null;
      categoryBreakdown: { amountCents: number }[];
    };

    expect(payload.expenseCents).toBe(7_000);
    expect(payload.outOfPocketCents).toBe(7_000);
    expect(payload.reimbursedCents).toBe(3_000);
    expect(payload.reimbursedCount).toBe(1);
    // 分类排行只剩未报销的那笔。
    expect(payload.categoryBreakdown).toMatchObject([{ amountCents: 7_000 }]);

    // 未报销口径参与预算：预置 50 元，自付 70 元 → 剩余 -20 元。
    await prisma.budgetPreset.create({ data: { id: 1, amountCents: 5_000 } });
    const withBudget = await (await getDashboard(new Request(`http://localhost/api/dashboard?month=${MONTH}`))).json();
    expect(withBudget.remainingCents).toBe(-2_000);
    expect(keptId).toBeTruthy();
  });

  it("monthly summary and settlement snapshot use the out-of-pocket amount", async () => {
    const reimbursedId = await createExpense("30.00", `${MONTH}-05`);
    await createExpense("70.00", `${MONTH}-06`);
    await reimburse(reimbursedId);

    const summary = await getMonthSummary(MONTH);
    expect(summary.expenseCents).toBe(10_000);
    expect(summary.outOfPocketCents).toBe(7_000);
    expect(summary.reimbursedCents).toBe(3_000);
    expect(summary.reimbursedCount).toBe(1);

    const response = await getSettlementSummary(new Request(`http://localhost/api/settlements/${MONTH}`), routeContext({ month: MONTH }));
    const payload = (await response.json()) as { summary: { expenseCents: number; outOfPocketCents: number; remainingCents: number | null } };
    expect(payload.summary.expenseCents).toBe(10_000);
    expect(payload.summary.outOfPocketCents).toBe(7_000);
    expect(payload.summary.remainingCents).toBeNull();
  });

  it("keeps reimbursed rows visible in the month list and un-reimburses on edit", async () => {
    const id = await createExpense("30.00", `${MONTH}-05`);
    await reimburse(id);

    const list = await (await listTransactions(new Request(`http://localhost/api/transactions?month=${MONTH}`))).json();
    expect(list.transactions).toHaveLength(1);
    expect(list.transactions[0].reimbursedAt).not.toBeNull();

    const category = (await prisma.category.findFirstOrThrow({ where: { name: "餐饮" } }));
    const edited = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${id}`, "PATCH", {
        type: "expense",
        amount: "30.00",
        occurredOn: `${MONTH}-05`,
        categoryId: category.id,
      }),
      routeContext({ id }),
    );
    expect(edited.status).toBe(200);
    const summary = await getMonthSummary(MONTH);
    expect(summary.reimbursedCount).toBe(0);
    expect(summary.expenseCents).toBe(3_000);
  });
});

describe("PATCH /api/transactions/[id] { unreimburse: true }", () => {
  it("clears only the reimbursement stamp and restores budget consumption", async () => {
    const id = await createExpense("30.00", `${MONTH}-10`);
    await reimburse(id);
    const before = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    await prisma.budgetPreset.create({ data: { id: 1, amountCents: 5_000 } });

    const response = await unreimburse(id);
    expect(response.status).toBe(200);
    expect((await response.json()).transaction.reimbursedAt).toBeNull();
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({
      amountCents: before.amountCents,
      occurredOn: before.occurredOn,
      categoryId: before.categoryId,
      note: before.note,
      source: before.source,
      reimbursedAt: null,
    });
    const dashboard = await (await getDashboard(new Request(`http://localhost/api/dashboard?month=${MONTH}`))).json();
    expect(dashboard.expenseCents).toBe(3_000);
    expect(dashboard.remainingCents).toBe(2_000);
    expect(dashboard.reimbursedCount).toBe(0);

    expect((await unreimburse(id)).status).toBe(200);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id } })).updatedAt).toEqual(after.updatedAt);
  });

  it("refuses income, deleted rows and locked months without changing their stamps", async () => {
    const category = await createCategory("工资", CategoryType.INCOME);
    const income = await prisma.transaction.create({
      data: { categoryId: category.id, type: "INCOME", amountCents: 100, occurredOn: monthStart(MONTH) },
    });
    expect((await unreimburse(income.id)).status).toBe(409);

    const deletedId = await createExpense("10.00", `${MONTH}-10`);
    await reimburse(deletedId);
    const deletedStamp = (await prisma.transaction.findUniqueOrThrow({ where: { id: deletedId } })).reimbursedAt;
    await deleteTransaction(new Request("http://localhost", { method: "DELETE" }), routeContext({ id: deletedId }));
    expect((await unreimburse(deletedId)).status).toBe(409);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: deletedId } })).reimbursedAt).toEqual(deletedStamp);

    const lockedId = await createExpense("20.00", `${MONTH}-11`);
    await reimburse(lockedId);
    const lockedStamp = (await prisma.transaction.findUniqueOrThrow({ where: { id: lockedId } })).reimbursedAt;
    await prisma.monthlySettlement.create({
      data: { month: monthStart(MONTH), budgetAmountCents: 0, expenseAmountCents: 0, incomeAmountCents: 0, remainingAmountCents: 0 },
    });
    expect((await unreimburse(lockedId)).status).toBe(409);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: lockedId } })).reimbursedAt).toEqual(lockedStamp);
  });

  it.each([
    { unreimburse: false },
    { unreimburse: true, amount: "1" },
    { unreimburse: true, reimburse: true },
    { unreimburse: true, restore: true },
  ])("rejects invalid undo bodies %j", async (body) => {
    const id = await createExpense("10.00", `${MONTH}-10`);
    await reimburse(id);
    expect((await unreimburse(id, body)).status).toBe(400);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id } })).reimbursedAt).not.toBeNull();
  });

  it("answers 404 for a missing row", async () => {
    expect((await unreimburse("missing")).status).toBe(404);
  });

  it.each(["reimburse", "unreimburse"])("rejects %s mixed with a complete edit body", async (action) => {
    const id = await createExpense("10.00", `${MONTH}-10`);
    await reimburse(id);
    const before = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    const response = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${id}`, "PATCH", {
        [action]: true,
        type: "expense",
        amount: "1.00",
        occurredOn: `${MONTH}-10`,
        categoryId: before.categoryId,
      }),
      routeContext({ id }),
    );
    expect(response.status).toBe(400);
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(after.amountCents).toBe(before.amountCents);
    expect(after.reimbursedAt).toEqual(before.reimbursedAt);
  });
});

describe("reimbursement backup round-trip", () => {
  it("preserves a deleted expense's reimbursement when exporting, importing and restoring", async () => {
    const id = await createExpense("30.00", `${MONTH}-10`);
    await reimburse(id);
    const stamp = (await prisma.transaction.findUniqueOrThrow({ where: { id } })).reimbursedAt;
    await deleteTransaction(new Request("http://localhost", { method: "DELETE" }), routeContext({ id }));
    const backup = await (await exportBackup(new Request("http://localhost/api/export?format=json"))).json();

    await resetDatabase();
    const imported = await importBackup(jsonRequest("http://localhost/api/import", "POST", {
      format: "json",
      rows: backup.transactions,
      backup,
    }));
    expect(imported.status).toBe(200);
    const stored = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.reimbursedAt).toEqual(stamp);

    const restored = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${id}`, "PATCH", { restore: true }),
      routeContext({ id }),
    );
    expect(restored.status).toBe(200);
    const summary = await getMonthSummary(MONTH);
    expect(summary.outOfPocketCents).toBe(0);
    expect(summary.reimbursedCents).toBe(3_000);
  });

  it("discards reimbursement timestamps on income rows", async () => {
    const response = await importBackup(jsonRequest("http://localhost/api/import", "POST", {
      format: "json",
      rows: [{ occurredOn: `${MONTH}-10`, amountCents: 1_000, type: "income", reimbursedAt: "2024-03-11T00:00:00.000Z" }],
    }));
    expect(response.status).toBe(200);
    const stored = await prisma.transaction.findFirstOrThrow();
    expect(stored.type).toBe("INCOME");
    expect(stored.reimbursedAt).toBeNull();
  });
});
