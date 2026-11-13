"use client";

import { useEffect, useState } from "react";

const ledgerUpdatedEvent = "rhodium:ledger-updated";

export function announceLedgerUpdate(): void {
  window.dispatchEvent(new Event(ledgerUpdatedEvent));
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(ledgerUpdatedEvent);
      channel.postMessage("updated");
      channel.close();
      return;
    }
  } catch { /* Storage remains available in browsers that disable channels. */ }
  try { localStorage.setItem(ledgerUpdatedEvent, `${Date.now()}:${Math.random()}`); } catch { /* Local refresh has already happened. */ }
}

export function useLedgerRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    let channel: BroadcastChannel | null = null;
    try { if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(ledgerUpdatedEvent); } catch { /* Focus and storage still refresh the ledger. */ }
    if (channel) channel.onmessage = refresh;
    const storageRefresh = (event: StorageEvent) => { if (event.key === ledgerUpdatedEvent) refresh(); };
    const visibilityRefresh = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener(ledgerUpdatedEvent, refresh);
    window.addEventListener("storage", storageRefresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visibilityRefresh);
    return () => {
      channel?.close();
      window.removeEventListener(ledgerUpdatedEvent, refresh);
      window.removeEventListener("storage", storageRefresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visibilityRefresh);
    };
  }, []);
  return revision;
}
