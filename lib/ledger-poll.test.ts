import { afterEach, describe, expect, it, vi } from "vitest";
import { startLedgerPolling } from "./ledger-poll";

afterEach(() => vi.useRealTimers());
describe("external ledger refresh", () => {
  it("reconciles the initial page read when it races the first revision response", async () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const stop = startLedgerPolling({ read: async () => "newer-than-page-snapshot", changed, visible: () => true, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200);
    expect(changed).toHaveBeenCalledOnce();
    stop();
  });
  it("refreshes on remote changes, survives errors and stops cleanly", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce("1").mockRejectedValueOnce(new Error("offline")).mockResolvedValue("2");
    const changed = vi.fn();
    const stop = startLedgerPolling({ read, changed, visible: () => true, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    expect(changed).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(4);
  });
  it("does not poll hidden pages", async () => {
    vi.useFakeTimers();
    const read = vi.fn();
    const stop = startLedgerPolling({ read, changed: vi.fn(), visible: () => false, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    expect(read).not.toHaveBeenCalled();
    stop();
  });
});
