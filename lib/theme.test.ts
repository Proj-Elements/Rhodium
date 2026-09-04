import { describe, expect, it } from "vitest";
import { isColorMode, nextColorMode, schemeForMode } from "./theme";

describe("isColorMode", () => {
  it("accepts the three supported modes", () => {
    expect(isColorMode("system")).toBe(true);
    expect(isColorMode("light")).toBe(true);
    expect(isColorMode("dark")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isColorMode("System")).toBe(false);
    expect(isColorMode("")).toBe(false);
    expect(isColorMode(null)).toBe(false);
    expect(isColorMode(undefined)).toBe(false);
    expect(isColorMode(0)).toBe(false);
  });
});

describe("schemeForMode", () => {
  it("passes explicit modes through untouched", () => {
    expect(schemeForMode("light")).toBe("light");
    expect(schemeForMode("dark")).toBe("dark");
  });

  it("falls back to light for system when there is no window", () => {
    expect(schemeForMode("system")).toBe("light");
  });
});

describe("nextColorMode", () => {
  it("leaves system for the opposite of the current OS scheme", () => {
    expect(nextColorMode("system", true)).toBe("light");
    expect(nextColorMode("system", false)).toBe("dark");
  });

  it("cycles light -> dark -> system regardless of the OS scheme", () => {
    expect(nextColorMode("light", false)).toBe("dark");
    expect(nextColorMode("light", true)).toBe("dark");
    expect(nextColorMode("dark", false)).toBe("system");
    expect(nextColorMode("dark", true)).toBe("system");
  });

  it("returns to the starting mode after a full cycle", () => {
    const first = nextColorMode("system", false);
    const second = nextColorMode(first, false);
    expect(first).toBe("dark");
    expect(second).toBe("system");
  });

  it("always changes the applied scheme on the first tap from system", () => {
    for (const systemDark of [true, false]) {
      const next = nextColorMode("system", systemDark);
      expect(next).not.toBe("system");
      expect(schemeForMode(next)).not.toBe(systemDark ? "dark" : "light");
    }
  });
});
