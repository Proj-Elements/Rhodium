import { beforeEach, describe, expect, it } from "vitest";
import { POST as createTransaction } from "@/app/api/transactions/route";
import { PATCH as patchTransaction } from "@/app/api/transactions/[id]/route";
import { GET as getTransactionHistory } from "@/app/api/transactions/[id]/history/route";
import { POST as settleMonth } from "@/app/api/settlements/[month]/settle/route";
import { POST as reopenMonth } from "@/app/api/settlements/[month]/reopen/route";
import { GET as getSettlementHistory } from "@/app/api/settlements/[month]/history/route";
import { getMonthSummary } from "@/lib/summary";
import { createCategory, prisma, resetDatabase, routeContext } from "./helpers";

const MONTH = "2024-03";

function createRequest(categoryId: string, key: string, amount = "12.34") {
  return new Request("http://localhost/api/transactions", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ type: "expense", amount, categoryId, occurredOn: `${MONTH}-10` }),
  });
}

beforeEach(resetDatabase);

describe("transaction creation retries", () => {
  it("serializes concurrent retries and replays the original response without duplicate ledger rows", async () => {
    const category = await createCategory();
    const responses = await Promise.all([
      createTransaction(createRequest(category.id, "retry-ledger-0001")),
      createTransaction(createRequest(category.id, "retry-ledger-0001")),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses.map((response) => response.headers.get("Idempotent-Replay")).sort()).toEqual(["false", "true"]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await prisma.transactionHistory.count()).toBe(1);
    expect(await prisma.creationRequest.count()).toBe(1);

    const conflict = await createTransaction(createRequest(category.id, "retry-ledger-0001", "99"));
    expect(conflict.status).toBe(409);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("retains an acknowledged creation result across later edits and settlement", async () => {
    const category = await createCategory();
    const created = await (await createTransaction(createRequest(category.id, "retry-ledger-0002"))).json();
    const id = created.transaction.id as string;
    const edited = await patchTransaction(new Request(`http://localhost/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "expense", amount: "12.34", categoryId: category.id, occurredOn: `${MONTH}-10`, note: "补充说明", expectedVersion: 1 }),
    }), routeContext({ id }));
    expect(edited.status).toBe(200);
    expect((await settleMonth(new Request("http://localhost", { method: "POST" }), routeContext({ month: MONTH }))).status).toBe(200);
    const replayed = await createTransaction(createRequest(category.id, "retry-ledger-0002"));
    expect(replayed.status).toBe(201);
    expect(await replayed.json()).toEqual(created);
    expect(await prisma.transaction.count()).toBe(1);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id } })).version).toBe(2);
  });

  it("does not retain a key when the ledger creation transaction fails", async () => {
    const failed = await createTransaction(createRequest("missing-category", "retry-ledger-0003"));
    expect(failed.status).toBe(400);
    expect(await prisma.creationRequest.count()).toBe(0);
    expect(await prisma.transactionHistory.count()).toBe(0);
    const category = await createCategory();
    expect((await createTransaction(createRequest(category.id, "retry-ledger-0003"))).status).toBe(201);
  });
});

describe("immutable ledger history", () => {
  it("keeps category labels and values at each acknowledged transaction version", async () => {
    const category = await createCategory();
    const created = await (await createTransaction(createRequest(category.id, "audit-ledger-0001"))).json();
    const id = created.transaction.id as string;
    await prisma.category.update({ where: { id: category.id }, data: { name: "餐饮新名称" } });
    const edited = await patchTransaction(new Request(`http://localhost/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "expense", amount: "20", categoryId: category.id, occurredOn: `${MONTH}-10`, expectedVersion: 1 }),
    }), routeContext({ id }));
    expect(edited.status).toBe(200);
    const history = await (await getTransactionHistory(new Request("http://localhost"), routeContext({ id }))).json();
    expect(history.history).toMatchObject([
      { version: 2, action: "edit", before: { amountCents: 1234 }, after: { amountCents: 2000, categoryName: "餐饮新名称" } },
      { version: 1, action: "create", before: null, after: { amountCents: 1234, categoryName: "餐饮" } },
    ]);
  });

  it("preserves close and reopen revisions and freezes captured category names", async () => {
    const category = await createCategory();
    await createTransaction(createRequest(category.id, "audit-ledger-0002"));
    const context = routeContext({ month: MONTH });
    const first = await (await settleMonth(new Request("http://localhost", { method: "POST" }), context)).json();
    expect(first.settlement.revision).toBe(1);
    await prisma.category.update({ where: { id: category.id }, data: { name: "餐饮新名称" } });
    expect((await getMonthSummary(MONTH)).topCategory?.name).toBe("餐饮");
    expect((await (await settleMonth(new Request("http://localhost", { method: "POST" }), context)).json()).settlement.revision).toBe(1);
    expect((await reopenMonth(new Request("http://localhost", { method: "POST" }), context)).status).toBe(200);
    const third = await (await settleMonth(new Request("http://localhost", { method: "POST" }), context)).json();
    expect(third.settlement.revision).toBe(3);
    expect(third.settlement.categorySnapshot).toMatchObject([{ categoryName: "餐饮新名称", expenseCents: 1234, outOfPocketCents: 1234 }]);
    const history = await (await getSettlementHistory(new Request("http://localhost"), context)).json();
    expect(history.history).toMatchObject([
      { revision: 3, action: "settle", snapshot: { categorySnapshot: [{ categoryName: "餐饮新名称" }] } },
      { revision: 2, action: "reopen", snapshot: { categorySnapshot: [{ categoryName: "餐饮" }] } },
      { revision: 1, action: "settle", snapshot: { categorySnapshot: [{ categoryName: "餐饮" }] } },
    ]);
  });
});
