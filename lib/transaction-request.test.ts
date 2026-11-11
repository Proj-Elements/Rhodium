import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("transaction creation retries", () => {
  it("retains a key through a lost response and module reload, then retires confirmed requests", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const payload = { type: "expense", amount: "1.00", note: "午餐" };
    const first = await import("@/lib/transaction-request");
    const key = await first.transactionCreationKey(payload);
    expect(await first.transactionCreationKey(payload)).toBe(key);
    expect([...storage.values()].join("")).not.toContain("午餐");
    vi.resetModules();
    const reloaded = await import("@/lib/transaction-request");
    expect(await reloaded.transactionCreationKey(payload)).toBe(key);
    expect(await reloaded.transactionCreationKey({ ...payload, amount: "2.00" })).not.toBe(key);
    reloaded.confirmTransactionCreation(key);
    expect(await reloaded.transactionCreationKey(payload)).not.toBe(key);
  });

  it("still retains an uncertain request in memory when browser storage is unavailable", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    const { transactionCreationKey } = await import("@/lib/transaction-request");
    const payload = { amount: "3.00" };
    expect(await transactionCreationKey(payload)).toBe(await transactionCreationKey(payload));
  });

  it("uses secure random bytes when randomUUID is unavailable on a LAN HTTP origin", async () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(19) });
    const { transactionCreationKey } = await import("@/lib/transaction-request");
    expect(await transactionCreationKey({ amount: "4.00" })).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });
});
