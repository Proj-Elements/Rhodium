import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useToday, watchShanghaiDate } from "@/lib/use-today";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Shanghai date subscription", () => {
  it("uses a neutral value during server rendering, irrespective of build month", () => {
    function Month() { return createElement("span", null, useToday()?.slice(0, 7) ?? "读取中"); }
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T15:59:59Z"));
    expect(renderToStaticMarkup(createElement(Month))).toBe("<span>读取中</span>");
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    expect(renderToStaticMarkup(createElement(Month))).toBe("<span>读取中</span>");
  });

  it("updates an open tab at Shanghai midnight and removes its timer on cleanup", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", new EventTarget());
    vi.setSystemTime(new Date("2026-10-31T15:59:59Z"));
    const changed = vi.fn();
    const cleanup = watchShanghaiDate(changed);
    expect(changed).toHaveBeenLastCalledWith("2026-10-31");
    vi.advanceTimersByTime(1100);
    expect(changed).toHaveBeenLastCalledWith("2026-11-01");
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes immediately when a sleeping tab regains focus", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", new EventTarget());
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    const changed = vi.fn();
    const cleanup = watchShanghaiDate(changed);
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
    window.dispatchEvent(new Event("focus"));
    expect(changed).toHaveBeenLastCalledWith("2026-11-02");
    cleanup();
    const count = changed.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    expect(changed).toHaveBeenCalledTimes(count);
  });
});
