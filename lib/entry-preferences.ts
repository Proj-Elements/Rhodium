import { parseDateOnly, todayInShanghai } from "@/lib/domain";

type EntryDateInput = {
  today: string;
  defaultDate?: string;
  mode: string | null;
  lastDate: string | null;
};

/** Resolve a new entry's date from its month context and the user's preference. */
export function resolveEntryDate({ today, defaultDate, mode, lastDate }: EntryDateInput): string {
  const context = defaultDate || today;
  if (context.slice(0, 7) !== today.slice(0, 7)) return context;
  if (mode === "last" && lastDate && lastDate.slice(0, 7) === context.slice(0, 7)) {
    try {
      parseDateOnly(lastDate);
      return lastDate;
    } catch {
      // A stale or manually modified preference must not invalidate the form.
    }
  }
  return context;
}

/** Storage is optional: a blocked localStorage must not prevent recording money. */
export function preferredEntryDate(defaultDate?: string): string {
  const today = todayInShanghai();
  try {
    return resolveEntryDate({
      today,
      defaultDate,
      mode: window.localStorage.getItem("yueyu-entry-date-mode"),
      lastDate: window.localStorage.getItem("yueyu-last-entry-date"),
    });
  } catch {
    return defaultDate || today;
  }
}

/** Persist a convenience preference without turning a successful save into an error. */
export function rememberEntryDate(date: string): void {
  try {
    window.localStorage.setItem("yueyu-last-entry-date", date);
  } catch {
    // Recording is already successful; persistence is best-effort.
  }
}
