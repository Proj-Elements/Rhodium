import { beforeEach, describe, expect, it } from "vitest";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as revision } from "@/app/api/revision/route";
import { POST as create } from "@/app/api/transactions/route";
import { PATCH as patch, DELETE as remove } from "@/app/api/transactions/[id]/route";
import { PUT as budget } from "@/app/api/budgets/[month]/route";
import { GET as transactions } from "@/app/api/transactions/route";
import { GET as transactionHistory } from "@/app/api/transactions/[id]/history/route";
import { PATCH as patchCategory } from "@/app/api/categories/[id]/route";
import { PATCH as patchSubscription, DELETE as removeSubscription } from "@/app/api/subscriptions/[id]/route";
import { getMonthSummary, getMonthSummaries } from "@/lib/summary";
import { withLedgerWrite } from "@/lib/ledger-write";
import { createCategory, prisma, resetDatabase, routeContext } from "./helpers";

const request = (path: string, method = "GET", body?: unknown) => new Request(`http://localhost${path}`, {
  method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});
const observedRevision = async () => BigInt((await (await revision()).json()).revision);
beforeEach(resetDatabase);

describe("risk hardening regressions", () => {
  it.each(["q", "categoryId", "cursor"])("rejects NUL in %s before querying PostgreSQL", async (key) => {
    expect((await transactions(request(`/api/transactions?${key}=%00`))).status).toBe(400);
  });
  it("rejects invalid text in resource identifiers on every ID-based route", async () => {
    const id = "invalid\u0000id";
    const context = routeContext({ id });
    expect((await patch(request("/api/transactions/id", "PATCH", { reimburse: true, expectedVersion: 1 }), context)).status).toBe(400);
    expect((await remove(request("/api/transactions/id?expectedVersion=1", "DELETE"), context)).status).toBe(400);
    expect((await transactionHistory(request("/api/transactions/id/history"), context)).status).toBe(400);
    expect((await patchCategory(request("/api/categories/id", "PATCH", { archived: true, expectedVersion: 1 }), context)).status).toBe(400);
    expect((await patchSubscription(request("/api/subscriptions/id", "PATCH", { active: false, expectedVersion: 1 }), context)).status).toBe(400);
    expect((await removeSubscription(request("/api/subscriptions/id?expectedVersion=1", "DELETE"), context)).status).toBe(400);
  });
  it("can query the final supported month without passing year 10000 to Prisma", async () => {
    const category = await createCategory("末日边界");
    const created = await create(request("/api/transactions", "POST", { type: "expense", amount: "12.34", occurredOn: "9999-12-31", categoryId: category.id }));
    expect(created.status).toBe(201);
    const list = await transactions(request("/api/transactions?month=9999-12"));
    expect(list.status).toBe(200);
    expect((await list.json()).transactions).toHaveLength(1);
    expect((await dashboard(request("/api/dashboard?month=9999-12"))).status).toBe(200);
    expect(await getMonthSummary("9999-12")).toMatchObject({ expenseCents: 1234 });
    expect((await getMonthSummaries(["9999-11", "9999-12"]))[1]).toMatchObject({ expenseCents: 1234 });
  });
  it("supplies a usable budget version on the dashboard and rejects its stale replay", async () => {
    const month = "2024-05";
    const before = await (await dashboard(request(`/api/dashboard?month=${month}`))).json();
    expect(before.budgetVersion).toMatch(/^[a-f0-9]{64}$/);
    const body = { amount: "2000", expectedVersion: before.budgetVersion };
    expect((await budget(request(`/api/budgets/${month}`, "PUT", body), routeContext({ month }))).status).toBe(200);
    expect((await budget(request(`/api/budgets/${month}`, "PUT", body), routeContext({ month }))).status).toBe(409);
  });

  it("advances the externally visible revision on commit, but never on rollback", async () => {
    const initial = await observedRevision();
    await withLedgerWrite((tx) => tx.category.create({ data: { name: "commit" } }));
    const committed = await observedRevision();
    expect(committed).toBeGreaterThan(initial);
    await expect(withLedgerWrite(async (tx) => {
      await tx.category.create({ data: { name: "rollback" } });
      throw new Error("injected rollback");
    })).rejects.toThrow("injected rollback");
    expect(await observedRevision()).toBe(committed);
    expect(await prisma.category.count({ where: { name: "rollback" } })).toBe(0);
  });

  it("keeps summaries coherent through 100 deterministic mixed lifecycle operations", async () => {
    const category = await createCategory("随机生命周期");
    type Row = { id: string; version: number; amountCents: number; deletedAt: string | null; reimbursedAt: string | null };
    const rows: Row[] = [];
    let seed = 0x9361;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let index = 0; index < 100; index++) {
      const row = rows.length ? rows[random() % rows.length] : undefined;
      let response: Response;
      if (!row || index % 4 === 0) {
        const cents = random() % 100_000;
        response = await create(request("/api/transactions", "POST", { type: "expense", amount: (cents / 100).toFixed(2), occurredOn: "2024-05-12", categoryId: category.id, note: `=测试,\"${index}\"\n下一行` }));
        expect(response.status).toBe(201);
        rows.push((await response.json()).transaction);
      } else {
        const context = routeContext({ id: row.id });
        if (row.deletedAt) response = await patch(request(`/api/transactions/${row.id}`, "PATCH", { restore: true, expectedVersion: row.version }), context);
        else if (index % 3 === 0) response = await remove(request(`/api/transactions/${row.id}?expectedVersion=${row.version}`, "DELETE"), context);
        else response = await patch(request(`/api/transactions/${row.id}`, "PATCH", { [row.reimbursedAt ? "unreimburse" : "reimburse"]: true, expectedVersion: row.version }), context);
        expect(response.status).toBe(200);
        const updated = (await response.json()).transaction;
        Object.assign(row, updated);
      }
      if (index % 10 === 9) {
        const result = await (await dashboard(request("/api/dashboard?month=2024-05"))).json();
        const active = rows.filter((item) => !item.deletedAt);
        expect(result.expenseCents).toBe(active.reduce((sum, item) => sum + item.amountCents, 0));
        expect(result.outOfPocketCents).toBe(active.filter((item) => !item.reimbursedAt).reduce((sum, item) => sum + item.amountCents, 0));
        expect(result.expenseCents).toBe(result.outOfPocketCents + result.reimbursedCents);
        expect(result.transactionCount).toBe(active.length);
      }
    }
    for (const row of rows) {
      const history = await prisma.transactionHistory.findMany({ where: { transactionId: row.id }, orderBy: { version: "asc" } });
      expect(history.map((item) => item.version)).toEqual(Array.from({ length: row.version }, (_, index) => index + 1));
    }
  });
});
