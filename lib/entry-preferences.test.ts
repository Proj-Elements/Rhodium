import { afterEach, describe, expect, it, vi } from "vitest";
import { preferredEntryDate, rememberEntryDate, resolveEntryDate } from "./entry-preferences";

afterEach(() => vi.unstubAllGlobals());

const context = { today: "2026-11-03", defaultDate: "2026-11-03", mode: "last", lastDate: "2026-11-02" };

describe("new entry date preference", () => {
  it("honors the last-used preference when opening the current month", () => {
    expect(resolveEntryDate(context)).toBe("2026-11-02");
  });

  it("does not send a last-used date into an explicitly selected historical month", () => {
    expect(resolveEntryDate({ ...context, defaultDate: "2026-10-31" })).toBe("2026-10-31");
  });

  it("keeps the context of an explicitly selected future month", () => {
    expect(resolveEntryDate({ ...context, defaultDate: "2026-12-01" })).toBe("2026-12-01");
  });

  it("uses today in today mode", () => {
    expect(resolveEntryDate({ ...context, mode: "today" })).toBe(context.today);
  });

  it("falls back to today for unavailable, invalid and cross-month stored dates", () => {
    for (const lastDate of [null, "", "not-a-date", "2026-11-31", "2026-10-31"]) {
      expect(resolveEntryDate({ ...context, lastDate })).toBe(context.today);
    }
  });

  it("also honors the preference when no explicit default was supplied", () => {
    expect(resolveEntryDate({ ...context, defaultDate: undefined })).toBe("2026-11-02");
  });

  it("does not use a corrupted date even when no explicit default was supplied", () => {
    expect(resolveEntryDate({ ...context, defaultDate: undefined, lastDate: "2026-11-31" })).toBe(context.today);
  });

  it("keeps the form usable when localStorage is unavailable", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("Storage blocked"); } });
    expect(preferredEntryDate("2026-10-31")).toBe("2026-10-31");
    expect(() => rememberEntryDate("2026-11-03")).not.toThrow();
  });
});
