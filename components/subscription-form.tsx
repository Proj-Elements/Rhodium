"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CategoryDTO, SubscriptionDTO } from "@/lib/types";
import { Icon } from "@/components/icon";
import { ModalDialog } from "@/components/modal-dialog";

export function SubscriptionForm({ categories, subscription, defaultMonth, onClose, onSaved }: { categories: CategoryDTO[]; subscription?: SubscriptionDTO | null; defaultMonth: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(subscription?.name || "");
  const [amount, setAmount] = useState(subscription ? (subscription.amountCents / 100).toFixed(2) : "");
  const [billingDay, setBillingDay] = useState(String(subscription?.billingDay || 1));
  const [categoryId, setCategoryId] = useState(subscription?.categoryId || categories.find((category) => !category.archivedAt && (category.type === "EXPENSE" || category.type === "BOTH"))?.id || "");
  const [startMonth, setStartMonth] = useState(subscription?.startMonth?.slice(0, 7) || defaultMonth);
  const [endMonth, setEndMonth] = useState(subscription?.endMonth?.slice(0, 7) || "");
  const [note, setNote] = useState(subscription?.note || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const available = useMemo(
    () => categories.filter((category) => !category.archivedAt && (category.type === "EXPENSE" || category.type === "BOTH")),
    [categories],
  );

  useEffect(() => {
    if (!categoryId && available.length) setCategoryId(available[0].id);
  }, [available, categoryId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (endMonth && endMonth < startMonth) {
      setError("结束月份不能早于开始月份");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(subscription ? `/api/subscriptions/${subscription.id}` : "/api/subscriptions", {
        method: subscription ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, amount, billingDay: Number(billingDay), categoryId, startMonth, endMonth: endMonth || null, active: subscription?.active ?? true, note }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "保存失败，请稍后再试");
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败，请稍后再试");
    } finally {
      setSaving(false);
    }
  }

  return <ModalDialog labelledBy="subscription-form-title" dismissable={!saving} onClose={onClose} onSubmit={submit}>
    <div className="modal-head"><div><p className="eyebrow">RECURRING FEE</p><h2 id="subscription-form-title">{subscription ? "编辑固定支出" : "添加固定支出"}</h2><p className="modal-subtitle">到达扣款日后，月余会自动写入对应月份。</p></div><button className="modal-close" type="button" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></div>
    <div className="form-field"><label className="form-label" htmlFor="sub-name">名称</label><input id="sub-name" className="form-control" placeholder="例如：网易云音乐" value={name} onChange={(event) => setName(event.target.value)} required /></div>
    <div className="form-row"><div className="form-field"><label className="form-label" htmlFor="sub-amount">每月金额（元）</label><div className="amount-field"><span>¥</span><input id="sub-amount" className="form-control amount-input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div></div><div className="form-field"><label className="form-label" htmlFor="sub-day">扣款日</label><input id="sub-day" className="form-control" type="number" min="1" max="31" value={billingDay} onChange={(event) => setBillingDay(event.target.value)} required /><small className="field-hint">短月会自动调整到最后一天。</small></div></div>
    <div className="form-field"><label className="form-label" htmlFor="sub-category">支出分类</label><select id="sub-category" className="form-control" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="">请选择分类</option>{available.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>{available.length === 0 && <small className="field-hint">没有可用的支出分类，请先到设置中添加。</small>}</div>
    <div className="form-row"><div className="form-field"><label className="form-label" htmlFor="start-month">生效月份</label><input id="start-month" className="form-control" type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} required /></div><div className="form-field"><label className="form-label" htmlFor="end-month">结束月份 <span className="label-optional">可选</span></label><input id="end-month" className="form-control" type="month" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} /></div></div>
    <div className="form-field"><label className="form-label" htmlFor="sub-note">备注 <span className="label-optional">可选</span></label><textarea id="sub-note" className="form-control" maxLength={200} placeholder="自动生成账目时会沿用这段备注" value={note} onChange={(event) => setNote(event.target.value)} /><div className="character-count">{note.length} / 200</div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>取消</button><button type="submit" className="button button-primary" disabled={saving || available.length === 0}>{saving ? "保存中…" : subscription ? "保存修改" : "保存固定支出"}</button></div>
  </ModalDialog>;
}
