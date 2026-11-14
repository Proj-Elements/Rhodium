import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createTransaction } from "@/app/api/transactions/route";
import { PATCH as patchTransaction, DELETE as deleteTransaction } from "@/app/api/transactions/[id]/route";
import { POST as importLedger } from "@/app/api/import/route";
import { PUT as putBudget } from "@/app/api/budgets/[month]/route";
import { POST as settleMonth } from "@/app/api/settlements/[month]/settle/route";
import { POST as createSubscription } from "@/app/api/subscriptions/route";
import { DELETE as deleteSubscription, PATCH as patchSubscription } from "@/app/api/subscriptions/[id]/route";
import { monthStart, todayInShanghai } from "@/lib/domain";
import { getMonthSummary } from "@/lib/summary";
import { subscriptionPlanData, syncSubscriptions } from "@/lib/subscriptions";
import { initialBillingHistory } from "@/lib/billing-history";
import { budgetVersion } from "@/lib/budget-version";
import { authenticatedHeaders, addTransaction, createCategory, prisma, resetDatabase, routeContext } from "./helpers";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type QueryNext = (params: Prisma.MiddlewareParams) => Promise<unknown>;
let intercept: ((params: Prisma.MiddlewareParams, next: QueryNext) => Promise<unknown>) | null = null;
let lockAttempt: ReturnType<typeof deferred> | null = null;

// Observe real connection operations, without substituting an in-memory mutex.
prisma.$use(async (params, next) => {
  if (params.action === "queryRaw" && String(params.args?.[0]).includes("pg_advisory_xact_lock")) lockAttempt?.resolve();
  return intercept ? intercept(params, next) : next(params);
});

beforeEach(async () => {
  intercept = null;
  lockAttempt = null;
  await resetDatabase();
});

afterEach(() => {
  intercept = null;
  lockAttempt = null;
  vi.restoreAllMocks();
});

function request(path: string, method: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { headers: authenticatedHeaders(), body: JSON.stringify(body) }),
  });
}

/** Fixed writers wait at the DB lock; old writers can finish inside the gap. */
async function releaseWhenContenderStarts(contender: Promise<unknown>, release: () => void) {
  try {
    await Promise.race([contender, lockAttempt!.promise]);
  } finally {
    release();
  }
}

describe("ledger write serialization", () => {
  it("settles a writer that already passed its unlocked check as one coherent snapshot", async () => {
    const category = await createCategory();
    const paused = deferred();
    const resume = deferred();
    intercept = async (params, next) => {
      if (params.model === "Transaction" && params.action === "create") {
        paused.resolve();
        await resume.promise;
      }
      return next(params);
    };
    const writing = createTransaction(request("/api/transactions", "POST", {
      type: "expense", amount: "10", occurredOn: "2024-05-10", categoryId: category.id,
    }));
    await paused.promise;
    lockAttempt = deferred();
    const settling = settleMonth(request("/api/settlements/2024-05/settle", "POST"), routeContext({ month: "2024-05" }));
    await releaseWhenContenderStarts(settling, resume.resolve);
    const [writeResponse, settleResponse] = await Promise.all([writing, settling]);
    expect(writeResponse.status).toBe(201);
    expect(settleResponse.status).toBe(200);
    const summary = await getMonthSummary("2024-05");
    expect(summary.expenseCents).toBe(1_000);
    expect(summary.dailyBreakdown.reduce((sum, day) => sum + day.expenseCents, 0)).toBe(summary.expenseCents);
  });

  it.each(["create", "edit", "move", "delete", "restore", "reimburse", "unreimburse", "import", "budget"])(
    "rejects %s after a settlement wins the database lock",
    async (operation) => {
      const category = await createCategory();
      const row = await addTransaction({ categoryId: category.id, date: "2024-05-10", amountCents: 1000 });
      if (operation === "restore") await prisma.transaction.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      if (operation === "unreimburse") await prisma.transaction.update({ where: { id: row.id }, data: { reimbursedAt: new Date() } });
      const original = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      const observedBudgetVersion = await budgetVersion(prisma, "2024-05");
      const paused = deferred();
      const resume = deferred();
      intercept = async (params, next) => {
        if (params.model === "MonthlySettlement" && params.action === "upsert") {
          paused.resolve();
          await resume.promise;
        }
        return next(params);
      };
      const settling = settleMonth(request("/api/settlements/2024-05/settle", "POST"), routeContext({ month: "2024-05" }));
      await paused.promise;
      lockAttempt = deferred();
      const body = { type: "expense", amount: "20", occurredOn: operation === "move" ? "2024-06-10" : "2024-05-10", categoryId: category.id };
      const writing = operation === "create"
        ? createTransaction(request("/api/transactions", "POST", body))
        : operation === "delete"
          ? deleteTransaction(request(`/api/transactions/${row.id}?expectedVersion=${original.version}`, "DELETE"), routeContext({ id: row.id }))
          : operation === "import"
            ? importLedger(request("/api/import", "POST", { format: "json", rows: [body] }))
            : operation === "budget"
              ? putBudget(request("/api/budgets/2024-05", "PUT", { amount: "20", expectedVersion: observedBudgetVersion }), routeContext({ month: "2024-05" }))
              : patchTransaction(request(`/api/transactions/${row.id}`, "PATCH",
                ["restore", "reimburse", "unreimburse"].includes(operation)
                  ? { [operation]: true, expectedVersion: original.version }
                  : { ...body, expectedVersion: original.version }), routeContext({ id: row.id }));
      await releaseWhenContenderStarts(writing, resume.resolve);
      const [settled, rejected] = await Promise.all([settling, writing]);
      expect(settled.status).toBe(200);
      expect(rejected.status).toBe(409);
      expect(await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).toEqual(original);
      expect(await prisma.transaction.count()).toBe(1);
      expect(await prisma.monthlyBudget.count()).toBe(0);
    },
  );

  it("includes a reimbursement that wins the lock in the settled budget snapshot", async () => {
    const category = await createCategory();
    const row = await addTransaction({ categoryId: category.id, date: "2024-05-10", amountCents: 1000 });
    await prisma.budgetPreset.create({ data: { id: 1, amountCents: 5000 } });
    const paused = deferred();
    const resume = deferred();
    intercept = async (params, next) => {
      if (params.model === "Transaction" && params.action === "update") {
        paused.resolve();
        await resume.promise;
      }
      return next(params);
    };
    const writing = patchTransaction(request(`/api/transactions/${row.id}`, "PATCH", { reimburse: true, expectedVersion: row.version }), routeContext({ id: row.id }));
    await paused.promise;
    lockAttempt = deferred();
    const settling = settleMonth(request("/api/settlements/2024-05/settle", "POST"), routeContext({ month: "2024-05" }));
    await releaseWhenContenderStarts(settling, resume.resolve);
    const [reimbursed, settled] = await Promise.all([writing, settling]);
    expect(reimbursed.status).toBe(200);
    expect(settled.status).toBe(200);
    expect(await getMonthSummary("2024-05")).toMatchObject({ expenseCents: 1000, outOfPocketCents: 0, remainingCents: 5000 });
  });

  it("finishes an active sync before a pause can report success", async () => {
    const category = await createCategory();
    const month = todayInShanghai().slice(0, 7);
    const subscriptionData = {
      name: "网盘", categoryId: category.id, amountCents: 1_000, billingDay: 1, startMonth: monthStart(month), endMonth: null, note: null,
    };
    const subscription = await prisma.subscription.create({ data: {
      ...subscriptionData, billingHistory: initialBillingHistory(subscriptionPlanData(subscriptionData)),
    } });
    const paused = deferred();
    const resume = deferred();
    const events: string[] = [];
    let gated = false;
    intercept = async (params, next) => {
      if (!gated && params.model === "Transaction" && params.action === "createMany") {
        gated = true;
        paused.resolve();
        await resume.promise;
        const result = await next(params);
        events.push("occurrence-written");
        return result;
      }
      return next(params);
    };
    const syncing = syncSubscriptions();
    await paused.promise;
    lockAttempt = deferred();
    const pausing = patchSubscription(request(`/api/subscriptions/${subscription.id}`, "PATCH", { active: false, expectedVersion: subscription.version }), routeContext({ id: subscription.id }))
      .then((response) => { events.push("pause-returned"); return response; });
    await releaseWhenContenderStarts(pausing, resume.resolve);
    const [, response] = await Promise.all([syncing, pausing]);
    expect(response.status).toBe(200);
    expect(events).toEqual(["occurrence-written", "pause-returned"]);
    expect(await prisma.transaction.count()).toBe(1);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).active).toBe(false);
  });

  it("does not detach a new occurrence between subscription usage-count and delete", async () => {
    const category = await createCategory();
    const month = todayInShanghai().slice(0, 7);
    const subscriptionData = {
      name: "音乐", categoryId: category.id, amountCents: 1_000, billingDay: 1, startMonth: monthStart(month), endMonth: null, note: null,
    };
    const subscription = await prisma.subscription.create({ data: {
      ...subscriptionData, billingHistory: initialBillingHistory(subscriptionPlanData(subscriptionData)),
    } });
    const paused = deferred();
    const resume = deferred();
    intercept = async (params, next) => {
      const result = await next(params);
      if (params.model === "Transaction" && params.action === "count") {
        paused.resolve();
        await resume.promise;
      }
      return result;
    };
    const deleting = deleteSubscription(request(`/api/subscriptions/${subscription.id}?expectedVersion=${subscription.version}`, "DELETE"), routeContext({ id: subscription.id }));
    await paused.promise;
    lockAttempt = deferred();
    const syncing = syncSubscriptions();
    await releaseWhenContenderStarts(syncing, resume.resolve);
    const [response] = await Promise.all([deleting, syncing]);
    expect(response.status).toBe(200);
    expect(await prisma.transaction.count({ where: { source: "SUBSCRIPTION", subscriptionId: null } })).toBe(0);
  });

  it("rolls back subscription creation when its occurrence write fails, so retry creates only one plan", async () => {
    const category = await createCategory();
    let failOnce = true;
    intercept = async (params, next) => {
      if (failOnce && params.model === "Transaction" && params.action === "createMany") {
        failOnce = false;
        throw new Error("injected occurrence failure");
      }
      return next(params);
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = { name: "云盘", amount: "10", categoryId: category.id, billingDay: 1, startMonth: todayInShanghai().slice(0, 7) };
    const failed = await createSubscription(request("/api/subscriptions", "POST", body));
    expect(failed.status).toBe(500);
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
    const retried = await createSubscription(request("/api/subscriptions", "POST", body));
    expect(retried.status).toBe(201);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("rejects cumulative snapshot overflow without writing a partial settlement", async () => {
    const category = await createCategory();
    await addTransaction({ categoryId: category.id, date: "2024-05-01", amountCents: 1_200_000_000 });
    await addTransaction({ categoryId: category.id, date: "2024-05-02", amountCents: 1_200_000_000 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await settleMonth(request("/api/settlements/2024-05/settle", "POST"), routeContext({ month: "2024-05" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("结算");
    expect(await prisma.monthlySettlement.count()).toBe(0);
  });
});
