import { describe, expect, it } from "vitest";
import { isColorMode, nextColorMode, schemeForMode, type ColorMode } from "./theme";

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

  it.each([
    { systemDark: false, cycle: ["system", "dark", "light"] as const },
    { systemDark: true, cycle: ["system", "light", "dark"] as const },
  ])("visits all three modes when systemDark is $systemDark", ({ systemDark, cycle }) => {
    let mode: ColorMode = "system";
    for (const expected of [...cycle.slice(1), "system"]) {
      mode = nextColorMode(mode, systemDark);
      expect(mode).toBe(expected);
    }
  });

  it("can reach every mode from a stored explicit choice in either OS scheme", () => {
    for (const systemDark of [false, true]) {
      for (const start of ["light", "dark"] as const) {
        let mode: ColorMode = start;
        const visited = new Set<ColorMode>();
        for (let step = 0; step < 3; step += 1) {
          visited.add(mode);
          mode = nextColorMode(mode, systemDark);
        }
        expect(visited).toEqual(new Set(["system", "light", "dark"]));
        expect(mode).toBe(start);
      }
    }
  });

  it("always changes the applied scheme on the first tap from system", () => {
    for (const systemDark of [true, false]) {
      const next = nextColorMode("system", systemDark);
      expect(next).not.toBe("system");
      expect(schemeForMode(next)).not.toBe(systemDark ? "dark" : "light");
    }
  });
});
