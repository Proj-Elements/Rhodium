import { describe, expect, it } from "vitest";
import { categoryIconNames, isCategoryIconName, resolveCategoryIcon } from "@/lib/category-icons";
import icons from "@/lib/gravity-icons.json";

describe("category icons", () => {
  it("bundles every selectable icon locally", () => {
    expect(new Set(categoryIconNames).size).toBe(categoryIconNames.length);
    for (const name of categoryIconNames) expect(icons).toHaveProperty(name);
  });

  it("uses the explicit icon regardless of the category name or type", () => {
    expect(resolveCategoryIcon("餐饮", "EXPENSE", "coffee")).toBe("coffee");
    expect(resolveCategoryIcon("工资", "INCOME", "leaf")).toBe("leaf");
    expect(resolveCategoryIcon("调整", "BOTH", "wallet")).toBe("wallet");
  });

  it("preserves automatic matching for legacy and unknown icons", () => {
    expect(resolveCategoryIcon("餐饮", "EXPENSE")).toBe("food");
    expect(resolveCategoryIcon("饮料零食", "EXPENSE", null)).toBe("drink");
    expect(resolveCategoryIcon("工资", "INCOME")).toBe("work");
    expect(resolveCategoryIcon("礼物", "INCOME", "invalid")).toBe("income");
    expect(resolveCategoryIcon("调整", "BOTH")).toBe("other");
  });

  it.each(["constructor", "toString", "__proto__", "", null, 1])("rejects unsupported identifier %j", (value) => {
    expect(isCategoryIconName(value)).toBe(false);
  });
});
