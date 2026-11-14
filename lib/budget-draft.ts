export type BudgetDraft = { value: string; version: string; scope: string };
export const emptyBudgetDraft: BudgetDraft = { value: "", version: "", scope: "" };

/** Bind a draft to the state observed when editing began, never a later refresh. */
export function editBudgetDraft(current: BudgetDraft, value: string, version: string, scope: string): BudgetDraft {
  if (!value) return emptyBudgetDraft;
  return { value, version: current.value && current.scope === scope ? current.version : version, scope };
}

export function budgetDraftIsStale(draft: BudgetDraft, version: string, scope: string): boolean {
  return Boolean(draft.value && (draft.version !== version || draft.scope !== scope));
}
