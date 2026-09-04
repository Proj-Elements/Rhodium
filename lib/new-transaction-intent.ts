/**
 * "记一笔" lives in the app chrome (sidebar, mobile top bar, page header) but the
 * form it opens lives on the transactions page. It used to be a
 * `<Link href="/transactions?new=1">`, which silently did nothing when the user
 * was *already* on /transactions: same-route navigation does not remount the
 * page, so the mount-only effect that read `?new=1` never ran again.
 *
 * Reading the param reactively would need `useSearchParams()`, which forces a
 * Suspense boundary on these statically prerendered pages and flashes unstyled
 * fallback content outside the app shell. So the intent is passed in memory
 * instead:
 *
 *  - already on the page → the subscriber fires and opens the form immediately;
 *  - coming from another route → the flag survives until the page mounts and
 *    consumes it.
 *
 * The flag is one-shot on purpose: a stale intent must not reopen the form on a
 * later visit.
 */

let pending = false;
const listeners = new Set<() => void>();

/** Ask the transactions page to open a blank entry form. */
export function requestNewTransaction() {
  pending = true;
  listeners.forEach((listener) => listener());
}

/** Take the pending intent, if any. Returns true at most once per request. */
export function consumeNewTransactionIntent(): boolean {
  if (!pending) return false;
  pending = false;
  return true;
}

export function subscribeNewTransactionIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
