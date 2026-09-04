import { describe, expect, it, vi } from "vitest";
import {
  consumeNewTransactionIntent,
  requestNewTransaction,
  subscribeNewTransactionIntent,
} from "@/lib/new-transaction-intent";

describe("new transaction intent", () => {
  it("reports no intent until one is requested", () => {
    expect(consumeNewTransactionIntent()).toBe(false);
  });

  it("hands the intent over exactly once", () => {
    requestNewTransaction();
    expect(consumeNewTransactionIntent()).toBe(true);
    // A stale intent must not reopen the form on a later visit.
    expect(consumeNewTransactionIntent()).toBe(false);
  });

  it("notifies subscribers so an already-mounted page can react", () => {
    const listener = vi.fn(() => {
      expect(consumeNewTransactionIntent()).toBe(true);
    });
    const unsubscribe = subscribeNewTransactionIntent(listener);
    requestNewTransaction();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    requestNewTransaction();
    expect(listener).toHaveBeenCalledTimes(1);
    consumeNewTransactionIntent();
  });

  it("keeps the flag pending when nobody is listening", () => {
    requestNewTransaction();
    expect(consumeNewTransactionIntent()).toBe(true);
  });
});
