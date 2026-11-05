"use client";

import { useId } from "react";
import { Button } from "@heroui/react";
import { ModalDialog } from "@/components/modal-dialog";
import { Icon } from "@/components/icon";

type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Explicit confirmation for destructive actions, with a safe cancel path. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busy,
  danger,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const headingId = useId();
  return (
    <ModalDialog
      labelledBy={headingId}
      dismissable={!busy}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onConfirm();
      }}
      footer={<>
        <Button type="button" variant="ghost" onPress={onClose} isDisabled={busy} autoFocus>取消</Button>
        <Button type="submit" variant={danger ? "danger-soft" : "primary"} isPending={busy}>{confirmLabel}</Button>
      </>}
    >
      <span className={`flex size-11 items-center justify-center rounded-2xl ${danger ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}>
        <Icon name={danger ? "trash" : "check"} size={20} />
      </span>
      <div>
        <h2 id={headingId} className="text-lg font-semibold">{title}</h2>
        <p className="mt-3 text-sm leading-7 text-muted">{description}</p>
      </div>
    </ModalDialog>
  );
}
