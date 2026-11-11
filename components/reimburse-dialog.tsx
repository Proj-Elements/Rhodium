"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@/components/icon";
import { IconButton } from "@/components/icon-button";
import { ModalDialog } from "@/components/modal-dialog";
import { ApiError, apiFetch, errorMessage } from "@/lib/api-client";
import { formatMoney } from "@/lib/domain";
import type { TransactionDTO } from "@/lib/types";

type ReimburseDialogProps = {
  transaction: TransactionDTO;
  onClose: () => void;
  onSaved: () => void;
  onRefresh: () => void;
};

/**
 * 确认报销弹窗。报销是会计事实而非账目编辑：金额、日期、分类都不动，
 * 只打上报销时间戳；之后该笔支出不再计入仪表盘的支出、预算与剩余。
 */
export function ReimburseDialog({ transaction, onClose, onSaved, onRefresh }: ReimburseDialogProps) {
  const headingId = useId();
  const undo = Boolean(transaction.reimbursedAt);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  function close() {
    request.current?.abort();
    onClose();
  }

  async function confirm() {
    if (submitting) return;
    setError("");
    setConflicted(false);
    setSubmitting(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      await apiFetch(`/api/transactions/${transaction.id}`, { method: "PATCH", signal: controller.signal, json: { ...(undo ? { unreimburse: true } : { reimburse: true }), expectedVersion: transaction.version } });
      if (!controller.signal.aborted) onSaved();
    } catch (reimburseError) {
      if (controller.signal.aborted) return;
      setConflicted(reimburseError instanceof ApiError && reimburseError.status === 409);
      setError(errorMessage(reimburseError, undo ? "撤销报销失败，请稍后再试" : "报销失败，请稍后再试"));
      setSubmitting(false);
    }
  }

  return (
    <ModalDialog
      labelledBy={headingId}
      busy={submitting}
      onClose={close}
      onSubmit={(event) => { event.preventDefault(); void confirm(); }}
      header={<div className="flex w-full items-center justify-between gap-3"><h2 id={headingId} className="text-lg font-semibold">{undo ? "撤销这笔报销？" : "确认报销这笔账？"}</h2><IconButton type="button" icon="close" label="关闭" onPress={close} /></div>}
      footer={<><Button type="button" variant="ghost" onPress={close} autoFocus>{submitting ? "停止等待并关闭" : "取消"}</Button>{conflicted ? <Button type="button" variant="outline" onPress={onRefresh}>关闭并刷新</Button> : <Button type="submit" isPending={submitting}>{undo ? "撤销报销" : "确认报销"}</Button>}</>}
    >
      <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Icon name="wallet" size={20} /></span>
      <p className="text-sm leading-7 text-muted">{undo ? "撤销后，这笔支出会重新计入自付金额与预算使用，原账目不变。" : "报销后，这笔支出不再占用预算。账面记录保留，报销不计为收入，也可以撤销。"}</p>
      {submitting && <p className="text-xs leading-6 text-muted" role="status">关闭会停止等待，已送达服务器的操作仍可能完成。关闭后将刷新账目以核对结果。</p>}
      <dl className="flex flex-col gap-4 rounded-xl bg-surface-secondary p-4 text-xs">
        <div className="flex justify-between gap-4"><dt className="text-muted">内容</dt><dd className="min-w-0 truncate text-right font-medium">{transaction.note || transaction.category.name}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">日期</dt><dd className="tabular-nums">{transaction.occurredOn}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">金额</dt><dd className="font-semibold tabular-nums">{formatMoney(transaction.amountCents)}</dd></div>
      </dl>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </ModalDialog>
  );
}
