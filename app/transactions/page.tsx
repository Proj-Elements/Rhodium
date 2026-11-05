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
import { MonthSwitcher } from "@/components/month-switcher";
import { Toast, useFlash } from "@/components/toast";
import { TransactionForm } from "@/components/transaction-form";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { getCategoryColor, getCategoryColors } from "@/lib/category-colors";
import { dateLabel, formatMoney, todayInShanghai } from "@/lib/domain";
import { consumeNewTransactionIntent, subscribeNewTransactionIntent } from "@/lib/new-transaction-intent";
import { CategoryDTO, TransactionDTO } from "@/lib/types";

type TransactionFilter = "all" | "expense" | "income";

type DateGroup = {
  date: string;
  items: TransactionDTO[];
  expenseCents: number;
  incomeCents: number;
};

type TransactionsPayload = { month: string; readOnly: boolean; transactions: TransactionDTO[] };

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function TransactionsPage() {
  const [month, setMonth] = useState("");
  const [transactions, setTransactions] = useState<TransactionDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<TransactionDTO | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const undoTimer = useRef<number | null>(null);
  const deepLinkHandled = useRef(false);
  const { message, flash } = useFlash();

  const reload = () => setReloadToken((token) => token + 1);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const [transactionResult, categoryResult] = await Promise.all([
        apiFetch<TransactionsPayload>(`/api/transactions?month=${month}`, { signal }),
        apiFetch<{ categories: CategoryDTO[] }>("/api/categories", { signal }),
      ]);
      setTransactions(transactionResult.transactions || []);
      setReadOnly(Boolean(transactionResult.readOnly));
      if (transactionResult.readOnly) {
        setShowForm(false);
        setEditing(null);
      }
      setCategories(categoryResult.categories || []);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(errorMessage(loadError, "暂时无法读取账目"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    if (!deepLinkHandled.current) {
      deepLinkHandled.current = true;
      const requestedMonth = new URLSearchParams(window.location.search).get("month");
      setMonth(requestedMonth && MONTH_PATTERN.test(requestedMonth) ? requestedMonth : todayInShanghai().slice(0, 7));
      return;
    }
    if (!month) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on month change
  }, [month, reloadToken]);

  useEffect(() => {
    if (!month) return;
    const searchParam = `?month=${month}`;
    if (window.location.search !== searchParam) {
      window.history.replaceState(null, "", `${window.location.pathname}${searchParam}`);
    }
  }, [month]);

  useEffect(() => {
    const open = () => {
      if (consumeNewTransactionIntent()) setShowForm(true);
    };
    open();
    return subscribeNewTransactionIntent(open);
  }, []);

  useEffect(
    () => () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  async function remove(transaction: TransactionDTO) {
    if (deletingId) return;
    setDeletingId(transaction.id);
    try {
      await apiFetch(`/api/transactions/${transaction.id}`, { method: "DELETE" });
      setTransactions((items) => items.filter((item) => item.id !== transaction.id));
      setPendingDelete(null);
      setUndoId(transaction.id);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndoId(null), 5000);
    } catch (removeError) {
      flash(errorMessage(removeError, "删除失败"));
    } finally {
      setDeletingId(null);
    }
  }

  async function undo() {
    if (!undoId) return;
    const restoreId = undoId;
    setUndoId(null);
    try {
      await apiFetch(`/api/transactions/${restoreId}`, { method: "PATCH", json: { restore: true } });
      reload();
    } catch (restoreError) {
      flash(errorMessage(restoreError, "撤销失败"));
    }
  }

  const visibleTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions.filter((transaction) => {
      if (filter !== "all" && transaction.type !== (filter === "expense" ? "EXPENSE" : "INCOME")) return false;
      const matchesCategory = categoryFilter === "all" || transaction.category.id === categoryFilter;
      if (!matchesCategory) return false;
      if (!query) return true;
      const haystack = [transaction.note || "", transaction.category.name, transaction.subscription?.name || ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [transactions, search, categoryFilter, filter]);

  const grouped = useMemo<DateGroup[]>(() => {
    const groups = new Map<string, DateGroup>();
    visibleTransactions.forEach((transaction) => {
      const group = groups.get(transaction.occurredOn) || {
        date: transaction.occurredOn,
        items: [],
        expenseCents: 0,
        incomeCents: 0,
      };
      group.items.push(transaction);
      if (transaction.type === "INCOME") group.incomeCents += transaction.amountCents;
      else group.expenseCents += transaction.amountCents;
      groups.set(transaction.occurredOn, group);
    });
    return [...groups.values()];
  }, [visibleTransactions]);

  const totals = useMemo(
    () =>
      visibleTransactions.reduce(
        (result, transaction) => {
          if (transaction.type === "INCOME") result.incomeCents += transaction.amountCents;
          else result.expenseCents += transaction.amountCents;
          return result;
        },
        { expenseCents: 0, incomeCents: 0 },
      ),
    [visibleTransactions],
  );

  const categoryColors = useMemo(() => getCategoryColors([
    ...categories.map((category) => category.id),
    ...transactions.map((transaction) => transaction.category.id),
  ]), [categories, transactions]);
  const filterCategories = categories.filter((category) => !category.archivedAt || transactions.some((transaction) => transaction.category.id === category.id));
  const filtering = Boolean(search) || categoryFilter !== "all" || filter !== "all";
  const today = todayInShanghai();
  const defaultEntryDate = !month || month === today.slice(0, 7) ? today : `${month}-01`;

  function openNew() {
    if (!readOnly) setShowForm(true);
  }

  return (
    <AppShell actions={<><MonthSwitcher month={month} onChange={setMonth} /><Button onPress={openNew} isDisabled={readOnly || loading}><Icon name="plus" size={16} />记一笔</Button></>}>
      <div className="page-stack">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 reveal" aria-label="账目汇总">
          <MetricCard label={filtering ? "筛选后支出" : "当月支出"} value={loading ? "—" : formatMoney(totals.expenseCents)} detail="日常所需，也有心之所向" icon="expense" />
          <MetricCard label={filtering ? "筛选后收入" : "当月收入"} value={loading ? "—" : formatMoney(totals.incomeCents)} detail="每一份收获，都认真记下" icon="income" tone="income" />
          <MetricCard label={filtering ? "匹配的记录" : "当月记录"} value={<>{loading ? "—" : visibleTransactions.length}<span className="ml-1.5 text-xs font-normal tracking-normal text-muted">笔</span></>} detail={filtering ? `共 ${transactions.length} 笔账目，正在筛选` : "细碎的日常，清楚的来去"} icon="receipt" />
        </section>

        <Card className="panel transaction-filter-panel reveal reveal-delay-1">
          <div className="transaction-filters">
            <Segment aria-label="账目类型" size="sm" selectedKey={filter} onSelectionChange={(key) => { if (key === "all" || key === "expense" || key === "income") setFilter(key); }} className="transaction-type-filter w-fit">
              <Segment.Item id="all" className="px-4">全部账目</Segment.Item><Segment.Item id="expense" className="px-4">支出</Segment.Item><Segment.Item id="income" className="px-4">收入</Segment.Item>
            </Segment>
            <SearchField aria-label="搜索账目" value={search} onChange={setSearch} className="transaction-search"><SearchField.Group className="bg-surface-secondary"><SearchField.SearchIcon /><SearchField.Input placeholder="搜索备注、分类或订阅" className="text-xs" /><SearchField.ClearButton /></SearchField.Group></SearchField>
            <Select aria-label="按分类筛选" className="transaction-category-filter" variant="secondary" value={categoryFilter} onChange={(value) => { if (typeof value === "string") setCategoryFilter(value); }}>
              <Select.Trigger className="h-10 rounded-[11px]"><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover className="ledger-select-popover">
                <ListBox aria-label="账目分类" className="max-h-64 overflow-y-auto">
                  <ListBox.Item id="all" textValue="所有分类">所有分类<ListBox.ItemIndicator /></ListBox.Item>
                  {filterCategories.map((category) => <ListBox.Item id={category.id} key={category.id} textValue={`${category.name}${category.archivedAt ? "（已停用）" : ""}`}>{category.name}{category.archivedAt ? "（已停用）" : ""}<ListBox.ItemIndicator /></ListBox.Item>)}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          {filtering && <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted">正在筛选</span>{filter !== "all" && <Chip size="sm" variant="soft"><Chip.Label>{filter === "expense" ? "支出" : "收入"}</Chip.Label></Chip>}{categoryFilter !== "all" && <Chip size="sm" variant="soft"><Chip.Label>{categories.find((item) => item.id === categoryFilter)?.name || "已选分类"}</Chip.Label></Chip>}{search && <Chip size="sm" variant="soft"><Chip.Label>“{search}”</Chip.Label></Chip>}<Button size="sm" variant="ghost" className="h-7 text-xs text-accent" onPress={() => { setFilter("all"); setCategoryFilter("all"); setSearch(""); }}>清除筛选</Button></div>}
        </Card>

        {readOnly && <Alert status="warning"><Alert.Indicator /><Alert.Content><Alert.Title>这个月的账目已结算</Alert.Title><Alert.Description>记录已暂时锁定。如需修改，可先在月度回顾中重新打开。</Alert.Description><Link className="text-link mt-3" href={`/settlements?month=${month}`}>查看月度回顾<Icon name="arrow" size={13} /></Link></Alert.Content></Alert>}
        {loading ? <div className="flex flex-col gap-4" aria-busy="true" aria-label="正在读取账目">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-[20px]" />)}</div> : error ? <Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Title>{error}</Alert.Title><Button size="sm" variant="outline" onPress={reload} className="mt-3">重新加载</Button></Alert.Content></Alert> : !grouped.length ? (
          <Card className="panel"><EmptyState className="py-12"><EmptyState.Media variant="icon"><Icon name={transactions.length ? "search" : "receipt"} size={24} /></EmptyState.Media><EmptyState.Header><EmptyState.Title>{transactions.length ? "暂时没找到这笔记录" : "这个月，还是一张新纸"}</EmptyState.Title><EmptyState.Description>{transactions.length ? "换一个关键词，或者清除筛选再看看。" : "从一顿早餐或一次出行开始，记下生活的样子。"}</EmptyState.Description></EmptyState.Header><EmptyState.Content>{transactions.length ? <Button variant="outline" onPress={() => { setFilter("all"); setCategoryFilter("all"); setSearch(""); }}>清除筛选</Button> : !readOnly && <Button onPress={openNew}>记下第一笔</Button>}</EmptyState.Content></EmptyState></Card>
        ) : (
          <div className="flex flex-col gap-6 reveal reveal-delay-2">
            {grouped.map((group) => <section key={group.date}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1"><div className="flex items-center gap-3"><h2 className="text-xs font-medium">{dateLabel(group.date)}</h2><span className="text-[10px] tabular-nums text-muted">{group.items.length} 笔</span></div><div className="flex gap-4 text-[11px] tabular-nums text-muted">{group.expenseCents > 0 && <span>支出 <b className="ml-1 font-medium text-foreground">{formatMoney(group.expenseCents)}</b></span>}{group.incomeCents > 0 && <span>收入 <b className="ml-1 font-medium text-success">{formatMoney(group.incomeCents)}</b></span>}</div></div>
              <Card className="divide-y divide-separator rounded-[20px] p-0">
                {group.items.map((transaction) => {
                  const palette = categoryColors.get(transaction.category.id) ?? getCategoryColor(transaction.category.id);
                  const isIncome = transaction.type === "INCOME";
                  return <div className="transaction-row" key={transaction.id}>
                    <div className="flex min-w-0 items-center gap-3"><span className="category-symbol" style={{ color: isIncome ? "var(--success)" : palette.color, background: isIncome ? "var(--success-soft)" : palette.surface }}><CategoryIcon categoryName={transaction.category.name} type={transaction.type} icon={transaction.category.icon} size={18} /></span><div className="transaction-copy"><strong title={transaction.note || transaction.category.name}>{transaction.note || transaction.category.name}</strong><p>{transaction.category.name}{transaction.source === "SUBSCRIPTION" ? ` · 自动记录${transaction.subscription?.name ? ` / ${transaction.subscription.name}` : ""}` : " · 手动记录"}</p></div></div>
                    <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-6"><span className={`transaction-value ${isIncome ? "text-success" : ""}`}>{isIncome ? "+" : "−"}{formatMoney(transaction.amountCents)}</span>{!readOnly && <div className="flex items-center gap-1"><IconButton size="sm" icon="edit" label={`编辑${transaction.note || transaction.category.name}`} onPress={() => setEditing(transaction)} /><IconButton size="sm" icon="trash" label={`删除${transaction.note || transaction.category.name}`} className="text-muted hover:text-danger" isDisabled={Boolean(deletingId)} onPress={() => setPendingDelete(transaction)} /></div>}</div>
                  </div>;
                })}
              </Card>
            </section>)}
            <p className="text-center text-[11px] text-muted">已显示全部 {visibleTransactions.length} 笔记录</p>
          </div>
        )}
      </div>
      {(showForm || editing) && !readOnly && <TransactionForm categories={categories} transaction={editing} defaultDate={defaultEntryDate} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); reload(); }} />}
      {pendingDelete && <ConfirmDialog title="删除这笔记录？" description={`「${pendingDelete.note || pendingDelete.category.name}」将从账本中移除。删除后 5 秒内可以撤销，月度统计也会同步更新。`} confirmLabel="删除记录" danger busy={Boolean(deletingId)} onConfirm={() => void remove(pendingDelete)} onClose={() => setPendingDelete(null)} />}
      {undoId && <Toast message="记录已删除" action="撤销" onAction={() => void undo()} />}
      {!undoId && message && <Toast message={message} />}
    </AppShell>
  );
}
