"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { todayInShanghai } from "@/lib/domain";
import { CategoryDTO, TransactionDTO } from "@/lib/types";
import { Icon } from "@/components/icon";
import { ModalDialog } from "@/components/modal-dialog";

type TransactionFormProps = {
  categories: CategoryDTO[];
  transaction?: TransactionDTO | null;
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
};

function preferredDate() {
  if (typeof window !== "undefined" && window.localStorage.getItem("yueyu-entry-date-mode") === "last") {
    return window.localStorage.getItem("yueyu-last-entry-date") || todayInShanghai();
  }
  return todayInShanghai();
}

export function TransactionForm({ categories, transaction, defaultDate, onClose, onSaved }: TransactionFormProps) {
  const [type, setType] = useState<"expense" | "income">(transaction?.type === "INCOME" ? "income" : "expense");
  const [amount, setAmount] = useState(transaction ? (transaction.amountCents / 100).toFixed(2) : "");
  const [occurredOn, setOccurredOn] = useState(transaction?.occurredOn || defaultDate || preferredDate());
  const [categoryId, setCategoryId] = useState(transaction?.category.id || "");
  const [note, setNote] = useState(transaction?.note || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const availableCategories = useMemo(() => categories.filter((category) => !category.archivedAt && (category.type === "BOTH" || category.type === (type === "expense" ? "EXPENSE" : "INCOME"))), [categories, type]);

  useEffect(() => {
    if (!categoryId && availableCategories.length === 1) setCategoryId(availableCategories[0].id);
  }, [availableCategories, categoryId]);

  function switchType(next: "expense" | "income") {
    setType(next);
    const nextAvailable = categories.filter((category) => !category.archivedAt && (category.type === "BOTH" || category.type === (next === "expense" ? "EXPENSE" : "INCOME")));
    if (!nextAvailable.some((category) => category.id === categoryId)) setCategoryId("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const response = await fetch(transaction ? `/api/transactions/${transaction.id}` : "/api/transactions", {
        method: transaction ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, amount, occurredOn, categoryId, note }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "保存失败，请稍后再试");
      window.localStorage.setItem("yueyu-last-entry-date", occurredOn);
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败，请稍后再试");
    } finally {
      setSaving(false);
    }
  }

  return <ModalDialog labelledBy="transaction-form-title" dismissable={!saving} onClose={onClose} onSubmit={submit}>
    <div className="modal-head"><div><p className="eyebrow">QUICK ENTRY</p><h2 id="transaction-form-title">{transaction ? "编辑这笔账" : "记一笔"}</h2><p className="modal-subtitle">金额会以人民币分为单位保存，避免小数误差。</p></div><button className="modal-close" type="button" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></div>
    <div className="type-switch" role="tablist" aria-label="记录类型"><button type="button" role="tab" aria-selected={type === "expense"} className={type === "expense" ? "active" : ""} onClick={() => switchType("expense")}><Icon name="expense" size={14} />支出</button><button type="button" role="tab" aria-selected={type === "income"} className={type === "income" ? "active income-active" : ""} onClick={() => switchType("income")}><Icon name="income" size={14} />收入</button></div>
    <div className="form-field"><label className="form-label" htmlFor="amount">金额（元）</label><div className="amount-field"><span>¥</span><input id="amount" className="form-control amount-input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus required /></div></div>
    <div className="form-row"><div className="form-field"><label className="form-label" htmlFor="occurredOn">发生日期</label><input id="occurredOn" className="form-control" type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /></div><div className="form-field"><label className="form-label" htmlFor="categoryId">分类</label><select id="categoryId" className="form-control" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="">请选择分类</option>{availableCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>{availableCategories.length === 0 && <small className="field-hint">没有可用分类，请先到设置中添加。</small>}</div></div>
    <div className="form-field"><label className="form-label" htmlFor="note">备注 <span className="label-optional">可选</span></label><textarea id="note" className="form-control" maxLength={200} placeholder={type === "expense" ? "例如：早饭、打印资料" : "例如：周末兼职"} value={note} onChange={(event) => setNote(event.target.value)} /><div className="character-count">{note.length} / 200</div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>取消</button><button type="submit" className="button button-primary" disabled={saving || availableCategories.length === 0}>{saving ? "保存中…" : transaction ? "保存修改" : "保存记录"}</button></div>
  </ModalDialog>;
}
