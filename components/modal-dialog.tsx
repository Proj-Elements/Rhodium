"use client";

import { FormEvent, ReactNode, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

type ModalDialogProps = {
  /** id of the heading that names this dialog. */
  labelledBy: string;
  /** false while a request is in flight, so Escape/backdrop cannot discard input. */
  dismissable?: boolean;
  wide?: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
};

function focusableNodes(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/**
 * Shared shell for the app's two form modals. Beyond deduplicating markup it
 * supplies the dialog semantics both forms were missing: `role="dialog"` +
 * `aria-modal`, a Tab focus trap, focus restore to whatever opened it, Escape to
 * dismiss, and a background scroll lock.
 */
export function ModalDialog({ labelledBy, dismissable = true, wide, onClose, onSubmit, children }: ModalDialogProps) {
  const formRef = useRef<HTMLFormElement>(null);
  // Read through a ref inside the key handler so the listener is installed once.
  const dismissableRef = useRef(dismissable);
  dismissableRef.current = dismissable;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const form = formRef.current;
    // React applies autoFocus during commit, so only take focus when the dialog
    // did not already claim it.
    if (form && !form.contains(document.activeElement)) {
      (focusableNodes(form)[0] ?? form).focus();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!dismissableRef.current) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const form = formRef.current;
      if (!form) return;
      const nodes = focusableNodes(form);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || !form.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return <div
    className="modal-backdrop"
    role="presentation"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && dismissable) onClose();
    }}
  >
    <form
      ref={formRef}
      className={wide ? "modal wide" : "modal"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onSubmit={onSubmit}
    >
      {children}
    </form>
  </div>;
}
