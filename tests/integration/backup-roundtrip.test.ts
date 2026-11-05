import { beforeEach, describe, expect, it } from "vitest";
import { GET as exportLedger } from "@/app/api/export/route";
import { POST as importLedger } from "@/app/api/import/route";
import { monthStart, parseDateOnly } from "@/lib/domain";
import { prisma, resetDatabase } from "./helpers";

function importRequest(backup: Record<string, unknown>, rows: unknown[] = []) {
  return new Request("http://localhost/api/import", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ format: "json", rows, backup }),
  });
}

async function exportBackup() {
  const response = await exportLedger(new Request("http://localhost/api/export?format=json"));
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(resetDatabase);

describe("lossless JSON backup restore", () => {
  it.each([0, 150_000])("round-trips the default budget %i into an empty ledger", async (amountCents) => {
    await prisma.budgetPreset.create({ data: { id: 1, amountCents } });
    const backup = await exportBackup();
    expect(backup.budgetPreset).toEqual({ amountCents });
    await resetDatabase();
    expect((await importLedger(importRequest(backup, backup.transactions))).status).toBe(200);
    expect(await prisma.budgetPreset.findUnique({ where: { id: 1 } })).toMatchObject({ amountCents });
  });

  it("restores an absent preset but preserves it for legacy backups without the field", async () => {
    const backup = await exportBackup();
    expect(backup.budgetPreset).toBeNull();
    await prisma.budgetPreset.create({ data: { id: 1, amountCents: 50_000 } });
    expect((await importLedger(importRequest({ version: 1 }))).status).toBe(200);
    expect(await prisma.budgetPreset.findUnique({ where: { id: 1 } })).toMatchObject({ amountCents: 50_000 });
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.budgetPreset.findUnique({ where: { id: 1 } })).toBeNull();
  });

  it("preserves archived historical categories without reactivating them", async () => {
    const archivedAt = new Date("2024-06-01T00:00:00Z");
    const category = await prisma.category.create({ data: { name: "旧爱好", archivedAt, icon: "leaf" } });
    await prisma.transaction.create({ data: { type: "EXPENSE", categoryId: category.id, amountCents: 2300, occurredOn: parseDateOnly("2024-05-10") } });
    const backup = await exportBackup();
    await resetDatabase();
    expect((await importLedger(importRequest(backup, backup.transactions))).status).toBe(200);
    const restored = await prisma.transaction.findFirstOrThrow({ include: { category: true } });
    expect(restored.category).toMatchObject({ name: "旧爱好", icon: "leaf", archivedAt });
    expect(restored.amountCents).toBe(2300);
  });

  it("restores archive metadata when a seeded natural-key category already exists", async () => {
    const archivedAt = new Date("2024-06-01T00:00:00Z");
    await prisma.category.create({ data: { name: "餐饮", type: "EXPENSE", isSystem: true, archivedAt } });
    const backup = await exportBackup();
    await resetDatabase();
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.category.findUnique({ where: { name_type: { name: "餐饮", type: "EXPENSE" } } })).toMatchObject({ archivedAt });
  });

  it("keeps distinct same-name subscriptions and occurrences across repeated restore", async () => {
    const category = await prisma.category.create({ data: { name: "会员", type: "EXPENSE" } });
    for (const amountCents of [1000, 2000]) {
      const subscription = await prisma.subscription.create({ data: { name: "音乐会员", categoryId: category.id, amountCents, billingDay: 1, startMonth: monthStart("2024-05") } });
      await prisma.transaction.create({ data: {
        type: "EXPENSE", categoryId: category.id, amountCents, occurredOn: parseDateOnly("2024-05-01"),
        source: "SUBSCRIPTION", subscriptionId: subscription.id, subscriptionMonth: monthStart("2024-05"),
        subscriptionOccurrenceKey: `${subscription.id}:2024-05`,
      } });
    }
    const backup = await exportBackup();
    await resetDatabase();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await importLedger(importRequest(backup, backup.transactions))).status).toBe(200);
      expect(await prisma.subscription.count()).toBe(2);
      const rows = await prisma.transaction.findMany({ orderBy: { amountCents: "asc" }, include: { subscription: true } });
      expect(rows.map((row) => row.amountCents)).toEqual([1000, 2000]);
      expect(rows.map((row) => row.subscription?.amountCents)).toEqual([1000, 2000]);
      expect(new Set(rows.map((row) => row.subscriptionId)).size).toBe(2);
    }
  });

  it("does not overwrite an unrelated subscription merely because its name matches", async () => {
    const category = await prisma.category.create({ data: { name: "会员" } });
    const local = await prisma.subscription.create({ data: { name: "音乐会员", categoryId: category.id, amountCents: 9000, billingDay: 1, startMonth: monthStart("2024-05") } });
    const backup = { version: 1, subscriptions: [{ id: "foreign-subscription", name: "音乐会员", categoryId: category.id, amountCents: 1000, billingDay: 1, startMonth: "2024-05" }] };
    expect((await importLedger(importRequest(backup))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(2);
    expect(await prisma.subscription.findUnique({ where: { id: local.id } })).toMatchObject({ amountCents: 9000 });
  });

  it("rejects duplicate subscription correlation IDs before any writes", async () => {
    const category = await prisma.category.create({ data: { name: "会员" } });
    const row = { id: "duplicate", name: "音乐会员", categoryId: category.id, amountCents: 1000, billingDay: 1, startMonth: "2024-05" };
    expect((await importLedger(importRequest({ version: 1, subscriptions: [row, { ...row, amountCents: 2000 }] }))).status).toBe(400);
    expect(await prisma.subscription.count()).toBe(0);
  });
});
