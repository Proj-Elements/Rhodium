"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@/components/icon";

/**
 * Shared floating status pill, centered in the content column.
 */
export function Toast({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return (
    <div
      className="ledger-toast flex items-center gap-3 rounded-2xl bg-overlay px-4 py-3 text-xs text-overlay-foreground shadow-overlay"
      role="status"
      aria-live="polite"
    >
      <span className="shrink-0 text-muted">
        <Icon name="info" size={16} />
      </span>
      <span>{message}</span>
      {action && onAction && (
        <Button size="sm" variant="tertiary" className="h-7 px-2.5 text-xs" onPress={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

/**
 * Timed message with guaranteed timer cleanup.
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

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return { message, flash, clear: useCallback(() => setMessage(""), []) };
}
