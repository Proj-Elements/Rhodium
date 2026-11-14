/** Poll only a visible page and serialize requests so slow/offline servers cannot pile up work. */
export function startLedgerPolling(options: {
  read: (signal: AbortSignal) => Promise<string>;
  changed: () => void;
  visible: () => boolean;
  intervalMs?: number;
}) {
  const controller = new AbortController();
  let previous: string | undefined;
  let running = false;
  async function check() {
    if (running || controller.signal.aborted || !options.visible()) return;
    running = true;
    try {
      const current = await options.read(controller.signal);
      if (controller.signal.aborted) return;
      // The page's initial snapshot may predate this first response; reconcile it too.
      if (current !== previous) options.changed();
      previous = current;
    } catch { /* Keep the last version; a later successful poll catches missed writes. */ }
    finally { running = false; }
  }
  void check();
  const timer = setInterval(() => void check(), options.intervalMs ?? 15_000);
  return () => { clearInterval(timer); controller.abort(); };
}
