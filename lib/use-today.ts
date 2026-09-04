"use client";

import { useEffect, useState } from "react";
import { todayInShanghai } from "@/lib/domain";

/**
 * Every page in this app is a Client Component that Next.js *statically
 * prerenders*, so calling todayInShanghai() during render bakes the **build**
 * date into the shipped HTML. When the build day and the visit day fall in
 * different months, the hydrated tree disagrees with that HTML (the month label
 * flips from "2026 / 09" to "2026 / 10", and the 本月 button appears or
 * disappears — a DOM-shape mismatch, not just text).
 *
 * Resolving the date in an effect keeps the first client render identical to the
 * server output. `null` means "the client has not told us the date yet"; callers
 * render a neutral placeholder until it does.
 */
export function useToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayInShanghai()), []);
  return today;
}
