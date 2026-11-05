"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Chip, Skeleton } from "@heroui/react";
import { BarChart } from "@heroui-pro/react/bar-chart";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MetricCard } from "@/components/metric-card";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icon";
import { MonthSwitcher } from "@/components/month-switcher";
import { Toast, useFlash } from "@/components/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatMoney, monthStart, todayInShanghai } from "@/lib/domain";
import { useToday } from "@/lib/use-today";

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
  expenseTransactionCount: number;
  settlement: { settledAt: string; reopenedAt: string | null } | null;
};

type Status = "past" | "current" | "future";

function monthLabel(month: string) {
  const [year, value] = month.split("-");
  return `${year} 年 ${Number(value)} 月`;
}

function shortMonth(month: string) {
  return `${Number(month.slice(5))}月`;
}

function getStatus(month: string, today: string): Status {
  const current = today.slice(0, 7);
  return month < current ? "past" : month > current ? "future" : "current";
}

const compactMoneyFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCalendarMoney(cents: number) {
  if (cents === 0) return "";
  return compactMoneyFormatter.format(cents / 100);
}

function DailyCalendar({ month, days }: { month: string; days: Summary["dailyBreakdown"] }) {
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const [previewDate, setPreviewDate] = useState<string | null>(null);
  const firstDay = (monthStart(month).getUTCDay() + 6) % 7;
  const maxExpense = Math.max(...days.map((day) => day.expenseCents), 1);
  const today = todayInShanghai();
  const selectedDay = days.find((day) => day.date === (previewDate || pinnedDate));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-7 gap-1.5 pb-1 text-center text-[11px] text-muted" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2" onMouseLeave={() => setPreviewDate(null)}>
        {Array.from({ length: firstDay }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
        {days.map((day) => {
          const ratio = Math.min(day.expenseCents / maxExpense, 1);
          const isToday = day.date === today;
          const pinned = pinnedDate === day.date;
          return <button type="button" key={day.date} aria-pressed={pinned} aria-label={`${day.date}，支出 ${formatMoney(day.expenseCents)}，收入 ${formatMoney(day.incomeCents)}，${day.transactionCount} 笔记录`}
            className={`flex min-h-[66px] min-w-0 flex-col items-start justify-between rounded-xl border p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus sm:min-h-[78px] sm:p-2.5 ${pinned ? "border-accent" : isToday ? "border-accent/40" : "border-transparent"}`}
            style={{ background: day.expenseCents > 0 ? `color-mix(in oklab, var(--accent) ${Math.round(6 + ratio * 22)}%, var(--surface-secondary))` : "var(--surface-secondary)" }}
            onClick={() => setPinnedDate((current) => current === day.date ? null : day.date)} onMouseEnter={() => setPreviewDate(day.date)} onFocus={() => setPreviewDate(day.date)} onBlur={() => setPreviewDate(null)}
            onKeyDown={(event) => { if (event.key === "Escape") { setPinnedDate(null); setPreviewDate(null); } }}>
            <span className="flex w-full items-center justify-between"><span className={`text-xs font-medium tabular-nums ${isToday ? "text-accent" : ""}`}>{Number(day.date.slice(-2))}</span>{day.incomeCents > 0 && <i className="size-1 shrink-0 rounded-full bg-success" />}</span>
            <span className="flex max-w-full flex-col text-[9px] leading-4 tabular-nums sm:text-[10px]">{day.expenseCents > 0 && <span className="truncate">{formatCalendarMoney(day.expenseCents)}</span>}{!day.expenseCents && day.incomeCents > 0 && <span className="truncate text-success">+{formatCalendarMoney(day.incomeCents)}</span>}</span>
          </button>;
        })}
      </div>
      <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-secondary px-3.5 py-3 text-[11px]" role="status" aria-live="polite">
        {selectedDay ? <><span className="tabular-nums text-muted">{selectedDay.date} · {selectedDay.transactionCount} 笔</span><span className="flex gap-4 tabular-nums"><span>支出 <b className="ml-1 font-medium">{formatMoney(selectedDay.expenseCents)}</b></span><span>收入 <b className="ml-1 font-medium text-success">{formatMoney(selectedDay.incomeCents)}</b></span></span></> : <span className="text-muted">点击日期可保留当日明细，再次点击取消选择。</span>}
      </div>
    </div>
  );
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function SettlementsPage() {
  const [month, setMonth] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const deepLinkHandled = useRef(false);
  const { message, flash } = useFlash();
  const today = useToday();
  const status = today && month ? getStatus(month, today) : null;

  const reload = () => setReloadToken((token) => token + 1);

  useEffect(() => {
    if (!deepLinkHandled.current) {
      deepLinkHandled.current = true;
      const requestedMonth = new URLSearchParams(window.location.search).get("month");
      setMonth(requestedMonth && MONTH_PATTERN.test(requestedMonth) ? requestedMonth : todayInShanghai().slice(0, 7));
      return;
    }
    if (!month) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await apiFetch<{ summaries: Summary[]; focus: Summary | null }>(
          `/api/settlements?end=${month}&include=focus`,
          { signal: controller.signal },
        );
        setSummary(result.focus ?? result.summaries.find((item) => item.month === month) ?? null);
        setTrend(result.summaries || []);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(errorMessage(loadError, "暂时无法读取月度回顾"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [month, reloadToken]);

  useEffect(() => {
    if (!month) return;
    const searchParam = `?month=${month}`;
    if (window.location.search !== searchParam) {
      window.history.replaceState(null, "", `${window.location.pathname}${searchParam}`);
    }
  }, [month]);

  async function settle() {
    if (!status || status === "future" || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/settlements/${month}/settle`, { method: "POST" });
      setConfirmSettle(false);
      flash("本月已结算");
      reload();
    } catch (settleError) {
      flash(errorMessage(settleError, "结算失败，请稍后重试"));
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/settlements/${month}/reopen`, { method: "POST" });
      flash("本月已重新打开");
      reload();
    } catch (reopenError) {
      flash(errorMessage(reopenError, "重新打开失败，请稍后重试"));
    } finally {
      setBusy(false);
    }
  }

  const settled = Boolean(summary?.settlement && !summary.settlement.reopenedAt);
  const netCents = summary ? summary.incomeCents - summary.expenseCents : 0;
  const settledAt = summary?.settlement?.settledAt
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        timeZone: "Asia/Shanghai",
      }).format(new Date(summary.settlement.settledAt))
    : "";
  const statusText = status === "future" ? "未来月份" : settled ? "已结算" : "待结算";

  const trendDescription = useMemo(
    () =>
      trend.length
        ? `${shortMonth(trend[0].month)} — ${shortMonth(trend[trend.length - 1].month)} · 对比每月支出总额`
        : "还没有历史支出",
    [trend],
  );

  const trendChartData = useMemo(
    () =>
      trend.map((item) => ({
        monthLabel: shortMonth(item.month),
        expenseYuan: Number((item.expenseCents / 100).toFixed(2)),
        incomeYuan: Number((item.incomeCents / 100).toFixed(2)),
      })),
    [trend],
  );

  return (
    <AppShell actions={<><MonthSwitcher month={month} onChange={setMonth} />{settled ? <Button variant="outline" onPress={() => void reopen()} isPending={busy}>重新打开</Button> : <Button onPress={() => setConfirmSettle(true)} isDisabled={loading || !summary || status === "future" || !status} isPending={busy}><Icon name="check" size={15} />完成结算</Button>}</>}>
      <div className="page-stack">
        {loading ? <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy="true" aria-label="正在读取月度回顾">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-40 rounded-[20px]" />)}<Skeleton className="col-span-2 h-96 rounded-[20px] lg:col-span-4" /></div> : error ? <Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Title>{error}</Alert.Title><Button variant="outline" size="sm" className="mt-3" onPress={reload}>重新加载</Button></Alert.Content></Alert> : !summary ? <Alert status="warning"><Alert.Indicator /><Alert.Content><Alert.Title>暂时没有可显示的月度回顾。</Alert.Title></Alert.Content></Alert> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><div className="flex flex-wrap items-center gap-3"><span className="font-medium tabular-nums">{monthLabel(month)} · 月度账本</span><Chip size="sm" variant="soft" color={settled ? "success" : "default"}><Chip.Label>{statusText}</Chip.Label></Chip><span className="text-[11px] text-muted">{settled && settledAt ? `快照保存于 ${settledAt}` : status === "future" ? "月份尚未开始，暂不可结算" : "确认结算后，将保存收支快照并锁定账目"}</span></div><Link href={`/transactions?month=${month}`} className="text-link">查看当月账目<Icon name="arrow" size={13} /></Link></div>
            <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 reveal" aria-label="月度汇总">
              <MetricCard label="月度预算" value={summary.budgetCents === null ? "未设置" : formatMoney(summary.budgetCents)} detail="为生活设定的舒适范围" icon="target" />
              <MetricCard label="当月支出" value={formatMoney(summary.expenseCents)} detail={`${summary.expenseTransactionCount} 笔支出 · 日均 ${formatMoney(summary.dailyAverageCents)}`} icon="expense" />
              <MetricCard label="预算余量" value={summary.remainingCents === null ? "—" : formatMoney(summary.remainingCents)} detail="月度预算减去总支出" icon="wallet" tone={summary.remainingCents !== null && summary.remainingCents < 0 ? "danger" : undefined} />
              <MetricCard label="当月净收支" value={`${netCents >= 0 ? "+" : "−"}${formatMoney(Math.abs(netCents))}`} detail={`总收入 ${formatMoney(summary.incomeCents)}`} icon="trend" tone={netCents > 0 ? "income" : undefined} />
            </section>

            <div className="grid items-start gap-5 lg:grid-cols-12 reveal reveal-delay-1">
              <Card className="panel lg:col-span-8"><div className="section-heading"><div><h2 className="section-title">生活的收支日历</h2><p className="section-description">颜色越深，代表当天的支出越多。</p></div><span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted"><i className="size-1.5 rounded-full bg-success" />有收入</span></div><DailyCalendar key={month} month={month} days={summary.dailyBreakdown} /></Card>
              <div className="flex flex-col gap-5 lg:col-span-4">
                <Card className="panel"><div className="section-heading"><div><h2 className="section-title">这个月的几个瞬间</h2><p className="section-description">从数字里，看见日常的侧面。</p></div></div><dl className="flex flex-col gap-7"><div><dt className="mb-2 flex items-center gap-2 text-[11px] text-muted"><Icon name="tag" size={14} />支出最多的分类</dt><dd className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium"><span>{summary.topCategory?.name || "暂无记录"}</span><span className="text-xs tabular-nums">{summary.topCategory ? formatMoney(summary.topCategory.amountCents) : "—"}</span></dd></div><div><dt className="mb-2 flex items-center gap-2 text-[11px] text-muted"><Icon name="calendar" size={14} />支出最多的一天</dt><dd className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium"><span className="tabular-nums">{summary.topDate?.date.slice(5).replace("-", " / ") || "暂无记录"}</span><span className="text-xs tabular-nums">{summary.topDate ? formatMoney(summary.topDate.amountCents) : "—"}</span></dd></div><div><dt className="mb-2 flex items-center gap-2 text-[11px] text-muted"><Icon name="repeat" size={14} />自动记录的固定支出</dt><dd className="text-lg font-medium tabular-nums">{formatMoney(summary.subscriptionExpenseCents)}</dd></div></dl></Card>
                <div className="px-2 py-1"><span className="mb-3 inline-flex text-accent"><Icon name="leaf" size={20} /></span><p className="text-[13px] font-medium leading-7">{settled ? "记下的每一笔，都是生活的底气。" : "不必追求完美的数字，只要比上个月更了解自己。"}</p><p className="mt-2 text-[11px] text-muted">Rhodium，陪你慢慢找到自己的节奏。</p></div>
              </div>
            </div>

            <Card className="panel reveal reveal-delay-2"><div className="section-heading"><div><h2 className="section-title">把时间拉长一点</h2><p className="section-description">{trendDescription}</p></div><span className="flex shrink-0 items-center gap-2 text-[11px] text-muted"><i className="size-2 rounded-full bg-accent" />月度支出</span></div><div className="h-[210px] w-full" aria-label="近六个月支出柱状图"><BarChart data={trendChartData} height={210} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><BarChart.Grid strokeDasharray="3 3" vertical={false} /><BarChart.XAxis dataKey="monthLabel" axisLine={false} tickLine={false} tickMargin={10} /><BarChart.YAxis axisLine={false} tickLine={false} width={52} tickFormatter={(value: number) => `¥${value}`} /><BarChart.Tooltip content={<BarChart.TooltipContent indicator="dot" valueFormatter={(value) => `¥${Number(value).toFixed(2)}`} />} /><BarChart.Bar isAnimationActive={false} dataKey="expenseYuan" name="月度支出" fill="var(--accent)" radius={[6, 6, 0, 0]} maxBarSize={38} /></BarChart></div></Card>
          </>
        )}
      </div>
      {confirmSettle && <ConfirmDialog title={`结算 ${monthLabel(month)}？`} description="结算后会保存当前预算、收支和分类快照，该月账目将变为只读。之后如需补记，仍可重新打开。" confirmLabel="确认结算" busy={busy} onConfirm={() => void settle()} onClose={() => setConfirmSettle(false)} />}
      {message && <Toast message={message} />}
    </AppShell>
  );
}
