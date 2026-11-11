"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Chip, ListBox, SearchField, Select, Skeleton } from "@heroui/react";
import { EmptyState, Segment } from "@heroui-pro/react";
import { IconButton } from "@/components/icon-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MetricCard } from "@/components/metric-card";
import { AppShell } from "@/components/app-shell";
import { CategoryIcon, Icon } from "@/components/icon";
import { ModalDialog } from "@/components/modal-dialog";
import { MonthSwitcher } from "@/components/month-switcher";
import { ReimburseDialog } from "@/components/reimburse-dialog";
import { Toast, useFlash } from "@/components/toast";
import { TransactionForm } from "@/components/transaction-form";
import { ApiError, apiFetch, errorMessage } from "@/lib/api-client";
import { runClientLoad } from "@/lib/client-load";
import { getCategoryColor, getCategoryColors } from "@/lib/category-colors";
import { dateLabel, formatMoney, todayInShanghai } from "@/lib/domain";
import { useLedgerRevision } from "@/lib/ledger-events";
import { consumeNewTransactionIntent, subscribeNewTransactionIntent } from "@/lib/new-transaction-intent";
import { CategoryDTO, TransactionDTO } from "@/lib/types";

type TransactionFilter = "all" | "expense" | "income";
type TransactionScope = "month" | "all";
type TransactionView = "ledger" | "trash";
type LedgerTransaction = TransactionDTO & { monthLocked?: boolean };
type DateGroup = { date: string; items: LedgerTransaction[]; expenseCents: number; incomeCents: number };
type TransactionSummary = { expenseCents: number; outOfPocketCents: number; incomeCents: number; reimbursedCents: number; reimbursedCount: number; transactionCount: number };
type TransactionsPayload = { month: string; readOnly: boolean; transactions: LedgerTransaction[]; nextCursor: string | null; summary: TransactionSummary };
type HistoryEntry = { id: string; version: number; action: string; recordedAt: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const HISTORY_FIELDS = [
  ["type", "收支类型"], ["amountCents", "金额"], ["occurredOn", "发生日期"], ["categoryName", "分类"],
  ["note", "备注"], ["reimbursedAt", "报销时间"], ["deletedAt", "删除时间"], ["source", "来源"],
] as const;
const HISTORY_ACTIONS: Record<string, string> = { CREATE: "创建记录", EDIT: "编辑记录", UPDATE: "编辑记录", DELETE: "删除记录", RESTORE: "恢复记录", REIMBURSE: "确认报销", UNREIMBURSE: "撤销报销", IMPORT: "导入记录", RESTORE_BACKUP: "恢复备份" };

function historyValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "amountCents" && typeof value === "number") return formatMoney(value);
  if (field === "type") return value === "INCOME" ? "收入" : "支出";
  if (field === "source") return value === "SUBSCRIPTION" ? "固定支出" : "手动记录";
  if (field === "occurredOn" && typeof value === "string") return value.slice(0, 10);
  if (field.endsWith("At") && typeof value === "string") return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  return String(value);
}

export default function TransactionsPage() {
  const [month, setMonth] = useState("");
  const [scope, setScope] = useState<TransactionScope>("month");
  const [view, setView] = useState<TransactionView>("ledger");
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [loadedKey, setLoadedKey] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LedgerTransaction | null>(null);
  const [reimbursing, setReimbursing] = useState<LedgerTransaction | null>(null);
  const [undoTransaction, setUndoTransaction] = useState<LedgerTransaction | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<LedgerTransaction | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [historyTransaction, setHistoryTransaction] = useState<LedgerTransaction | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyReload, setHistoryReload] = useState(0);
  const deepLinkHandled = useRef(false);
  const pendingNewIntent = useRef(false);
  const moreRequest = useRef<AbortController | null>(null);
  const { message, flash } = useFlash();
  const ledgerRevision = useLedgerRevision();
  const queryMonth = scope === "all" ? "all" : month;
  const requestKey = `${queryMonth}:${view}:${filter}:${categoryFilter}:${debouncedSearch}`;
  const currentRequestKey = useRef(requestKey);
  currentRequestKey.current = requestKey;
  const ready = Boolean(month && loadedKey === requestKey && !loading && !error && search.trim() === debouncedSearch);
  const reload = () => setReloadToken((token) => token + 1);

  function requestUrl(cursor?: string): string {
    const query = new URLSearchParams({ month: queryMonth, limit: "500" });
    if (view === "trash") query.set("deleted", "only");
    if (filter !== "all") query.set("type", filter);
    if (categoryFilter !== "all") query.set("categoryId", categoryFilter);
    if (debouncedSearch) query.set("q", debouncedSearch);
    if (cursor) query.set("cursor", cursor);
    return `/api/transactions?${query}`;
  }

  async function load(signal: AbortSignal) {
    setLoading(true);
    setError("");
    setTransactions([]);
    setSummary(null);
    setNextCursor(null);
    setMoreError("");
    await runClientLoad({
      signal,
      work: () => Promise.all([
        apiFetch<TransactionsPayload>(requestUrl(), { signal }),
        apiFetch<{ categories: CategoryDTO[] }>("/api/categories", { signal }),
      ]),
      success: ([transactionResult, categoryResult]) => {
        setTransactions(transactionResult.transactions);
        setSummary(transactionResult.summary);
        setLoadedKey(requestKey);
        setReadOnly(Boolean(transactionResult.readOnly));
        setNextCursor(transactionResult.nextCursor);
        if (transactionResult.readOnly) {
          setShowForm(false);
          setEditing(null);
          setReimbursing(null);
          setPendingDelete(null);
        }
        setCategories(categoryResult.categories);
      },
      failure: setError,
      finished: () => setLoading(false),
      fallback: "暂时无法读取账目",
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!deepLinkHandled.current) {
      deepLinkHandled.current = true;
      const params = new URLSearchParams(window.location.search);
      const requestedMonth = params.get("month");
      setMonth(requestedMonth && MONTH_PATTERN.test(requestedMonth) ? requestedMonth : todayInShanghai().slice(0, 7));
      if (requestedMonth === "all") setScope("all");
      if (params.get("view") === "trash") setView("trash");
      return;
    }
    if (!month) return;
    moreRequest.current?.abort();
    setLoadingMore(false);
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey captures all query filters
  }, [month, requestKey, reloadToken, ledgerRevision]);

  useEffect(() => {
    if (!month) return;
    const params = new URLSearchParams({ month: queryMonth });
    if (view === "trash") params.set("view", "trash");
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [month, queryMonth, view]);

  useEffect(() => {
    const open = () => {
      if (consumeNewTransactionIntent()) pendingNewIntent.current = true;
      if (!pendingNewIntent.current || !ready) return;
      pendingNewIntent.current = false;
      if (!readOnly && view === "ledger") setShowForm(true);
      else flash(readOnly ? "当前月份已结算，需重新打开后才能记账" : "请先返回账本后再记一笔");
    };
    open();
    return subscribeNewTransactionIntent(open);
  }, [ready, readOnly, view, flash]);

  useEffect(() => () => moreRequest.current?.abort(), []);

  useEffect(() => {
    if (!undoTransaction) return;
    const timer = window.setTimeout(() => setUndoTransaction(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [undoTransaction]);

  useEffect(() => {
    if (!historyTransaction) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    setHistory([]);
    void runClientLoad({
      signal: controller.signal,
      work: () => apiFetch<{ history: HistoryEntry[] }>(`/api/transactions/${historyTransaction.id}/history`, { signal: controller.signal }),
      success: (result) => setHistory(result.history),
      failure: setHistoryError,
      finished: () => setHistoryLoading(false),
      fallback: "无法读取变更历史",
    });
    return () => controller.abort();
  }, [historyTransaction, historyReload]);

  async function loadMore() {
    if (!ready || !nextCursor || loadingMore) return;
    const key = requestKey;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    setMoreError("");
    try {
      const result = await apiFetch<TransactionsPayload>(requestUrl(nextCursor), { signal: controller.signal });
      if (controller.signal.aborted || currentRequestKey.current !== key) return;
      setTransactions((items) => [...items, ...result.transactions.filter((item) => !items.some((existing) => existing.id === item.id))]);
      setNextCursor(result.nextCursor);
      setSummary(result.summary);
    } catch (loadError) {
      if (!controller.signal.aborted && currentRequestKey.current === key) setMoreError(errorMessage(loadError, "无法加载更多记录"));
    } finally {
      if (!controller.signal.aborted && currentRequestKey.current === key) setLoadingMore(false);
    }
  }

  function writable(transaction: LedgerTransaction): boolean {
    return ready && !readOnly && !transaction.monthLocked;
  }

  async function remove(transaction: LedgerTransaction) {
    if (!writable(transaction) || deletingId) return;
    setDeletingId(transaction.id);
    try {
      const result = await apiFetch<{ transaction: LedgerTransaction }>(`/api/transactions/${transaction.id}?expectedVersion=${transaction.version}`, { method: "DELETE" });
      setPendingDelete(null);
      setUndoTransaction(result.transaction);
      reload();
    } catch (removeError) {
      flash(errorMessage(removeError, "删除失败"));
      if (removeError instanceof ApiError && removeError.status === 409) {
        setPendingDelete(null);
        reload();
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function restore(transaction: LedgerTransaction) {
    if (restoringId || transaction.monthLocked) return;
    setRestoringId(transaction.id);
    try {
      await apiFetch(`/api/transactions/${transaction.id}`, { method: "PATCH", json: { restore: true, expectedVersion: transaction.version } });
      setUndoTransaction(null);
      flash("记录已恢复");
      reload();
    } catch (restoreError) {
      flash(errorMessage(restoreError, "恢复失败"));
      if (restoreError instanceof ApiError && restoreError.status === 409) {
        setUndoTransaction(null);
        reload();
      }
    } finally {
      setRestoringId(null);
    }
  }

  const grouped = useMemo<DateGroup[]>(() => {
    const groups = new Map<string, DateGroup>();
    transactions.forEach((transaction) => {
      const group = groups.get(transaction.occurredOn) || { date: transaction.occurredOn, items: [], expenseCents: 0, incomeCents: 0 };
      group.items.push(transaction);
      if (transaction.type === "INCOME") group.incomeCents += transaction.amountCents;
      else if (!transaction.reimbursedAt) group.expenseCents += transaction.amountCents;
      groups.set(transaction.occurredOn, group);
    });
    return [...groups.values()];
  }, [transactions]);

  const categoryColors = useMemo(() => getCategoryColors([
    ...categories.map((category) => category.id),
    ...transactions.map((transaction) => transaction.category.id),
  ]), [categories, transactions]);
  const filterCategories = categories.filter((category) => !category.archivedAt || transactions.some((transaction) => transaction.category.id === category.id) || category.id === categoryFilter);
  const filtering = Boolean(search) || categoryFilter !== "all" || filter !== "all";
  const today = todayInShanghai();
  const defaultEntryDate = !month || month === today.slice(0, 7) ? today : `${month}-01`;
  const dataReady = ready && summary !== null;
  const viewLabel = view === "trash" ? "回收站" : scope === "all" ? "所有月份" : "当月";

  function openNew() {
    if (ready && !readOnly && view === "ledger") setShowForm(true);
  }

  function changeMonth(next: string) {
    setShowForm(false);
    setEditing(null);
    setReimbursing(null);
    setPendingDelete(null);
    setMonth(next);
    setScope("month");
  }

  function clearFilters() {
    setFilter("all");
    setCategoryFilter("all");
    setSearch("");
  }

  return (
    <AppShell actions={<><MonthSwitcher month={month} onChange={changeMonth} /><Button onPress={openNew} isDisabled={readOnly || !ready || view === "trash"}><Icon name="plus" size={16} />记一笔</Button></>}>
      <div className="page-stack">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 reveal" aria-label="账目汇总">
          <MetricCard label={`${filtering ? "筛选后" : viewLabel}自付支出`} value={dataReady ? formatMoney(summary.outOfPocketCents) : "—"} detail={dataReady ? `账面 ${formatMoney(summary.expenseCents)} · 已报销支出不占预算` : "完成读取后显示汇总"} icon="expense" />
          <MetricCard label={`${filtering ? "筛选后" : viewLabel}收入`} value={dataReady ? formatMoney(summary.incomeCents) : "—"} detail={view === "trash" ? "已删除记录，不计入账本统计" : "报销回收不计为收入"} icon="income" tone="income" />
          <MetricCard label={`${filtering ? "匹配的" : viewLabel}记录`} value={<>{dataReady ? summary.transactionCount : "—"}<span className="ml-1.5 text-xs font-normal tracking-normal text-muted">笔</span></>} detail={dataReady ? `已加载 ${transactions.length} 笔${nextCursor ? "，可继续加载" : ""}` : "完成读取后显示记录数"} icon="receipt" />
          <MetricCard label={`${filtering ? "筛选内" : viewLabel}已报销`} value={dataReady ? formatMoney(summary.reimbursedCents) : "—"} detail={dataReady ? `${summary.reimbursedCount} 笔 · 不占预算，不计收入` : "完成读取后显示报销汇总"} icon="wallet" tone="income" />
        </section>

        <Card className="panel transaction-filter-panel reveal reveal-delay-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segment aria-label="记录位置" size="sm" selectedKey={view} onSelectionChange={(key) => { if (key === "ledger" || key === "trash") { setView(key); setShowForm(false); setEditing(null); setReimbursing(null); setPendingDelete(null); } }} className="w-fit"><Segment.Item id="ledger" className="px-4">账本</Segment.Item><Segment.Item id="trash" className="px-4">回收站</Segment.Item></Segment>
            <Segment aria-label="搜索月份范围" size="sm" selectedKey={scope} onSelectionChange={(key) => { if (key === "month" || key === "all") { setScope(key); setShowForm(false); setEditing(null); setReimbursing(null); setPendingDelete(null); } }} className="w-fit"><Segment.Item id="month" className="px-4">所选月份</Segment.Item><Segment.Item id="all" className="px-4">所有月份</Segment.Item></Segment>
          </div>
          <div className="transaction-filters">
            <Segment aria-label="账目类型" size="sm" selectedKey={filter} onSelectionChange={(key) => { if (key === "all" || key === "expense" || key === "income") setFilter(key); }} className="transaction-type-filter w-fit"><Segment.Item id="all" className="px-4">全部账目</Segment.Item><Segment.Item id="expense" className="px-4">支出</Segment.Item><Segment.Item id="income" className="px-4">收入</Segment.Item></Segment>
            <SearchField aria-label={`搜索${scope === "all" ? "所有月份" : "所选月份"}${view === "trash" ? "已删除" : ""}账目`} value={search} onChange={setSearch} className="transaction-search"><SearchField.Group className="bg-surface-secondary"><SearchField.SearchIcon /><SearchField.Input placeholder="搜索备注、分类或订阅" className="text-xs" /><SearchField.ClearButton /></SearchField.Group></SearchField>
            <Select aria-label="按分类筛选" className="transaction-category-filter" variant="secondary" value={categoryFilter} onChange={(value) => { if (typeof value === "string") setCategoryFilter(value); }}><Select.Trigger className="h-10 rounded-[11px]"><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover className="ledger-select-popover"><ListBox aria-label="账目分类" className="max-h-64 overflow-y-auto"><ListBox.Item id="all" textValue="所有分类">所有分类<ListBox.ItemIndicator /></ListBox.Item>{filterCategories.map((category) => <ListBox.Item id={category.id} key={category.id} textValue={`${category.name}${category.archivedAt ? "（已停用）" : ""}`}>{category.name}{category.archivedAt ? "（已停用）" : ""}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover></Select>
          </div>
          {view === "trash" && <p className="text-xs leading-6 text-muted">已删除记录会保留在回收站，可按月份或关键词查找并恢复；已结算月份需先重新打开。</p>}
          {filtering && <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted">正在筛选 · {scope === "all" ? "所有月份" : month}</span>{filter !== "all" && <Chip size="sm" variant="soft"><Chip.Label>{filter === "expense" ? "支出" : "收入"}</Chip.Label></Chip>}{categoryFilter !== "all" && <Chip size="sm" variant="soft"><Chip.Label>{categories.find((item) => item.id === categoryFilter)?.name || "已选分类"}</Chip.Label></Chip>}{search && <Chip size="sm" variant="soft"><Chip.Label>“{search}”</Chip.Label></Chip>}<Button size="sm" variant="ghost" className="h-7 text-xs text-accent" onPress={clearFilters}>清除筛选</Button></div>}
        </Card>

        {ready && readOnly && <Alert status="warning"><Alert.Indicator /><Alert.Content><Alert.Title>这个月的账目已结算</Alert.Title><Alert.Description>记录已暂时锁定。如需修改或恢复，可先在月度回顾中重新打开。</Alert.Description><Link className="text-link mt-3" href={`/settlements?month=${month}`}>查看月度回顾<Icon name="arrow" size={13} /></Link></Alert.Content></Alert>}
        {error ? <Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Title>{error}</Alert.Title><Button size="sm" variant="outline" onPress={reload} className="mt-3">重新加载</Button></Alert.Content></Alert> : !ready ? <div className="flex flex-col gap-4" aria-busy="true" aria-label="正在读取账目">{[1, 2, 3].map((index) => <Skeleton key={index} className="h-32 rounded-[20px]" />)}</div> : !grouped.length ? (
          <Card className="panel"><EmptyState className="py-12"><EmptyState.Media variant="icon"><Icon name={filtering ? "search" : "receipt"} size={24} /></EmptyState.Media><EmptyState.Header><EmptyState.Title>{filtering ? "暂时没找到这笔记录" : view === "trash" ? "回收站没有记录" : "还没有账目记录"}</EmptyState.Title><EmptyState.Description>{filtering ? "试试所有月份、另一个关键词，或者清除筛选。" : view === "trash" ? "删除的账目会保留在这里，方便以后查找和恢复。" : "从一顿早餐或一次出行开始，记下生活的样子。"}</EmptyState.Description></EmptyState.Header><EmptyState.Content>{filtering ? <Button variant="outline" onPress={clearFilters}>清除筛选</Button> : !readOnly && view === "ledger" && <Button onPress={openNew}>记下第一笔</Button>}</EmptyState.Content></EmptyState></Card>
        ) : (
          <div className="flex flex-col gap-6 reveal reveal-delay-2">
            {grouped.map((group) => <section key={group.date}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1"><div className="flex items-center gap-3"><h2 className="text-xs font-medium">{scope === "all" ? `${group.date.slice(0, 4)} 年 ` : ""}{dateLabel(group.date)}</h2><span className="text-[10px] tabular-nums text-muted">{group.items.length} 笔已加载</span></div><div className="flex gap-4 text-[11px] tabular-nums text-muted">{group.expenseCents > 0 && <span>自付 <b className="ml-1 font-medium text-foreground">{formatMoney(group.expenseCents)}</b></span>}{group.incomeCents > 0 && <span>收入 <b className="ml-1 font-medium text-success">{formatMoney(group.incomeCents)}</b></span>}</div></div>
              <Card className="divide-y divide-separator rounded-[20px] p-0">
                {group.items.map((transaction) => {
                  const palette = categoryColors.get(transaction.category.id) ?? getCategoryColor(transaction.category.id);
                  const isIncome = transaction.type === "INCOME";
                  const locked = readOnly || transaction.monthLocked;
                  return <div className="transaction-row" key={transaction.id}>
                    <div className="flex min-w-0 items-center gap-3"><span className="category-symbol" style={{ color: isIncome ? "var(--success)" : palette.color, background: isIncome ? "var(--success-soft)" : palette.surface }}><CategoryIcon categoryName={transaction.category.name} type={transaction.type} icon={transaction.category.icon} size={18} /></span><div className="transaction-copy"><strong title={transaction.note || transaction.category.name}>{transaction.note || transaction.category.name}</strong><p>{transaction.category.name}{transaction.source === "SUBSCRIPTION" ? ` · 自动记录${transaction.subscription?.name ? ` / ${transaction.subscription.name}` : ""}` : " · 手动记录"}{transaction.deletedAt ? ` · 删除于 ${transaction.deletedAt.slice(0, 10)}` : ""}</p><div className="mt-1 flex flex-wrap gap-1">{transaction.reimbursedAt && <Chip size="sm" color="success" variant="soft"><Chip.Label>已报销</Chip.Label></Chip>}{locked && <Link className="text-xs text-muted underline" href={`/settlements?month=${transaction.occurredOn.slice(0, 7)}`}>已结算 · 查看回顾</Link>}</div></div></div>
                    <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-6"><span className={`transaction-value ${isIncome ? "text-success" : ""} ${transaction.reimbursedAt ? "text-muted line-through" : ""}`}>{isIncome ? "+" : "−"}{formatMoney(transaction.amountCents)}</span><div className="flex items-center gap-1">{view === "trash" ? <Button size="sm" variant="outline" isDisabled={Boolean(locked) || Boolean(restoringId)} isPending={restoringId === transaction.id} onPress={() => void restore(transaction)}>恢复</Button> : !locked && <>{!isIncome && <IconButton size="sm" icon="wallet" label={`${transaction.reimbursedAt ? "撤销报销" : "报销"}${transaction.note || transaction.category.name}`} onPress={() => setReimbursing(transaction)} />}<IconButton size="sm" icon="edit" label={`编辑${transaction.note || transaction.category.name}`} onPress={() => setEditing(transaction)} /><IconButton size="sm" icon="trash" label={`删除${transaction.note || transaction.category.name}`} className="text-muted hover:text-danger" isDisabled={Boolean(deletingId)} onPress={() => setPendingDelete(transaction)} /></>}<Button size="sm" variant="ghost" className="text-xs text-muted" onPress={() => setHistoryTransaction(transaction)}>历史</Button></div></div>
                  </div>;
                })}
              </Card>
            </section>)}
            {moreError && <p className="form-error" role="alert">{moreError}</p>}
            <div className="flex flex-col items-center gap-3"><p className="text-center text-[11px] text-muted">已加载 {transactions.length} / {summary?.transactionCount ?? transactions.length} 笔记录 · 汇总包含全部匹配记录</p>{nextCursor && <Button variant="outline" onPress={() => void loadMore()} isPending={loadingMore}>加载更多</Button>}</div>
          </div>
        )}
      </div>
      {(showForm || editing) && !readOnly && view === "ledger" && (!editing || !editing.monthLocked) && <TransactionForm categories={categories} transaction={editing} defaultDate={defaultEntryDate} onClose={() => { setShowForm(false); setEditing(null); reload(); }} onSaved={() => { setShowForm(false); setEditing(null); reload(); }} />}
      {reimbursing && !readOnly && !reimbursing.monthLocked && view === "ledger" && <ReimburseDialog transaction={reimbursing} onClose={() => { setReimbursing(null); reload(); }} onRefresh={() => { setReimbursing(null); reload(); }} onSaved={() => { setReimbursing(null); reload(); }} />}
      {pendingDelete && ready && writable(pendingDelete) && view === "ledger" && <ConfirmDialog title="删除这笔记录？" description={`「${pendingDelete.note || pendingDelete.category.name}」将移入回收站，不再计入账本统计。以后仍可在回收站按月份或关键词查找并恢复。`} confirmLabel="移入回收站" danger busy={Boolean(deletingId)} onConfirm={() => void remove(pendingDelete)} onClose={() => setPendingDelete(null)} />}
      {historyTransaction && <ModalDialog labelledBy="transaction-history-title" onClose={() => setHistoryTransaction(null)} onSubmit={(event) => event.preventDefault()} wide header={<div className="flex items-center justify-between gap-3"><h2 id="transaction-history-title" className="text-lg font-semibold">账目变更历史</h2><IconButton icon="close" label="关闭变更历史" onPress={() => setHistoryTransaction(null)} /></div>} footer={<Button type="button" variant="ghost" onPress={() => setHistoryTransaction(null)}>关闭</Button>}>
        <p className="text-sm text-muted">{historyTransaction.note || historyTransaction.category.name} · {historyTransaction.occurredOn}</p>
        {historyLoading ? <p role="status" className="text-sm text-muted">正在读取变更记录…</p> : historyError ? <><p className="form-error" role="alert">{historyError}</p><Button type="button" variant="outline" onPress={() => setHistoryReload((value) => value + 1)}>重新加载</Button></> : !history.length ? <p className="text-sm leading-7 text-muted">这笔账目尚无记录的变更。历史功能启用前的修改无法追溯。</p> : <ol className="flex flex-col gap-5">{history.map((entry) => <li key={entry.id} className="rounded-xl bg-surface-secondary p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><strong>{HISTORY_ACTIONS[entry.action.toUpperCase()] || entry.action} · 版本 {entry.version}</strong><time className="text-muted tabular-nums" dateTime={entry.recordedAt}>{historyValue("recordedAt", entry.recordedAt)}</time></div><dl className="flex flex-col gap-2 text-xs">{HISTORY_FIELDS.filter(([field]) => entry.before?.[field] !== entry.after?.[field] && (entry.before?.[field] != null || entry.after?.[field] != null)).map(([field, label]) => <div key={field} className="grid grid-cols-[5em_1fr] gap-3"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words whitespace-pre-wrap">{entry.before ? <><span className="text-muted">{historyValue(field, entry.before[field])}</span><span aria-label="变为" className="mx-2">→</span></> : null}{historyValue(field, entry.after?.[field])}</dd></div>)}</dl></li>)}</ol>}
      </ModalDialog>}
      {undoTransaction && !message && <Toast message="记录已移入回收站，之后仍可恢复" action={restoringId ? "正在恢复" : "撤销"} onAction={() => { if (!restoringId) void restore(undoTransaction); }} />}
      {message && <Toast message={message} />}
    </AppShell>
  );
}
