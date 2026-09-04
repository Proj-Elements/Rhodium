"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { CategoryIcon, Icon } from "@/components/icon";
import { MonthSwitcher } from "@/components/month-switcher";
import { Toast, useFlash } from "@/components/toast";
import { TransactionForm } from "@/components/transaction-form";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { getCategoryColor } from "@/lib/category-colors";
import { dateLabel, formatMoney, todayInShanghai } from "@/lib/domain";
import { CategoryDTO, TransactionDTO } from "@/lib/types";

type TransactionFilter = "all" | "expense" | "income";

type DateGroup = {
  date: string;
  items: TransactionDTO[];
  expenseCents: number;
  incomeCents: number;
};

type TransactionsPayload = { month: string; readOnly: boolean; transactions: TransactionDTO[] };

export default function TransactionsPage() {
  const [month, setMonth] = useState(todayInShanghai().slice(0, 7));
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const undoTimer = useRef<number | null>(null);
  const { message, flash } = useFlash();

  const reload = () => setReloadToken((token) => token + 1);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const [transactionResult, categoryResult] = await Promise.all([
        apiFetch<TransactionsPayload>(`/api/transactions?month=${month}&type=${filter === "all" ? "" : filter}`, { signal }),
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
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on month/filter change
  }, [month, filter, reloadToken]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMonth = params.get("month");
    if (requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) setMonth(requestedMonth);
    if (params.get("new") === "1") setShowForm(true);
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
  }, []);

  async function remove(transaction: TransactionDTO) {
    if (deletingId) return;
    if (!window.confirm(`删除「${transaction.note || transaction.category.name}」？删除后可以在几秒内撤销。`)) return;
    setDeletingId(transaction.id);
    try {
      await apiFetch(`/api/transactions/${transaction.id}`, { method: "DELETE" });
      setTransactions((items) => items.filter((item) => item.id !== transaction.id));
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
      const matchesCategory = categoryFilter === "all" || transaction.category.id === categoryFilter;
      if (!matchesCategory) return false;
      if (!query) return true;
      const haystack = [transaction.note || "", transaction.category.name, transaction.subscription?.name || ""].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [transactions, search, categoryFilter]);

  const grouped = useMemo<DateGroup[]>(() => {
    const groups = new Map<string, DateGroup>();
    visibleTransactions.forEach((transaction) => {
      const group = groups.get(transaction.occurredOn) || { date: transaction.occurredOn, items: [], expenseCents: 0, incomeCents: 0 };
      group.items.push(transaction);
      if (transaction.type === "INCOME") group.incomeCents += transaction.amountCents;
      else group.expenseCents += transaction.amountCents;
      groups.set(transaction.occurredOn, group);
    });
    return [...groups.values()];
  }, [visibleTransactions]);

  const totals = useMemo(() => visibleTransactions.reduce((result, transaction) => {
    if (transaction.type === "INCOME") result.incomeCents += transaction.amountCents;
    else result.expenseCents += transaction.amountCents;
    return result;
  }, { expenseCents: 0, incomeCents: 0 }), [visibleTransactions]);

  const activeCategories = categories.filter((category) => !category.archivedAt);
  const today = todayInShanghai();
  const defaultEntryDate = month === today.slice(0, 7) ? today : `${month}-01`;

  function openNew() {
    if (!readOnly) setShowForm(true);
  }

  return <AppShell>
    <div className="toolbar">
      <span className="toolbar-note"><Icon name="receipt" size={14} /><span>共 {transactions.length} 笔记录</span></span>
      <MonthSwitcher month={month} onChange={setMonth} />
    </div>

    <div className="ledger-toolbar">
      <div className="filter-tabs" role="group" aria-label="账目类型">
        {(["all", "expense", "income"] as const).map((value) => <button type="button" aria-pressed={filter === value} className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{value === "all" ? "全部" : value === "expense" ? "支出" : "收入"}</button>)}
      </div>
      <input className="form-control search-control" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索备注或分类" aria-label="搜索账目" />
      <select className="form-control filter-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="按分类筛选">
        <option value="all">所有分类</option>
        {activeCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
      </select>
    </div>

    <div className="ledger-summary">
      <div className="summary-chip expense"><span>{search || categoryFilter !== "all" ? "筛选后支出" : "本月支出"}</span><strong>{formatMoney(totals.expenseCents)}</strong></div>
      <div className="summary-chip income"><span>{search || categoryFilter !== "all" ? "筛选后收入" : "本月收入"}</span><strong>+{formatMoney(totals.incomeCents)}</strong></div>
      <div className="summary-chip"><span>已显示</span><strong>{visibleTransactions.length} 笔</strong></div>
    </div>

    {readOnly && <div className="readonly-banner"><div><strong>本月已结算，账目暂时只读</strong><span>重新打开本月后，才能添加、编辑或删除记录。</span></div><Link className="button button-secondary button-small" href={`/settlements?month=${month}`}>查看月度回顾 <Icon name="arrow" size={13} /></Link></div>}
    {loading ? <div className="loading">正在整理账目…</div> : error ? <div className="inline-error"><strong>{error}</strong><button className="button button-secondary button-small" onClick={reload}>再试一次</button></div> : grouped.length === 0 ? <div className="card empty-state"><strong>{transactions.length === 0 ? "这个月还没有记录" : "没有找到匹配的账目"}</strong><span>{transactions.length === 0 ? "记下一笔早餐、交通，或者一笔兼职收入。" : "试试换一个关键词、分类，或清除筛选。"}</span>{transactions.length === 0 && !readOnly && <button type="button" className="button button-primary button-small" onClick={openNew}><Icon name="plus" size={14} />记下第一笔</button>}</div> : grouped.map((group) => <section className="date-group" key={group.date}>
      <div className="date-group-title"><strong>{dateLabel(group.date)}</strong><span>{group.date}</span><span className="date-group-total">{group.expenseCents > 0 && <span className="expense">支出 {formatMoney(group.expenseCents)}</span>}{group.incomeCents > 0 && <span className="income"> · 收入 {formatMoney(group.incomeCents)}</span>}</span></div>
      <div className="card ledger-card">{group.items.map((transaction) => { const palette = getCategoryColor(transaction.category.id); return <div className="ledger-row" key={transaction.id}>
        <span className={`transaction-symbol${transaction.type === "INCOME" ? " income-symbol" : " expense-symbol"}`} style={transaction.type === "INCOME" ? undefined : { color: palette.color, backgroundColor: palette.surface }}><CategoryIcon categoryName={transaction.category.name} type={transaction.type} size={16} /></span>
        <div className="transaction-main"><strong>{transaction.note || transaction.category.name}{transaction.source === "SUBSCRIPTION" && <span className="source-badge">订阅自动记账</span>}</strong><span>{transaction.category.name}{transaction.subscription?.name ? ` · ${transaction.subscription.name}` : ""}</span></div>
        <span className={`transaction-amount ${transaction.type === "INCOME" ? "income" : "expense"}`}>{transaction.type === "INCOME" ? "+" : "−"}{formatMoney(transaction.amountCents)}</span>
        {!readOnly && <div className="ledger-actions"><button type="button" className="icon-button" onClick={() => setEditing(transaction)} aria-label={`编辑${transaction.note || transaction.category.name}`} title="编辑"><Icon name="edit" size={15} /></button><button type="button" className="icon-button danger" onClick={() => void remove(transaction)} disabled={deletingId === transaction.id} aria-label={`删除${transaction.note || transaction.category.name}`} title="删除"><Icon name="trash" size={15} /></button></div>}
      </div>; })}</div>
    </section>)}
    {!loading && !error && grouped.length > 0 && <button type="button" className="button button-primary" onClick={openNew} disabled={readOnly}><Icon name="plus" size={16} />{readOnly ? "本月已锁定" : "添加一笔"}</button>}
    {(showForm || editing) && !readOnly && <TransactionForm categories={categories} transaction={editing} defaultDate={defaultEntryDate} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); reload(); }} />}
    <div className="toast-stack">{undoId && <Toast message="记录已删除" action="撤销" onAction={() => void undo()} />}{message && <Toast message={message} />}</div>
  </AppShell>;
}
