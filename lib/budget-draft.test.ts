import { describe, expect, it } from "vitest";
import { budgetDraftIsStale, editBudgetDraft, emptyBudgetDraft } from "./budget-draft";

describe("budget draft concurrency", () => {
  it("retains the original version when refreshed data arrives during editing", () => {
    const first = editBudgetDraft(emptyBudgetDraft, "200", "v1", "2026-11");
    const changed = editBudgetDraft(first, "2000", "v2", "2026-11");
    expect(changed.version).toBe("v1");
    expect(budgetDraftIsStale(changed, "v2", "2026-11")).toBe(true);
  });
  it("only rebases after the user discards the old draft", () => {
    const old = editBudgetDraft(emptyBudgetDraft, "2000", "v1", "preset");
    const cleared = editBudgetDraft(old, "", "v2", "preset");
    expect(editBudgetDraft(cleared, "3000", "v2", "preset").version).toBe("v2");
  });
  it("marks a previous month's draft stale instead of carrying it into the new month", () => {
    const old = editBudgetDraft(emptyBudgetDraft, "2000", "v1", "2026-11");
    expect(budgetDraftIsStale(old, "v1", "2026-12")).toBe(true);
  });
});
