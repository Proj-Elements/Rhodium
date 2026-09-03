"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { CategoryIcon, Icon } from "@/components/icon";
import { MonthSwitcher } from "@/components/month-switcher";
import { Toast, useFlash } from "@/components/toast";
import { TransactionForm } from "@/components/transaction-form";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { getCategoryColor } from "@/lib/category-colors";
import { dateLabel, formatMoney, todayInShanghai } from "@/lib/domain";
import { CategoryDTO, DashboardDTO } from "@/lib/types";

function formatShortDate(value: string) {
  return value.slice(5).replace("-", "/");
}

function SpendingChart({ days }: { days: DashboardDTO["recentExpenses"] }) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  if (!days.length) return <div className="chart-empty">还没有足够的数据，记下第一笔就能看到节奏。</div>;

  const max = Math.max(...days.map((day) => day.amountCents), 1);
  const points = days.map((day, index) => ({
    ...day,
    x: (index / Math.max(days.length - 1, 1)) * 100,
    y: 150 - (day.amountCents / max) * 122,
  }));
  const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `0,150 ${pointString} 100,150`;
  const activePoint = points.find((point) => point.date === activeDate) || null;
  const tooltipClass = activePoint ? `${activePoint.x <= 12 ? " edge-left" : activePoint.x >= 88 ? " edge-right" : ""}${activePoint.y < 70 ? " below" : ""}` : "";
  return <div className="chart-wrap">
    <div className="chart-plot" onMouseLeave={() => setActiveDate(null)}>
      <svg className="chart-svg" viewBox="0 0 100 170" preserveAspectRatio="none" aria-hidden="true">
        <line className="chart-grid-line" x1="0" y1="28" x2="100" y2="28" />
        <line className="chart-grid-line" x1="0" y1="89" x2="100" y2="89" />
        <line className="chart-grid-line" x1="0" y1="150" x2="100" y2="150" />
        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={pointString} />
      </svg>
      {points.map((point) => <span className="chart-point" key={point.date} role="button" tabIndex={0} aria-label={`${formatShortDate(point.date)}，支出 ${formatMoney(point.amountCents)}，收入 ${formatMoney(point.incomeCents)}`} onMouseEnter={() => setActiveDate(point.date)} onFocus={() => setActiveDate(point.date)} onBlur={() => setActiveDate(null)} onKeyDown={(event) => { if (event.key === "Escape") setActiveDate(null); }} style={{ left: `${point.x}%`, top: `${(point.y / 170) * 100}%` }} />)}
      {activePoint && <div className={`chart-tooltip${tooltipClass}`} style={{ left: `${activePoint.x}%`, top: `${(activePoint.y / 170) * 100}%` }} role="status"><strong>{formatShortDate(activePoint.date)}</strong><span className="expense"><i />支出 {formatMoney(activePoint.amountCents)}</span><span className="income"><i />收入 {formatMoney(activePoint.incomeCents)}</span></div>}
    </div>
    <div className="chart-labels">{days.map((day) => <span key={day.date}>{formatShortDate(day.date)}</span>)}</div>
    <div className="chart-caption"><span>最高的一天</span><strong>{formatMoney(Math.max(...days.map((day) => day.amountCents)))}</strong></div>
  </div>;
}

export default function DashboardPage() {
  const [month, setMonthRaw] = useState(todayInShanghai().slice(0, 7));
  const [reloadToken, setReloadToken] = useState(0);
  // A reload token lets any handler refetch without month changing.
  const setMonth = (next: string) => { setMonthRaw(next); };
  const reload = () => setReloadToken((token) => token + 1);
  const [data, setData] = useState<DashboardDTO | null>(null);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetEditing, setBudgetEditing] = useState(false);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const { message, flash } = useFlash();

  useEffect(() => {
    // AbortController prevents stale responses from overwriting fresh ones
    // when the user switches months quickly.
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [dashboard, categoryResult] = await Promise.all([
          apiFetch<DashboardDTO>(`/api/dashboard?month=${month}`, { signal: controller.signal }),
          apiFetch<{ categories: CategoryDTO[] }>("/api/categories", { signal: controller.signal }),
        ]);
        setData(dashboard);
        setCategories(categoryResult.categories || []);
        setBudgetInput(dashboard.budget ? (dashboard.budget.amountCents / 100).toFixed(2) : "");
        setBudgetEditing(false);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(errorMessage(loadError, "暂时无法打开仪表盘"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [month, reloadToken]);

  async function saveBudget() {
    if (!budgetInput.trim()) {
      flash("先输入一个预算金额");
      return;
    }
    setBudgetSaving(true);
    try {
      await apiFetch(`/api/budgets/${month}`, { method: "PUT", json: { amount: budgetInput } });
      flash("预算已更新");
      setBudgetEditing(false);
      reload();
    } catch (saveError) {
      flash(errorMessage(saveError, "预算保存失败"));
    } finally {
      setBudgetSaving(false);
    }
  }

  const greeting = useMemo(() => new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Shanghai",
  }).format(new Date()), []);

  const remainingDays = data ? Math.max(data.daysInMonth - data.daysElapsed, 0) : 0;
  const dailyAllowance = data?.budget && data.monthStatus === "current" ? Math.round(Math.max(data.remainingCents ?? 0, 0) / Math.max(remainingDays, 1)) : null;
  const focusDateLabel = data?.monthStatus === "future" ? "未开始" : data && data.focusDate === data.today ? "今天" : data ? dateLabel(data.focusDate) : "";
  const chartTitle = data?.monthStatus === "future" ? "月初预览" : "最近 7 天";

  return <AppShell>
    <div className="toolbar">
      <span className="toolbar-note"><Icon name="spark" size={14} /><span>{data?.monthStatus === "past" ? "正在回看历史月份" : data?.monthStatus === "future" ? "正在预览未来月份" : greeting}</span></span>
      <MonthSwitcher month={month} onChange={setMonth} />
    </div>

    {loading ? <div className="loading">正在打开你的账本…</div> : error ? <div className="inline-error"><strong>{error}</strong><button className="button button-secondary button-small" onClick={reload}>再试一次</button></div> : !data ? null : <>
      <section className="dashboard-top" aria-label="本月概览">
        <div className="balance-card">
          <div>
            <p className="card-label">REMAINING THIS MONTH</p>
            <h2 className={data.remainingCents !== null && data.remainingCents < 0 ? "negative" : ""}>{data.remainingCents === null ? "尚未设置" : formatMoney(data.remainingCents)}</h2>
          </div>
          <div>
            <div className="balance-card-meta"><span>{data.remainingCents !== null && data.remainingCents < 0 ? `已超支 ${formatMoney(Math.abs(data.remainingCents))}` : `已花 ${formatMoney(data.expenseCents)}`}<strong>{data.budget ? `预算 ${formatMoney(data.budget.amountCents)}` : "先设置一个预算"}</strong></span><span className="balance-percent">{data.usagePercent === null ? "—" : `${data.usagePercent}%`}</span></div>
            <div className="progress-track" aria-label={data.usagePercent === null ? "尚未设置预算" : `预算使用 ${data.usagePercent}%`}><span style={{ width: `${Math.min(Math.max(data.usagePercent ?? 0, 0), 100)}%` }} /></div>
          </div>
        </div>
        <div className="card stat-card"><span className="stat-icon"><Icon name="expense" size={17} /></span><div><p className="card-label">{focusDateLabel.toUpperCase()}</p><div className="stat-value expense">{formatMoney(data.focusDateExpenseCents)}</div><div className="stat-sub">{data.focusDate === data.today ? "今天的每一笔支出" : `${data.focusDate} 的支出`}{data.focusDateIncomeCents > 0 && <><br />收入 <strong className="income">+{formatMoney(data.focusDateIncomeCents)}</strong></>}</div></div></div>
        <div className="card stat-card"><span className="stat-icon"><Icon name="expense" size={17} /></span><div><p className="card-label">MONTHLY SPENDING</p><div className="stat-value expense">{formatMoney(data.expenseCents)}</div><div className="stat-sub">收入 <strong className="income">+{formatMoney(data.incomeCents)}</strong> · 共 {data.transactionCount} 笔</div></div></div>
        <div className="card stat-card"><span className="stat-icon"><Icon name="receipt" size={17} /></span><div><p className="card-label">RECORDED</p><div className="stat-value">{data.transactionCount}<span className="stat-unit"> 笔</span></div><div className="stat-sub">支出 {data.expenseTransactionCount} 笔 · 收入 {data.transactionCount - data.expenseTransactionCount} 笔</div></div></div>
      </section>

      <div className={`budget-prompt${data.remainingCents !== null && data.remainingCents < 0 ? " is-warning" : ""}`}>
        <div className="budget-copy">
          <strong>{data.monthStatus === "future" ? "提前为这个月设一个预算" : !data.budget ? "给这个月设一个预算" : data.remainingCents !== null && data.remainingCents < 0 ? "预算已经超出，先看见它" : `本月预算 ${formatMoney(data.budget.amountCents)}`}</strong>
          <span>{data.monthStatus === "future" ? "先设下边界，等月份开始后再慢慢记录。" : !data.budget ? "先有一个边界，月底才知道余量。" : data.remainingCents !== null && data.remainingCents < 0 ? "不用责备自己，调整接下来的节奏就好。" : "预算可以随着生活变化调整。"}</span>
        </div>
        {data.budget && dailyAllowance !== null && <div className="budget-pace"><strong>{formatMoney(dailyAllowance)} / 天</strong>剩余天数的可用节奏</div>}
        {data.budget && !budgetEditing ? <button type="button" className="button button-secondary button-small budget-edit-button" onClick={() => setBudgetEditing(true)}><Icon name="edit" size={14} />修改本月预算</button> : <div className="inline-budget"><input className="form-control" inputMode="decimal" aria-label="本月预算金额" placeholder="例如 3000" value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} /><button type="button" className={`button ${data.budget ? "button-secondary" : "button-primary"} button-small`} onClick={() => void saveBudget()} disabled={budgetSaving}>{budgetSaving ? "保存中" : data.budget ? "更新预算" : "设置预算"}</button>{data.budget && <button type="button" className="button button-quiet button-small" onClick={() => setBudgetEditing(false)} disabled={budgetSaving}>取消</button>}</div>}
      </div>

      <div className="dashboard-grid">
        <section className="card chart-card"><div className="section-heading"><div><h2>{chartTitle}</h2><p>{data.monthStatus === "future" ? "月份开始后，这里会记录每天的花销。" : "花销的节奏，比总额更早提醒你。"}</p></div><Link className="text-link" href={`/transactions?month=${month}`}>查看全部 <Icon name="arrow" size={14} /></Link></div><SpendingChart days={data.recentExpenses} /></section>
        <section className="card category-card"><div className="section-heading"><div><h2>本月花销去向</h2><p>{data.categoryBreakdown.length ? `${data.categoryBreakdown.length} 个分类 · 按金额排序` : "还没有分类数据"}</p></div></div>{data.categoryBreakdown.length === 0 ? <div className="empty-state">本月还没有支出。<Link className="text-link" href={`/transactions?month=${month}&new=1`}>记下第一笔 <Icon name="arrow" size={13} /></Link></div> : <div className="category-list-rows">{data.categoryBreakdown.slice(0, 5).map((category, index) => { const percent = data.expenseCents ? Math.round((category.amountCents / data.expenseCents) * 100) : 0; const palette = getCategoryColor(category.categoryId); return <div key={category.categoryId}><div className="category-row"><span className="category-rank">0{index + 1}</span><span className="category-dot" style={{ background: palette.color }} /><span className="category-name">{category.categoryName}</span><span className="category-amount">{formatMoney(category.amountCents)}</span><span className="category-percent">{percent}%</span></div><div className="category-bar"><span style={{ width: `${percent}%`, background: palette.color }} /></div></div>; })}{data.categoryBreakdown.length > 5 && <p className="category-more">还有 {data.categoryBreakdown.length - 5} 个分类没有展开</p>}</div>}</section>
      </div>

      <section className="card recent-card"><div className="section-heading"><div><h2>最近记下的</h2><p>把小额支出记下来，月末回看就不会模糊。</p></div><button type="button" className="button button-secondary button-small" onClick={() => setShowForm(true)}><Icon name="plus" size={14} />添加记录</button></div><div className="transaction-list">{data.recentTransactions.length === 0 ? <div className="empty-state"><strong>还没有账目</strong>从一杯早餐咖啡开始记录吧。<button type="button" className="button button-primary button-small" onClick={() => setShowForm(true)}>开始记录</button></div> : data.recentTransactions.map((transaction) => { const palette = getCategoryColor(transaction.category.id); return <div className="transaction-item" key={transaction.id}><span className={`transaction-symbol${transaction.type === "INCOME" ? " income-symbol" : " expense-symbol"}`} style={transaction.type === "INCOME" ? undefined : { color: palette.color, backgroundColor: palette.surface }}><CategoryIcon categoryName={transaction.category.name} type={transaction.type} size={16} /></span><div className="transaction-main"><strong>{transaction.note || transaction.category.name}{transaction.source === "SUBSCRIPTION" && <span className="source-badge">订阅</span>}</strong><span>{transaction.category.name} · {transaction.occurredOn}</span></div><span className={`transaction-amount ${transaction.type === "INCOME" ? "income" : "expense"}`}>{transaction.type === "INCOME" ? "+" : "−"}{formatMoney(transaction.amountCents)}</span></div>; })}</div></section>
    </>}
    {showForm && data && <TransactionForm categories={categories} defaultDate={data.focusDate} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); reload(); }} />}
    {message && <Toast message={message} />}
  </AppShell>;
}
