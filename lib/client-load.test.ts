import { describe, expect, it, vi } from "vitest";
import { isClientDataReady, isCurrentMonthReady, runClientLoad } from "@/lib/client-load";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("client load lifecycle", () => {
  it("publishes only the newer result when a cancelled read resolves successfully", async () => {
    const older = deferred<string>();
    const first = new AbortController();
    const success = vi.fn();
    const failure = vi.fn();
    const finished = vi.fn();
    const common = { success, failure, finished, fallback: "读取失败" };
    const oldLoad = runClientLoad({ ...common, signal: first.signal, work: () => older.promise });
    first.abort();
    await runClientLoad({ ...common, signal: new AbortController().signal, work: async () => "new month" });
    older.resolve("old month");
    await oldLoad;
    expect(success.mock.calls).toEqual([["new month"]]);
    expect(failure).not.toHaveBeenCalled();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("ignores late non-abort failures from a cancelled effect", async () => {
    const response = deferred<string>();
    const controller = new AbortController();
    const failure = vi.fn();
    const finished = vi.fn();
    const load = runClientLoad({ signal: controller.signal, work: () => response.promise, success: vi.fn(), failure, finished, fallback: "读取失败" });
    controller.abort();
    response.reject(new Error("old network failure"));
    await load;
    expect(failure).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
  });

  it("retains a current failure for the page to render and releases loading", async () => {
    const failure = vi.fn();
    const finished = vi.fn();
    await runClientLoad({ signal: new AbortController().signal, work: async () => { throw new Error("offline"); }, success: vi.fn(), failure, finished, fallback: "读取失败" });
    expect(failure).toHaveBeenCalledWith("offline");
    expect(finished).toHaveBeenCalledOnce();
  });
});

describe("month-dependent mutation eligibility", () => {
  it("blocks collection writes while loading and after a failed read", () => {
    expect(isClientDataReady(true, "")).toBe(false);
    expect(isClientDataReady(false, "offline")).toBe(false);
    expect(isClientDataReady(false, "")).toBe(true);
  });
  it.each([
    ["2026-11", "2026-10", false, ""],
    ["2026-11", "2026-11", false, "offline"],
    ["2026-11", "2026-11", true, ""],
    ["2026-11", null, false, ""],
    ["", "", false, ""],
  ] as const)("rejects stale, failed or unavailable month state (%s, %s, %s, %s)", (month, loadedMonth, loading, error) => {
    expect(isCurrentMonthReady(month, loadedMonth, loading, error)).toBe(false);
  });

  it("allows a successfully loaded matching month, including a genuinely empty ledger", () => {
    expect(isCurrentMonthReady("2026-11", "2026-11", false, "")).toBe(true);
  });
});
