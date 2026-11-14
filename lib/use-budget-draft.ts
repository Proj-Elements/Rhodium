"use client";

import { useState } from "react";
import { budgetDraftIsStale, editBudgetDraft, emptyBudgetDraft } from "@/lib/budget-draft";

/** Keep amount and observed version together across background refreshes. */
export function useBudgetDraft(version: string, scope: string) {
  const [draft, setDraft] = useState(emptyBudgetDraft);
  return {
    value: draft.scope === scope ? draft.value : "",
    version: draft.version,
    stale: draft.scope === scope && budgetDraftIsStale(draft, version, scope),
    setValue: (value: string) => setDraft((current) => editBudgetDraft(current, value, version, scope)),
  };
}
