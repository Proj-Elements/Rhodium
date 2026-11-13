import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubscriptionScheduler } from "@/lib/subscription-scheduler";
import { todayInShanghai } from "@/lib/domain";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("server subscription scheduler", () => {
  it("runs without a browser and recomputes the day for each scheduled run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T15:59:30.000Z"));
    const days: string[] = [];
    const scheduler = createSubscriptionScheduler(async () => { days.push(todayInShanghai()); });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(days).toEqual(["2026-11-12", "2026-11-13"]);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(days).toHaveLength(2);
  });

  it("waits for the active run, avoids overlaps and clears its timer on shutdown", async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const sync = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const scheduler = createSubscriptionScheduler(sync);
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sync).toHaveBeenCalledTimes(1);
    const stopped = scheduler.stop();
    complete();
    await stopped;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a failed run on the next interval", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sync = vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue(undefined);
    const scheduler = createSubscriptionScheduler(sync);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
});
