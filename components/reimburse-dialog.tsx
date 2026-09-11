"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { ModalDialog } from "@/components/modal-dialog";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatMoney } from "@/lib/domain";
import type { TransactionDTO } from "@/lib/types";

type ReimburseDialogProps = {
  transaction: TransactionDTO;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * 确认报销弹窗。报销是会计事实而非账目编辑：金额、日期、分类都不动，
 * 只打上报销时间戳；之后该笔支出不再计入仪表盘的支出、预算与剩余。
 */
export function ReimburseDialog({ transaction, onClose, onSaved }: ReimburseDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setError("");
    setSubmitting(true);
    try {
      await apiFetch(`/api/transactions/${transaction.id}`, { method: "PATCH", json: { reimburse: true } });
      onSaved();
    } catch (reimburseError) {
      setError(errorMessage(reimburseError, "报销失败，请稍后再试"));
      setSubmitting(false);
    }
  }

  return (
    <ModalDialog labelledBy="reimburse-dialog-title" dismissable={!submitting} onClose={onClose} onSubmit={confirm}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">REIMBURSE</p>
          <h2 id="reimburse-dialog-title">确认报销这笔账？</h2>
          <p className="modal-subtitle">报销后这笔支出不再计入本月支出与预算余额，可以随时撤销。</p>
        </div>
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭" disabled={submitting}>
          <Icon name="close" />
        </button>
      </div>
      <div className="reimburse-summary">
        <div className="reimburse-row">
          <span>内容</span>
          <strong>{transaction.note || transaction.category.name}</strong>
        </div>
        <div className="reimburse-row">
          <span>日期</span>
          <strong>{transaction.occurredOn}</strong>
        </div>
        <div className="reimburse-row">
          <span>金额</span>
          <strong className="reimburse-amount">{formatMoney(transaction.amountCents)}</strong>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={onClose} disabled={submitting}>
          取消
        </button>
        <button type="submit" className="button button-primary" disabled={submitting}>
          {submitting ? "报销中…" : "确认报销"}
        </button>
      </div>
    </ModalDialog>
  );
}
