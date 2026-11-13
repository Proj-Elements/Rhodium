import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    monthlyBudget: { findMany: vi.fn() },
    subscription: { findMany: vi.fn() },
    monthlySettlement: { findMany: vi.fn() },
    budgetPreset: { findUnique: vi.fn() },
    transactionHistory: { findMany: vi.fn() },
    settlementHistory: { findMany: vi.fn() },
    creationRequest: { findMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);
  vi.mocked(prisma.category.findMany).mockResolvedValue([]);
  vi.mocked(prisma.monthlyBudget.findMany).mockResolvedValue([]);
  vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);
  vi.mocked(prisma.monthlySettlement.findMany).mockResolvedValue([]);
  vi.mocked(prisma.budgetPreset.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.transactionHistory.findMany).mockResolvedValue([]);
  vi.mocked(prisma.settlementHistory.findMany).mockResolvedValue([]);
  vi.mocked(prisma.creationRequest.findMany).mockResolvedValue([]);
  vi.mocked(prisma.$executeRaw).mockResolvedValue(0);
  vi.mocked(prisma.$transaction).mockImplementation(async (work) => {
    if (typeof work !== "function") throw new Error("Expected a snapshot transaction");
    return work(prisma);
  });
});

describe("Rhodium export filenames", () => {
  it("names the JSON backup without changing its import-compatible format", async () => {
    const response = await GET(new Request("http://localhost/api/export?format=json"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="rhodium-backup.json"');
    expect(await response.json()).toMatchObject({
      version: 2,
      categories: [],
      transactions: [],
      budgets: [],
      subscriptions: [],
      settlements: [],
      transactionHistory: [],
      settlementHistory: [],
      creationRequests: [],
    });
  });

  it("names the CSV export while preserving the existing columns", async () => {
    const response = await GET(new Request("http://localhost/api/export?format=csv"));
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="rhodium-transactions.csv"');
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(await response.text()).toBe('"日期","类型","金额","分类","备注","来源","报销时间","__rhodium_csv_encoding"');
    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.monthlyBudget.findMany).not.toHaveBeenCalled();
    expect(prisma.budgetPreset.findUnique).not.toHaveBeenCalled();
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
    expect(prisma.monthlySettlement.findMany).not.toHaveBeenCalled();
    expect(prisma.transactionHistory.findMany).not.toHaveBeenCalled();
    expect(prisma.settlementHistory.findMany).not.toHaveBeenCalled();
    expect(prisma.creationRequest.findMany).not.toHaveBeenCalled();
  });

  it("reads large JSON tables in bounded pages and includes the last page", async () => {
    const row = (index: number) => ({ id: `row-${String(index).padStart(4, "0")}`, type: "EXPENSE", amountCents: index,
      categoryId: "category", occurredOn: new Date("2024-05-01"), source: "MANUAL", note: null,
      subscriptionId: null, subscriptionMonth: null, subscriptionOccurrenceKey: null, deletedAt: null, reimbursedAt: null, version: 1 });
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => row(index)) as never)
      .mockResolvedValueOnce([row(500)] as never);
    const response = await GET(new Request("http://localhost/api/export?format=json"));
    expect(response.status).toBe(200);
    const backup = await response.json();
    expect(backup.transactions).toHaveLength(501);
    expect(backup.transactions.at(-1)).toMatchObject({ id: "row-0500", occurredOn: "2024-05-01" });
    expect(prisma.transaction.findMany).toHaveBeenCalledTimes(2);
    for (const [query] of vi.mocked(prisma.transaction.findMany).mock.calls) expect(query?.take).toBe(500);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
  });
});
