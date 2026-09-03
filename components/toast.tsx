"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared toast pill. Extracted from five page-local copies.
 */
export function Toast({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span>{message}</span>
      {action && onAction && <button type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}

/**
 * Timed message with guaranteed timer cleanup: re-showing a message cancels
 * the previous timer (the old page-local versions let the first timer cut a
 * second message short), and unmount always clears it.
 */
export function useFlash(durationMs = 2600) {
  const [message, setMessage] = useState("");
  const timer = useRef<number | null>(null);

  const flash = useCallback(
    (text: string) => {
      if (timer.current) window.clearTimeout(timer.current);
      setMessage(text);
      timer.current = window.setTimeout(() => setMessage(""), durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return { message, flash, clear: useCallback(() => setMessage(""), []) };
}
