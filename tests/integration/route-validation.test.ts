import { CategoryType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as listTransactions, POST as createTransaction } from "@/app/api/transactions/route";
import { DELETE as deleteTransaction, PATCH as patchTransaction } from "@/app/api/transactions/[id]/route";
import { POST as createSubscription } from "@/app/api/subscriptions/route";
import { PATCH as patchSubscription } from "@/app/api/subscriptions/[id]/route";
import { monthStart } from "@/lib/domain";
import { addTransaction, createCategory, prisma, resetDatabase, routeContext } from "./helpers";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Lock a month the way a settlement does: settled and not reopened. */
function settleMonth(month: string) {
  return prisma.monthlySettlement.create({
    data: {
      month: monthStart(month),
      budgetAmountCents: 0,
      expenseAmountCents: 0,
      incomeAmountCents: 0,
      remainingAmountCents: null,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("transaction category validation", () => {
  it("creates a transaction when the category accepts the direction", async () => {
    const category = await createCategory("餐饮", CategoryType.EXPENSE);
    const response = await createTransaction(
      jsonRequest("http://localhost/api/transactions", "POST", {
        type: "expense",
        amount: "12.34",
        occurredOn: "2024-03-10",
        categoryId: category.id,
        note: "  午饭  ",
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.transaction).toMatchObject({
      type: "EXPENSE",
      amountCents: 1234,
      occurredOn: "2024-03-10",
      note: "午饭",
    });
    expect(body.transaction.category.id).toBe(category.id);
  });

  it("rejects an income entry pointed at an expense-only category", async () => {
    const category = await createCategory("餐饮", CategoryType.EXPENSE);
    const response = await createTransaction(
      jsonRequest("http://localhost/api/transactions", "POST", {
        type: "income",
        amount: "10",
        occurredOn: "2024-03-10",
        categoryId: category.id,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "请选择有效的分类" });
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("rejects an archived category", async () => {
    const category = await prisma.category.create({
      data: { name: "旧分类", type: CategoryType.EXPENSE, archivedAt: new Date() },
    });
    const response = await createTransaction(
      jsonRequest("http://localhost/api/transactions", "POST", {
        type: "expense",
        amount: "10",
        occurredOn: "2024-03-10",
        categoryId: category.id,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "请选择有效的分类" });
  });

  it("accepts a BOTH category for either direction", async () => {
    const category = await createCategory("调整", CategoryType.BOTH);
    for (const type of ["expense", "income"] as const) {
      const response = await createTransaction(
        jsonRequest("http://localhost/api/transactions", "POST", {
          type,
          amount: "5",
          occurredOn: "2024-03-11",
          categoryId: category.id,
        }),
      );
      expect(response.status).toBe(201);
    }
    expect(await prisma.transaction.count()).toBe(2);
  });

  it("applies the same guard on update and leaves the row untouched", async () => {
    const expense = await createCategory("餐饮", CategoryType.EXPENSE);
    const income = await createCategory("工资", CategoryType.INCOME);
    const transaction = await addTransaction({ categoryId: expense.id, date: "2024-03-10", amountCents: 1000 });
    const response = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${transaction.id}`, "PATCH", {
        type: "expense",
        amount: "20",
        occurredOn: "2024-03-12",
        categoryId: income.id,
      }),
      routeContext({ id: transaction.id }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "请选择有效的分类" });
    const unchanged = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(unchanged.amountCents).toBe(1000);
    expect(unchanged.categoryId).toBe(expense.id);
  });

  it("updates every mapped column on a valid patch", async () => {
    const expense = await createCategory("餐饮", CategoryType.EXPENSE);
    const other = await createCategory("交通", CategoryType.EXPENSE);
    const transaction = await addTransaction({ categoryId: expense.id, date: "2024-03-10", amountCents: 1000 });
    const response = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${transaction.id}`, "PATCH", {
        type: "expense",
        amount: "20.5",
        occurredOn: "2024-03-12",
        categoryId: other.id,
        note: "  改过  ",
      }),
      routeContext({ id: transaction.id }),
    );
    expect(response.status).toBe(200);
    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updated.amountCents).toBe(2050);
    expect(updated.categoryId).toBe(other.id);
    expect(updated.note).toBe("改过");
    expect(updated.occurredOn.toISOString().slice(0, 10)).toBe("2024-03-12");
  });
});

describe("subscription category validation", () => {
  const payload = (categoryId: string) => ({
    name: "视频会员",
    amount: "25",
    billingDay: 8,
    categoryId,
    startMonth: "2024-03",
    note: "  年付  ",
  });

  it("creates a subscription and normalises its columns", async () => {
    const category = await createCategory("订阅", CategoryType.EXPENSE);
    const response = await createSubscription(
      jsonRequest("http://localhost/api/subscriptions", "POST", payload(category.id)),
    );
    expect(response.status).toBe(201);
    const created = await prisma.subscription.findFirstOrThrow();
    expect(created.amountCents).toBe(2500);
    expect(created.note).toBe("年付");
    expect(created.active).toBe(true);
    expect(created.endMonth).toBeNull();
    expect(created.startMonth.toISOString().slice(0, 10)).toBe("2024-03-01");
  });

  it("rejects an income-only category", async () => {
    const category = await createCategory("工资", CategoryType.INCOME);
    const response = await createSubscription(
      jsonRequest("http://localhost/api/subscriptions", "POST", payload(category.id)),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "订阅必须使用有效的支出分类" });
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("applies the same guard on update", async () => {
    const expense = await createCategory("订阅", CategoryType.EXPENSE);
    const income = await createCategory("工资", CategoryType.INCOME);
    const subscription = await prisma.subscription.create({
      data: {
        name: "视频会员",
        amountCents: 2500,
        billingDay: 8,
        categoryId: expense.id,
        startMonth: new Date("2024-03-01T00:00:00.000Z"),
      },
    });
    const response = await patchSubscription(
      jsonRequest(`http://localhost/api/subscriptions/${subscription.id}`, "PATCH", payload(income.id)),
      routeContext({ id: subscription.id }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "订阅必须使用有效的支出分类" });
    const unchanged = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(unchanged.categoryId).toBe(expense.id);
  });
});

describe("settled month lock", () => {
  const LOCKED = "2024-03";

  it("refuses to create a transaction in a settled month", async () => {
    const category = await createCategory("餐饮", CategoryType.EXPENSE);
    await settleMonth(LOCKED);
    const response = await createTransaction(
      jsonRequest("http://localhost/api/transactions", "POST", {
        type: "expense",
        amount: "10",
        occurredOn: `${LOCKED}-10`,
        categoryId: category.id,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "本月已经结算，请先重新打开本月" });
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("refuses to move a transaction into a settled month", async () => {
    const category = await createCategory("餐饮", CategoryType.EXPENSE);
    const transaction = await addTransaction({ categoryId: category.id, date: "2024-04-10", amountCents: 1000 });
    await settleMonth(LOCKED);
    const response = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${transaction.id}`, "PATCH", {
        type: "expense",
        amount: "10",
        occurredOn: `${LOCKED}-10`,
        categoryId: category.id,
      }),
      routeContext({ id: transaction.id }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "目标月份已经结算，请先重新打开本月" });
    const unchanged = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(unchanged.occurredOn.toISOString().slice(0, 10)).toBe("2024-04-10");
  });

  it("refuses to delete a transaction that belongs to a settled month", async () => {
    const category = await createCategory("餐饮", CategoryType.EXPENSE);
    const transaction = await addTransaction({ categoryId: category.id, date: `${LOCKED}-10`, amountCents: 1000 });
    await settleMonth(LOCKED);
    const response = await deleteTransaction(new Request("http://localhost", { method: "DELETE" }), routeContext({ id: transaction.id }));
    expect(response.status).toBe(409);
    const kept = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(kept.deletedAt).toBeNull();
  });

  it("allows writes again once the month is reopened", async () => {
    const category = await createCategory("餐饮", CategoryType.EXPENSE);
    await settleMonth(LOCKED);
    await prisma.monthlySettlement.update({ where: { month: monthStart(LOCKED) }, data: { reopenedAt: new Date() } });
    const response = await createTransaction(
      jsonRequest("http://localhost/api/transactions", "POST", {
        type: "expense",
        amount: "10",
        occurredOn: `${LOCKED}-10`,
        categoryId: category.id,
      }),
    );
    expect(response.status).toBe(201);
  });

  it("reports the month as read-only when listing it", async () => {
    await settleMonth(LOCKED);
    const response = await listTransactions(new Request(`http://localhost/api/transactions?month=${LOCKED}`));
    expect(await response.json()).toMatchObject({ month: LOCKED, readOnly: true });
  });
});

describe("soft delete and restore", () => {
  it("hides a deleted transaction from the month list and brings it back on restore", async () => {
    const category = await createCategory("餐饮", CategoryType.EXPENSE);
    const transaction = await addTransaction({ categoryId: category.id, date: "2024-03-10", amountCents: 1000 });

    const deleted = await deleteTransaction(new Request("http://localhost", { method: "DELETE" }), routeContext({ id: transaction.id }));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ id: transaction.id, deleted: true });

    const hidden = await listTransactions(new Request("http://localhost/api/transactions?month=2024-03"));
    expect((await hidden.json()).transactions).toHaveLength(0);

    const restored = await patchTransaction(
      jsonRequest(`http://localhost/api/transactions/${transaction.id}`, "PATCH", { restore: true }),
      routeContext({ id: transaction.id }),
    );
    expect(restored.status).toBe(200);

    const visible = await listTransactions(new Request("http://localhost/api/transactions?month=2024-03"));
    expect((await visible.json()).transactions).toHaveLength(1);
  });

  it("answers 404 for an unknown id instead of leaking a Prisma error", async () => {
    const response = await patchTransaction(
      jsonRequest("http://localhost/api/transactions/missing", "PATCH", { restore: true }),
      routeContext({ id: "missing" }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "账目不存在" });
  });
});
