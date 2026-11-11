import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * `PUT /api/budgets/[month]?scope=future` used to issue an unbounded
 * `updateMany({ month: { gte } })`, which silently rewrote every future budget the
 * user had already set, and it ignored settled months whose amount is frozen inside
 * MonthlySettlement. These tests pin the bounded horizon and the settled-month
 * exclusion; Prisma is mocked, so no database is involved.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monthlyBudget: { createMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn() },
    monthlySettlement: { findUnique: vi.fn(), findMany: vi.fn() },
    budgetPreset: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

const { prisma } = await import("@/lib/prisma");
const { GET, PUT } = await import("@/app/api/budgets/[month]/route");

const createMany = prisma.monthlyBudget.createMany as unknown as Mock;
const updateMany = prisma.monthlyBudget.updateMany as unknown as Mock;
const upsert = prisma.monthlyBudget.upsert as unknown as Mock;
const findSettlement = prisma.monthlySettlement.findUnique as unknown as Mock;
const findSettlements = prisma.monthlySettlement.findMany as unknown as Mock;
const transaction = prisma.$transaction as unknown as Mock;

const HORIZON_MONTHS = 240;

function put(month: string, scope?: string, amount = "1500.00") {
  const query = scope ? `?scope=${scope}` : "";
  const request = new Request(`http://localhost/api/budgets/${month}${query}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  return PUT(request, { params: Promise.resolve({ month }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  findSettlement.mockResolvedValue(null);
  findSettlements.mockResolvedValue([]);
  createMany.mockReturnValue({ count: 0 });
  updateMany.mockReturnValue({ count: 0 });
  upsert.mockResolvedValue({ amountCents: 150_000 });
  vi.mocked(prisma.monthlyBudget.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.budgetPreset.findUnique).mockResolvedValue(null);
  transaction.mockImplementation(async (work) => work(prisma));
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ locked: 1 }]);
  vi.mocked(prisma.$executeRaw).mockResolvedValue(0);
});

describe("GET /api/budgets/[month]", () => {
  it("returns the captured budget for a settled month even after the preset changes", async () => {
    vi.mocked(prisma.budgetPreset.findUnique).mockResolvedValue({ id: 1, amountCents: 300_000 } as never);
    findSettlement.mockResolvedValue({ reopenedAt: null, remainingAmountCents: 150_000, budgetAmountCents: 200_000 });

    const response = await GET(new Request("http://localhost/api/budgets/2026-03"), { params: Promise.resolve({ month: "2026-03" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      budget: { amountCents: 200_000 },
      preset: { amountCents: 300_000 },
      effectiveBudgetCents: 200_000,
      source: "settlement",
      locked: true,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("PUT /api/budgets/[month]", () => {
  it("writes a single explicit row for the default scope", async () => {
    const response = await put("2026-03");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ budget: { amountCents: 150_000 }, scope: "month" });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].where.month.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(createMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("materialises a bounded horizon for scope=future instead of every later month", async () => {
    const response = await put("2026-03", "future");

    await expect(response.json()).resolves.toEqual({
      budget: { amountCents: 150_000 },
      scope: "future",
      monthsSet: HORIZON_MONTHS,
      throughMonth: "2046-02",
    });

    const rows = createMany.mock.calls[0][0].data as { month: Date; amountCents: number }[];
    expect(rows).toHaveLength(HORIZON_MONTHS);
    expect(rows[0].month.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(rows[HORIZON_MONTHS - 1].month.toISOString()).toBe("2046-02-01T00:00:00.000Z");
    expect(new Set(rows.map((r) => r.amountCents))).toEqual(new Set([150_000]));

    // The upper bound is what keeps months past the horizon untouched.
    const where = updateMany.mock.calls[0][0].where as { month: { gte: Date; lte: Date } };
    expect(where.month.gte.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(where.month.lte.toISOString()).toBe("2046-02-01T00:00:00.000Z");
  });

  it("leaves settled months inside the horizon alone", async () => {
    const settledMonth = new Date("2026-05-01T00:00:00.000Z");
    findSettlements.mockResolvedValue([{ month: settledMonth }]);

    const response = await put("2026-03", "future");

    await expect(response.json()).resolves.toMatchObject({ monthsSet: HORIZON_MONTHS - 1 });
    const rows = createMany.mock.calls[0][0].data as { month: Date }[];
    expect(rows.some((r) => r.month.toISOString() === settledMonth.toISOString())).toBe(false);
    const where = updateMany.mock.calls[0][0].where as { month: { notIn: Date[] } };
    expect(where.month.notIn).toEqual([settledMonth]);
  });

  it("runs the future writes in one transaction", async () => {
    await put("2026-03", "future");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(createMany.mock.invocationCallOrder[0]);
    expect(createMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("refuses to rewrite a settled month", async () => {
    findSettlement.mockResolvedValue({ reopenedAt: null });

    const response = await put("2026-03");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "本月已经结算，请先重新打开本月" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("allows a reopened month to be rewritten", async () => {
    findSettlement.mockResolvedValue({ reopenedAt: new Date("2026-03-20T00:00:00.000Z") });

    const response = await put("2026-03");

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown scope and a malformed month", async () => {
    await expect(put("2026-03", "everything").then((r) => r.status)).resolves.toBe(400);
    await expect(put("2026-3").then((r) => r.status)).resolves.toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric amount", async () => {
    const response = await put("2026-03", undefined, "一千五");

    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
