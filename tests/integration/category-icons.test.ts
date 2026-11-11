import { beforeEach, describe, expect, it } from "vitest";
import { GET as listCategories, POST as createCategory } from "@/app/api/categories/route";
import { PATCH as updateCategory } from "@/app/api/categories/[id]/route";
import { GET as exportLedger } from "@/app/api/export/route";
import { POST as importLedger } from "@/app/api/import/route";
import { GET as listTransactions } from "@/app/api/transactions/route";
import { GET as listSubscriptions } from "@/app/api/subscriptions/route";
import { addTransaction, prisma, resetDatabase, routeContext } from "./helpers";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(resetDatabase);

describe("category icon persistence", () => {
  it("creates and lists a chosen icon and exposes it on related entries", async () => {
    const response = await createCategory(jsonRequest("/api/categories", "POST", { name: "Coffee", type: "expense", icon: "coffee" }));
    expect(response.status).toBe(201);
    const { category } = await response.json();
    expect(category.icon).toBe("coffee");
    expect(await prisma.category.findUniqueOrThrow({ where: { id: category.id } })).toMatchObject({ icon: "coffee" });
    expect((await (await listCategories()).json()).categories).toContainEqual(expect.objectContaining({ id: category.id, icon: "coffee" }));

    await addTransaction({ categoryId: category.id, date: "2024-03-10", amountCents: 900 });
    await prisma.subscription.create({ data: { name: "Coffee plan", categoryId: category.id, amountCents: 900, billingDay: 10, startMonth: new Date("2024-03-01T00:00:00Z") } });
    const transactions = await (await listTransactions(new Request("http://localhost/api/transactions?month=2024-03"))).json();
    const subscriptions = await (await listSubscriptions()).json();
    expect(transactions.transactions[0].category.icon).toBe("coffee");
    expect(subscriptions.subscriptions[0].category.icon).toBe("coffee");
  });

  it("leaves old clients on automatic icons and supports changing or clearing a choice", async () => {
    const response = await createCategory(jsonRequest("/api/categories", "POST", { name: "Legacy" }));
    const { category } = await response.json();
    expect(category.icon).toBeNull();
    for (const icon of ["leaf", null]) {
      const updated = await updateCategory(jsonRequest(`/api/categories/${category.id}`, "PATCH", { icon }), routeContext({ id: category.id }));
      expect(updated.status).toBe(200);
      expect((await updated.json()).category.icon).toBe(icon);
    }
  });

  it("rejects invalid icons before writing anything", async () => {
    const response = await createCategory(jsonRequest("/api/categories", "POST", { name: "Invalid", icon: "unknown" }));
    expect(response.status).toBe(400);
    expect(await prisma.category.count()).toBe(0);
  });
});

describe("category icon backups", () => {
  it("round-trips icons through JSON exports and merges them by the natural key", async () => {
    const category = await prisma.category.create({ data: { name: "Coffee", icon: "coffee" } });
    const exported = await exportLedger(new Request("http://localhost/api/export?format=json"));
    const backup = await exported.json();
    expect(backup.categories).toContainEqual(expect.objectContaining({ id: category.id, icon: "coffee" }));

    await resetDatabase();
    const localCategory = await prisma.category.create({ data: { name: "Coffee", icon: "leaf" } });
    const restored = await importLedger(jsonRequest("/api/import", "POST", { format: "json", rows: backup.transactions, backup }));
    expect(restored.status).toBe(200);
    const restoredCategory = await prisma.category.findFirstOrThrow({ where: { name: "Coffee" } });
    expect(restoredCategory.id).toBe(localCategory.id);
    expect(restoredCategory.id).not.toBe(category.id);
    expect(restoredCategory.icon).toBe("coffee");

    await prisma.category.update({ where: { id: restoredCategory.id }, data: { icon: "leaf" } });
    const merged = await importLedger(jsonRequest("/api/import", "POST", { format: "json", rows: [], backup }));
    expect(merged.status).toBe(200);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: restoredCategory.id } })).icon).toBe("coffee");
    expect(await prisma.category.count({ where: { name: "Coffee" } })).toBe(1);
  });

  it("accepts old backups without erasing existing icon choices", async () => {
    const category = await prisma.category.create({ data: { name: "Existing", icon: "leaf" } });
    const response = await importLedger(jsonRequest("/api/import", "POST", {
      format: "json", rows: [], backup: { version: 1, categories: [{ id: "legacy-id", name: "Existing", type: "EXPENSE" }, { id: "new-id", name: "Legacy new", type: "EXPENSE" }] },
    }));
    expect(response.status).toBe(200);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: category.id } })).icon).toBe("leaf");
    expect((await prisma.category.findFirstOrThrow({ where: { name: "Legacy new" } })).icon).toBeNull();
  });

  it("restores an explicit automatic choice and keeps the CSV columns compatible", async () => {
    const category = await prisma.category.create({ data: { name: "Automatic", icon: "coffee" } });
    const response = await importLedger(jsonRequest("/api/import", "POST", {
      format: "json", rows: [], backup: { version: 1, categories: [{ id: "backup-id", name: "Automatic", type: "EXPENSE", icon: null }] },
    }));
    expect(response.status).toBe(200);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: category.id } })).icon).toBeNull();
    const csv = await exportLedger(new Request("http://localhost/api/export?format=csv"));
    expect((await csv.text()).replace(/^\uFEFF/, "").split(/\r?\n/)[0]).toBe('"日期","类型","金额","分类","备注","来源","报销时间","__rhodium_csv_encoding"');
  });
});
