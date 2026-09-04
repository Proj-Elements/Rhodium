"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type DialogOptions = {
  /** Called on Escape and by the caller's own close controls. */
  onClose: () => void;
  /** While true, Escape is ignored (e.g. a save request is in flight). */
  closeLocked?: boolean;
};

/**
 * Modal dialog behaviour shared by the entry forms: closes on Escape, keeps Tab
 * inside the dialog, and returns focus to whatever opened it. Attach the
 * returned ref to the element carrying role="dialog".
 *
 * Initial focus is left alone when the dialog already contains the active
 * element, so a child's autoFocus still wins; otherwise the first focusable
 * child is focused so keyboard users do not start behind the backdrop.
 */
export function useDialog<T extends HTMLElement>({ onClose, closeLocked = false }: DialogOptions) {
  const containerRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const closeLockedRef = useRef(closeLocked);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeLockedRef.current = closeLocked;
  }, [closeLocked]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusableItems = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement);

    if (!container.contains(document.activeElement)) {
      const [first] = focusableItems();
      if (first) first.focus();
      else {
        container.tabIndex = -1;
        container.focus();
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (closeLockedRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableItems();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const leavingBackwards = event.shiftKey && (active === first || !container.contains(active));
      const leavingForwards = !event.shiftKey && (active === last || !container.contains(active));
      if (leavingBackwards || leavingForwards) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  return containerRef;
}
