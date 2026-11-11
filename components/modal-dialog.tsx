"use client";

import { FormEvent, ReactNode } from "react";
import { Modal } from "@heroui/react";

type ModalDialogProps = {
  /** id of the heading that names this dialog. */
  labelledBy: string;
  /** false while a request is in flight, so Escape/backdrop cannot discard input. */
  dismissable?: boolean;
  busy?: boolean;
  wide?: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * HeroUI owns focus trapping, background inertness, scroll locking and restoration.
 * Callers decide whether dismissal cancels waiting for an outstanding mutation.
 */
export function ModalDialog({
  labelledBy,
  dismissable = true,
  busy = false,
  wide,
  onClose,
  onSubmit,
  header,
  footer,
  children,
}: ModalDialogProps) {
  return (
    <Modal.Backdrop
      isOpen
      isDismissable={dismissable}
      isKeyboardDismissDisabled={!dismissable}
      onOpenChange={(open) => {
        if (!open && dismissable) onClose();
      }}
      variant="blur"
    >
      <Modal.Container placement="center" size={wide ? "lg" : "md"} scroll="inside" className="ledger-modal-container">
        <Modal.Dialog aria-labelledby={labelledBy} className="ledger-modal-dialog text-overlay-foreground">
          <form className="modal-form" onSubmit={onSubmit} aria-busy={busy || !dismissable}>
            {header && <Modal.Header className="ledger-modal-header">{header}</Modal.Header>}
            <Modal.Body className="form-stack ledger-modal-body">{children}</Modal.Body>
            {footer && <Modal.Footer className="ledger-modal-footer">{footer}</Modal.Footer>}
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
