"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, Label, ListBox, Select, TextArea } from "@heroui/react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { addMonths, todayInShanghai } from "@/lib/domain";
import { CategoryDTO, SubscriptionDTO } from "@/lib/types";
import { IconButton } from "@/components/icon-button";
import { ModalDialog } from "@/components/modal-dialog";

const fieldClassName = "ledger-field";

export function SubscriptionForm({
  categories,
  subscription,
  defaultMonth,
  onClose,
  onSaved,
}: {
  categories: CategoryDTO[];
  subscription?: SubscriptionDTO | null;
  defaultMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(subscription?.name || "");
  const [amount, setAmount] = useState(subscription ? (subscription.amountCents / 100).toFixed(2) : "");
  const [billingDay, setBillingDay] = useState(String(subscription?.billingDay || 1));
  const [categoryId, setCategoryId] = useState(
    subscription?.categoryId ||
      categories.find((category) => !category.archivedAt && (category.type === "EXPENSE" || category.type === "BOTH"))?.id ||
      "",
  );
  const [startMonth, setStartMonth] = useState(subscription?.startMonth?.slice(0, 7) || defaultMonth);
  const [endMonth, setEndMonth] = useState(subscription?.endMonth?.slice(0, 7) || "");
  const [note, setNote] = useState(subscription?.note || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const futurePlan = Boolean(subscription && subscription.startMonth.slice(0, 7) > todayInShanghai().slice(0, 7));
  const editEffectiveMonth = addMonths(todayInShanghai().slice(0, 7), 1);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  const available = useMemo(
    () => categories.filter((category) => !category.archivedAt && (category.type === "EXPENSE" || category.type === "BOTH")),
    [categories],
  );

  useEffect(() => {
    if (!categoryId && available.length) setCategoryId(available[0].id);
  }, [available, categoryId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (endMonth && endMonth < startMonth) {
      setError("结束月份不能早于开始月份");
      return;
    }
    setSaving(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      await apiFetch(subscription ? `/api/subscriptions/${subscription.id}` : "/api/subscriptions", {
        method: subscription ? "PATCH" : "POST",
        signal: controller.signal,
        json: {
          name,
          amount,
          billingDay: Number(billingDay),
          categoryId,
          startMonth,
          endMonth: endMonth || null,
          active: subscription?.active ?? true,
          note,
        },
      });
      if (mountedRef.current) onSaved();
    } catch (saveError) {
      if (mountedRef.current) setError(errorMessage(saveError, "保存失败，请稍后再试"));
    } finally {
      if (mountedRef.current) setSaving(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function close() {
    mountedRef.current = false;
    requestRef.current?.abort();
    onClose();
  }

  return (
    <ModalDialog labelledBy="subscription-form-title" busy={saving} onClose={close} onSubmit={submit} header={
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] text-muted">把重复的事情，交给 Rhodium</p>
          <h2 id="subscription-form-title" className="text-xl font-semibold tracking-tight text-foreground">
            {subscription ? "编辑固定支出" : "添加固定支出"}
          </h2>
          <p className="text-xs leading-6 text-muted">到达记录日后自动记账，不会发起真实扣款。</p>
        </div>
        <IconButton icon="close" label="关闭固定支出表单" size="sm" onPress={close} />
      </div>
    } footer={<>
      <Button type="button" variant="ghost" onPress={close}>{saving ? "停止等待并关闭" : "取消"}</Button>
      <Button type="submit" variant="primary" isPending={saving} isDisabled={available.length === 0}>{subscription ? "保存修改" : "保存固定支出"}</Button>
    </>}>

      {subscription && <Alert status="default"><Alert.Indicator /><Alert.Content><Alert.Title>{futurePlan ? "尚未开始的计划按新的起始月份执行" : `本次计划修改从 ${editEffectiveMonth} 生效`}</Alert.Title><Alert.Description>金额、记录日、分类和备注变更不改写已发生的月份；暂停或恢复按操作当天生效。</Alert.Description></Alert.Content></Alert>}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground" htmlFor="sub-name">
          名称
        </label>
        <Input
          id="sub-name"
          className={fieldClassName}
          placeholder="例如：网易云音乐、校园网月租"
          value={name}
          maxLength={80}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="sub-amount">
            每月金额（元）
          </label>
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-3.5 text-sm font-semibold text-muted">¥</span>
            <Input
              id="sub-amount"
              className={`${fieldClassName} pl-8 font-semibold tabular-nums`}
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              disabled={saving}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="sub-day">
            记录日
          </label>
          <Input
            id="sub-day"
            className={`${fieldClassName} tabular-nums`}
            type="number"
            min="1"
            max="31"
            value={billingDay}
            disabled={saving}
            onChange={(event) => setBillingDay(event.target.value)}
            required
          />
          <small className="text-xs text-muted">短月会自动调整到当月最后一天。</small>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Select
          name="categoryId"
          className="w-full gap-1.5"
          variant="secondary"
          placeholder="请选择分类"
          value={categoryId || null}
          isDisabled={saving}
          onChange={(value) => setCategoryId(typeof value === "string" ? value : "")}
          isRequired
        >
          <Label className="text-sm font-medium text-foreground">支出分类</Label>
          <Select.Trigger className="h-[42px] rounded-[11px]">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="ledger-select-popover">
            <ListBox aria-label="支出分类" className="max-h-64 overflow-y-auto">
              {available.map((category) => (
                <ListBox.Item id={category.id} key={category.id} textValue={category.name}>
                  {category.name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {available.length === 0 && (
          <small className="text-xs text-warning">没有可用的支出分类，请先到设置中添加。</small>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="start-month">
            生效月份
          </label>
          <Input
            id="start-month"
            className={`${fieldClassName} tabular-nums`}
            type="month"
            value={startMonth}
            disabled={saving}
            onChange={(event) => setStartMonth(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="end-month">
            结束月份 <span className="text-xs font-normal text-muted">可选</span>
          </label>
          <Input
            id="end-month"
            className={`${fieldClassName} tabular-nums`}
            type="month"
            value={endMonth}
            disabled={saving}
            onChange={(event) => setEndMonth(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground" htmlFor="sub-note">
            备注 <span className="text-xs font-normal text-muted">可选</span>
          </label>
          <span className="text-xs tabular-nums text-muted">{note.length} / 200</span>
        </div>
        <TextArea
          id="sub-note"
          rows={2}
          className="ledger-field"
          maxLength={200}
          placeholder="自动生成账目时会沿用这段备注"
          value={note}
          disabled={saving}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {error && (
        <Alert ref={errorRef} status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{error}</Alert.Title>
          </Alert.Content>
        </Alert>
      )}
      {saving && <p className="text-xs leading-6 text-muted">关闭只会停止等待，服务端可能已保存。再次操作前请核对固定支出列表。</p>}

    </ModalDialog>
  );
}
