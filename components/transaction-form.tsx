"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, Radio, RadioGroup, TextArea } from "@heroui/react";
import { Segment } from "@heroui-pro/react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { preferredEntryDate, rememberEntryDate } from "@/lib/entry-preferences";
import { CategoryDTO, TransactionDTO } from "@/lib/types";
import { CategoryIcon, Icon } from "@/components/icon";
import { IconButton } from "@/components/icon-button";
import { ModalDialog } from "@/components/modal-dialog";

type TransactionFormProps = {
  categories: CategoryDTO[];
  transaction?: TransactionDTO | null;
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
};

export function TransactionForm({ categories, transaction, defaultDate, onClose, onSaved }: TransactionFormProps) {
  const [type, setType] = useState<"expense" | "income">(transaction?.type === "INCOME" ? "income" : "expense");
  const [amount, setAmount] = useState(transaction ? (transaction.amountCents / 100).toFixed(2) : "");
  const [occurredOn, setOccurredOn] = useState(() => transaction?.occurredOn || preferredEntryDate(defaultDate));
  const [categoryId, setCategoryId] = useState(transaction?.category.id || "");
  const [note, setNote] = useState(transaction?.note || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  const availableCategories = useMemo(() => categories.filter((category) =>
    !category.archivedAt && (category.type === "BOTH" || category.type === (type === "expense" ? "EXPENSE" : "INCOME")),
  ), [categories, type]);

  useEffect(() => {
    if (!categoryId && availableCategories.length === 1) setCategoryId(availableCategories[0].id);
  }, [availableCategories, categoryId]);

  function switchType(next: "expense" | "income") {
    setType(next);
    const available = categories.filter((category) => !category.archivedAt && (category.type === "BOTH" || category.type === (next === "expense" ? "EXPENSE" : "INCOME")));
    if (!available.some((category) => category.id === categoryId)) setCategoryId("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      await apiFetch(transaction ? `/api/transactions/${transaction.id}` : "/api/transactions", {
        method: transaction ? "PATCH" : "POST",
        json: { type, amount, occurredOn, categoryId, note },
      });
      rememberEntryDate(occurredOn);
      onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError, "保存失败，请稍后再试"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalDialog
      labelledBy="transaction-form-title"
      dismissable={!saving}
      wide
      onClose={onClose}
      onSubmit={submit}
      header={
        <div className="flex items-start justify-between gap-4">
          <div><p className="mb-1 text-[11px] text-muted">记录生活的一个切片</p><h2 id="transaction-form-title" className="text-xl font-semibold tracking-tight">{transaction ? "编辑这笔记录" : "记一笔"}</h2></div>
          <IconButton icon="close" label="关闭记账表单" size="sm" onPress={onClose} isDisabled={saving} />
        </div>
      }
      footer={<>
        <Button type="button" variant="ghost" onPress={onClose} isDisabled={saving}>取消</Button>
        <Button type="submit" isPending={saving} isDisabled={!categoryId || !amount.trim()}>{transaction ? "保存修改" : "保存记录"}</Button>
      </>}
    >

      <Segment aria-label="记录类型" selectedKey={type} isDisabled={saving} onSelectionChange={(key) => { if (key === "expense" || key === "income") switchType(key); }} className="w-fit">
        <Segment.Item id="expense" className="gap-2 px-5 text-xs"><Icon name="expense" size={14} />支出</Segment.Item>
        <Segment.Item id="income" className="gap-2 px-5 text-xs"><Icon name="income" size={14} />收入</Segment.Item>
      </Segment>

      <div>
        <label className="field-label text-muted" htmlFor="amount">{type === "expense" ? "支出金额" : "收入金额"}</label>
        <div className="form-amount"><span className="text-2xl text-muted">¥</span><input id="amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus required disabled={saving} /></div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="field-label" id="entry-category-label">选择分类</span>
        <RadioGroup aria-labelledby="entry-category-label" name="categoryId" value={categoryId} onChange={setCategoryId} isRequired isDisabled={saving} className="category-grid grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-5">
          {availableCategories.map((category) => <Radio key={category.id} value={category.id} className="min-w-0 w-full"><Radio.Content className="category-choice w-full"><CategoryIcon categoryName={category.name} type={type === "income" ? "INCOME" : "EXPENSE"} icon={category.icon} size={20} /><span>{category.name}</span></Radio.Content></Radio>)}
        </RadioGroup>
        {!availableCategories.length && <p className="text-xs text-warning">没有可用分类，请先到设置中添加。</p>}
      </div>

      <div className="flex flex-col gap-2"><label className="field-label" htmlFor="occurredOn">发生日期</label><Input id="occurredOn" className="ledger-field tabular-nums" type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required disabled={saving} /></div>
      <div className="flex flex-col gap-2"><label className="field-label" htmlFor="note">备注 <span className="font-normal text-muted">· 可选</span></label><TextArea id="note" className="ledger-field" rows={2} maxLength={200} placeholder={type === "expense" ? "这笔花销，是生活里的什么小事？" : "记下这份收入的来源"} value={note} onChange={(event) => setNote(event.target.value)} disabled={saving} /></div>
      {error && <Alert ref={errorRef} status="danger"><Alert.Indicator /><Alert.Content><Alert.Title>{error}</Alert.Title></Alert.Content></Alert>}
    </ModalDialog>
  );
}
