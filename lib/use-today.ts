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
  useEffect(() => watchShanghaiDate(setToday), []);
  return today;
}

/** Publish the current Shanghai date, and return the subscription cleanup. */
export function watchShanghaiDate(onChange: (date: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const update = () => {
    clearTimeout(timer);
    const today = todayInShanghai();
    onChange(today);
    const nextMidnight = new Date(`${today}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000;
    timer = setTimeout(update, Math.max(1, nextMidnight - Date.now()));
  };
  update();
  window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", update);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", update);
    document.removeEventListener("visibilitychange", update);
  };
}
