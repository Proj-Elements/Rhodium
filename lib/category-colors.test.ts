import { describe, expect, it } from "vitest";
import { getCategoryColor, getCategoryColors } from "./category-colors";

describe("category color palette", () => {
  it("offers at least sixteen distinct category colors", () => {
    const ids = Array.from({ length: 80 }, (_, index) => `cat_${index}`);
    const colors = new Set(ids.map((id) => getCategoryColor(id).color));

    expect(colors.size).toBeGreaterThanOrEqual(16);
  });
});

describe("category color assignment", () => {
  it("keeps a category's color when other categories are added, archived or removed", () => {
    const original = getCategoryColors(["category-b", "category-c"]);
    const expanded = getCategoryColors(["category-a", "category-b", "category-c", "category-d"]);
    const filtered = getCategoryColors(["category-c"]);
    expect(expanded.get("category-b")).toEqual(original.get("category-b"));
    expect(expanded.get("category-c")).toEqual(original.get("category-c"));
    expect(filtered.get("category-c")).toEqual(original.get("category-c"));
  });

  it("keeps each category's color when the input order changes", () => {
    const ids = Array.from({ length: 24 }, (_, index) => `cat_${index}`);

    expect(getCategoryColors(ids)).toEqual(getCategoryColors([...ids].reverse()));
  });

  it("continues with theme-aware distinct colors beyond the preset palette", () => {
    const ids = Array.from({ length: 40 }, (_, index) => `cat_${index}`);
    const assigned = getCategoryColors(ids);

    expect(assigned.size).toBe(40);
    expect(new Set([...assigned.values()].map((entry) => entry.color)).size).toBe(40);
    for (const entry of [...assigned.values()].slice(16)) {
      expect(entry.color).toContain("var(--category-color-lightness)");
      expect(entry.surface).toContain("var(--category-surface-lightness)");
    }
  });

  it("assigns one entry per category and handles an empty set", () => {
    expect(getCategoryColors([]).size).toBe(0);
    expect(getCategoryColors(["cat_1", "cat_1"]).size).toBe(1);
    expect(getCategoryColors(["cat_1"]).get("cat_1")).toEqual(getCategoryColor("cat_1"));
  });
});
