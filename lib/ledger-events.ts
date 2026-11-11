"use client";

import { useEffect, useState } from "react";

const ledgerUpdatedEvent = "rhodium:ledger-updated";

export function announceLedgerUpdate(): void {
  window.dispatchEvent(new Event(ledgerUpdatedEvent));
}

export function useLedgerRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    window.addEventListener(ledgerUpdatedEvent, refresh);
    return () => window.removeEventListener(ledgerUpdatedEvent, refresh);
  }, []);
  return revision;
}
