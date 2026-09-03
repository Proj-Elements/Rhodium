"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icon";
import { MonthSwitcher } from "@/components/month-switcher";
import { formatMoney, monthStart, todayInShanghai } from "@/lib/domain";

type Summary = {
  month: string;
  budgetCents: number | null;
  expenseCents: number;
  incomeCents: number;
  remainingCents: number | null;
  dailyAverageCents: number;
  dailyBreakdown: { date: string; expenseCents: number; incomeCents: number; transactionCount: number }[];
  topCategory: { name: string; amountCents: number } | null;
  topDate: { date: string; amountCents: number } | null;
  subscriptionExpenseCents: number;
  transactionCount: number;
  settlement: { settledAt: string; reopenedAt: string | null } | null;
};

type Status = "past" | "current" | "future";

function monthLabel(month: string) {
  const [year, value] = month.split("-");
  return `${year} 年 ${Number(value)} 月`;
}

function shortMonth(month: string) {
  return month.slice(5);
}

function getStatus(month: string): Status {
  const current = todayInShanghai().slice(0, 7);
  return month < current ? "past" : month > current ? "future" : "current";
}

function Toast({ message }: { message: string }) {
  return <div className="undo-toast" role="status" aria-live="polite">{message}</div>;
}

function formatCalendarMoney(cents: number) {
  if (cents === 0) return "";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
}

function DailyCalendar({ month, days }: { month: string; days: Summary["dailyBreakdown"] }) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const firstDay = (monthStart(month).getUTCDay() + 6) % 7;
  const maxExpense = Math.max(...days.map((day) => day.expenseCents), 1);
  const today = todayInShanghai();
  const cells = Array.from({ length: firstDay }, (_, index) => <span className="calendar-empty" key={`empty-${index}`} aria-hidden="true" />);
  return <div className="calendar-shell">
    <div className="calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="daily-calendar" onMouseLeave={() => setActiveDate(null)}>
      {cells}
      {days.map((day) => {
        const dayNumber = Number(day.date.slice(-2));
        const hasData = day.expenseCents > 0 || day.incomeCents > 0;
        const intensity = day.expenseCents ? .08 + (day.expenseCents / maxExpense) * .22 : 0;
        const cellIndex = firstDay + dayNumber - 1;
        const column = cellIndex % 7;
        const row = Math.floor(cellIndex / 7);
        const tooltipClass = `${column === 0 ? " edge-left" : ""}${column === 6 ? " edge-right" : ""}${row === 0 ? " below" : ""}`;
        return <button type="button" className={`calendar-day${hasData ? " has-data" : ""}${day.date === today ? " today" : ""}${activeDate === day.date ? " is-active" : ""}`} key={day.date} onMouseEnter={() => setActiveDate(day.date)} onFocus={() => setActiveDate(day.date)} onBlur={() => setActiveDate(null)} aria-label={`${day.date}，支出 ${formatMoney(day.expenseCents)}，收入 ${formatMoney(day.incomeCents)}，${day.transactionCount} 笔记录`} style={{ "--day-expense": intensity } as CSSProperties}>
          <span className="calendar-day-number">{dayNumber}</span>
          {hasData && <span className="calendar-day-summary"><span className="calendar-day-expense">{formatCalendarMoney(day.expenseCents)}</span>{day.incomeCents > 0 && <span className="calendar-day-income">+{formatCalendarMoney(day.incomeCents)}</span>}</span>}
          {activeDate === day.date && <span className={`calendar-tooltip${tooltipClass}`} role="status"><strong>{day.date.slice(5).replace("-", "/")}</strong><span className="expense">支出 {formatMoney(day.expenseCents)}</span><span className="income">收入 {formatMoney(day.incomeCents)}</span><small>{day.transactionCount} 笔记录</small></span>}
        </button>;
      })}
    </div>
  </div>;
}

export default function SettlementsPage() {
  const [month, setMonth] = useState(todayInShanghai().slice(0, 7));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = getStatus(month);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [currentResponse, trendResponse] = await Promise.all([
        fetch(`/api/settlements/${month}`),
        fetch(`/api/settlements?end=${month}`),
      ]);
      const current = await currentResponse.json().catch(() => ({}));
      const trendResult = await trendResponse.json().catch(() => ({}));
      if (!currentResponse.ok) throw new Error(current.error || "暂时无法读取本月回顾");
      if (!trendResponse.ok) throw new Error(trendResult.error || "暂时无法读取历史趋势");
      setSummary(current.summary);
      setTrend(trendResult.summaries || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "暂时无法读取月度回顾");
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on month change
  useEffect(() => {
    const requestedMonth = new URLSearchParams(window.location.search).get("month");
    if (requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) setMonth(requestedMonth);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on month change
  }, [month]);

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2600);
  }

  async function settle() {
    if (status === "future" || busy) return;
    if (!window.confirm(`确认结算${monthLabel(month)}吗？结算后该月账目会暂时变为只读。`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/settlements/${month}/settle`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "结算失败，请稍后重试");
      flash("本月已结算");
      await load();
    } catch (settleError) {
      flash(settleError instanceof Error ? settleError.message : "结算失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/settlements/${month}/reopen`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "重新打开失败，请稍后重试");
      flash("本月已重新打开");
      await load();
    } catch (reopenError) {
      flash(reopenError instanceof Error ? reopenError.message : "重新打开失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  const settled = Boolean(summary?.settlement && !summary.settlement.reopenedAt);
  const maxTrend = Math.max(...trend.map((item) => item.expenseCents), 1);
  const netCents = summary ? summary.incomeCents - summary.expenseCents : 0;
  const settledAt = summary?.settlement?.settledAt ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(summary.settlement.settledAt)) : "";
  const statusText = status === "future" ? "未来月份" : settled ? "已结算" : "待结算";

  const trendDescription = useMemo(() => trend.length ? `${shortMonth(trend[0].month)} — ${shortMonth(trend[trend.length - 1].month)} · 对比每月总额` : "还没有历史支出", [trend]);

  return <AppShell>
    <div className="toolbar"><span className="toolbar-note"><Icon name="calendar" size={14} /><span>{status === "current" ? "正在查看本月" : status === "past" ? "历史账本" : "提前看看未来"}</span></span><MonthSwitcher month={month} onChange={setMonth} /></div>
    {loading ? <div className="loading">正在计算本月结算…</div> : error ? <div className="inline-error"><strong>{error}</strong><button type="button" className="button button-secondary button-small" onClick={() => void load()}>再试一次</button></div> : !summary ? <div className="inline-error">暂时没有可显示的月度回顾。</div> : <>
      <div className="summary-head"><div><h2>{monthLabel(month)}</h2><span className="summary-status"><i className={`status-dot ${settled ? "done" : status === "future" ? "pending" : ""}`} />{statusText}</span>{settledAt && <p className="summary-date">快照保存于 {settledAt}</p>}</div><div>{status === "future" ? <button type="button" className="button button-secondary" disabled>未来月份不可结算</button> : settled ? <button type="button" className="button button-secondary" onClick={() => void reopen()} disabled={busy}>重新打开</button> : <button type="button" className="button button-primary" onClick={() => void settle()} disabled={busy}><Icon name="check" size={16} />完成结算</button>}</div></div>
      <div className="summary-grid"><div className="card summary-stat"><p className="card-label">MONTHLY BUDGET</p><strong>{summary.budgetCents === null ? "尚未设置" : formatMoney(summary.budgetCents)}</strong><span>本月计划边界</span></div><div className="card summary-stat"><p className="card-label">SPENT</p><strong className="expense">{formatMoney(summary.expenseCents)}</strong><span>{summary.transactionCount} 笔支出</span></div><div className="card summary-stat"><p className="card-label">REMAINING</p><strong className={summary.remainingCents !== null && summary.remainingCents < 0 ? "negative" : summary.remainingCents !== null ? "income" : ""}>{summary.remainingCents === null ? "—" : formatMoney(summary.remainingCents)}</strong><span>收入另计 {formatMoney(summary.incomeCents)}</span></div><div className="card summary-stat"><p className="card-label">NET FLOW</p><strong className={netCents < 0 ? "negative" : "income"}>{netCents >= 0 ? "+" : "−"}{formatMoney(Math.abs(netCents))}</strong><span>收入减去本月支出</span></div></div>
      <section className="card calendar-card"><div className="section-heading"><div><h3>每天花了多少</h3><p>移到日期上查看当天的支出、收入和记录笔数。</p></div><div className="calendar-legend"><span><i className="expense" />支出</span><span><i className="income" />收入</span></div></div><DailyCalendar month={month} days={summary.dailyBreakdown} /></section>
      <div className="review-grid"><section className="card review-card"><h3>这个月的几个数字</h3><div className="review-line"><span>固定支出</span><strong>{formatMoney(summary.subscriptionExpenseCents)}</strong></div><div className="review-line"><span>花得最多的分类</span><strong>{summary.topCategory ? `${summary.topCategory.name} · ${formatMoney(summary.topCategory.amountCents)}` : "—"}</strong></div><div className="review-line"><span>花得最多的一天</span><strong>{summary.topDate ? `${summary.topDate.date.slice(5)} · ${formatMoney(summary.topDate.amountCents)}` : "—"}</strong></div></section><section className="card review-card"><div className="section-heading"><div><h3>近 6 个月支出</h3><p>{trendDescription}</p></div></div><div className="trend-chart" aria-label="近六个月支出柱状图">{trend.map((item) => <div className={`trend-column${item.month === month ? " current" : ""}`} key={item.month} title={`${monthLabel(item.month)}：${formatMoney(item.expenseCents)}`}><span style={{ height: `${Math.max(5, (item.expenseCents / maxTrend) * 92)}px` }} /><small>{shortMonth(item.month)}</small><em>{formatMoney(item.expenseCents)}</em></div>)}</div></section></div>
      <div className="settle-panel"><div><strong>{status === "future" ? "这个月还没开始" : settled ? "这份月度快照已经保存" : "给这个月一个收尾"}</strong><p>{status === "future" ? "账目会在对应月份发生后出现在这里。" : settled ? "如果之后有新账目，可以重新打开并再次结算。" : "确认后会保存预算、支出、收入和剩余金额的快照。"}</p></div><Link className="button button-secondary" href={`/transactions?month=${month}`}>查看本月账目 <Icon name="arrow" size={14} /></Link></div>
    </>}
    {message && <Toast message={message} />}
  </AppShell>;
}
