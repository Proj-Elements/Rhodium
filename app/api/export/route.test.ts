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
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);
  vi.mocked(prisma.category.findMany).mockResolvedValue([]);
  vi.mocked(prisma.monthlyBudget.findMany).mockResolvedValue([]);
  vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);
  vi.mocked(prisma.monthlySettlement.findMany).mockResolvedValue([]);
});

describe("Rhodium export filenames", () => {
  it("names the JSON backup without changing its import-compatible format", async () => {
    const response = await GET(new Request("http://localhost/api/export?format=json"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="rhodium-backup.json"');
    expect(await response.json()).toMatchObject({
      version: 1,
      categories: [],
      transactions: [],
      budgets: [],
      subscriptions: [],
      settlements: [],
    });
  });

  it("names the CSV export while preserving the existing columns", async () => {
    const response = await GET(new Request("http://localhost/api/export?format=csv"));
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="rhodium-transactions.csv"');
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(await response.text()).toBe('"日期","类型","金额","分类","备注","来源"');
  });
});
