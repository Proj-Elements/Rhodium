import { describe, expect, it } from "vitest";
import { backupSchema, importSchema, MAX_BACKUP_ROWS } from "@/lib/backup-validation";

const row = { id: "transaction", categoryId: "category", type: "EXPENSE", amountCents: 1, occurredOn: "2024-05-01" };

describe("recoverable backup contract", () => {
  it("accepts supported legacy and current versions and rejects unknown versions", () => {
    expect(backupSchema.safeParse({ version: 1 }).success).toBe(true);
    expect(backupSchema.safeParse({ version: 2 }).success).toBe(true);
    expect(backupSchema.safeParse({ version: 999 }).success).toBe(false);
  });

  it("takes the complete archive in a single envelope", () => {
    const result = importSchema.parse({ backup: { version: 2, transactions: [row] } });
    expect(result.rows).toEqual([row]);
    expect(result.format).toBe("json");
    expect(importSchema.safeParse({ rows: [{ ...row, amountCents: 2 }], backup: { version: 2, transactions: [row] } }).success).toBe(false);
  });

  it("restores more than twenty thousand rows while keeping append work bounded", () => {
    const rows = Array.from({ length: 20_001 }, (_, index) => ({ ...row, id: `row-${index}` }));
    expect(importSchema.safeParse({ backup: { version: 2, transactions: rows } }).success).toBe(true);
    expect(importSchema.safeParse({ format: "json", rows }).success).toBe(false);
    expect(backupSchema.safeParse({ transactions: Array.from({ length: MAX_BACKUP_ROWS + 1 }, () => null) }).success).toBe(false);
  });

  it("uses the same recoverable ceiling for metadata and accepts historical long notes", () => {
    const categories = Array.from({ length: 501 }, (_, index) => ({ id: `category-${index}`, name: `分类${index}`, type: "EXPENSE" }));
    expect(backupSchema.safeParse({ version: 2, categories, transactions: [{ ...row, note: "旧".repeat(201) }] }).success).toBe(true);
  });

  it("rejects malformed month keys, timestamp fields and duplicate identities", () => {
    expect(backupSchema.safeParse({ budgets: [{ month: "2024-05-02", amountCents: 1 }] }).success).toBe(false);
    expect(backupSchema.safeParse({ transactions: [{ ...row, subscriptionMonth: "2024-05-02" }] }).success).toBe(false);
    expect(backupSchema.safeParse({ transactions: [{ ...row, deletedAt: "2024-02-30T00:00:00.000Z" }] }).success).toBe(false);
    expect(backupSchema.safeParse({ transactions: [row, row] }).success).toBe(false);
    expect(backupSchema.safeParse({ subscriptions: [{ id: "s", name: "订阅", amountCents: 1, billingDay: 1, categoryId: "category", startMonth: "2024-05-31" }] }).success).toBe(false);
  });

  it("requires real JSON audit values with matching identity and version", () => {
    const history = { id: "history", transactionId: row.id, version: 1, action: "create", recordedAt: "2024-05-01T00:00:00.000Z" };
    expect(backupSchema.safeParse({ transactionHistory: [history] }).success).toBe(false);
    expect(backupSchema.safeParse({ transactionHistory: [{ ...history, after: { id: row.id, version: 1 } }] }).success).toBe(true);
    expect(backupSchema.safeParse({ transactions: [{ ...row, version: 1 }], transactionHistory: [{ ...history, version: 2, after: { id: row.id, version: 2 } }] }).success).toBe(false);
    expect(backupSchema.safeParse({ creationRequests: [{ key: "key", requestHash: "hash", createdAt: history.recordedAt }] }).success).toBe(false);
  });
});
