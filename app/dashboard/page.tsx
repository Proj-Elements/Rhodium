"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { Alert, Button, Card, Chip, ProgressBar, Skeleton } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react";
import { PieChart } from "@heroui-pro/react/pie-chart";
import { MetricCard } from "@/components/metric-card";
import { AreaChart } from "@heroui-pro/react/area-chart";
import { AppShell } from "@/components/app-shell";
import { CategoryIcon, Icon } from "@/components/icon";
import { MonthSwitcher } from "@/components/month-switcher";
import { Toast, useFlash } from "@/components/toast";
import { TransactionForm } from "@/components/transaction-form";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { isCurrentMonthReady, runClientLoad } from "@/lib/client-load";
import { getCategoryColor, getCategoryColors } from "@/lib/category-colors";
import { expenseSharePercent } from "@/lib/category-breakdown";
import { formatMoney } from "@/lib/domain";
import { useToday } from "@/lib/use-today";
import { CategoryDTO, DashboardDTO } from "@/lib/types";

function formatShortDate(value: string) {
  return value.slice(5).replace("-", "/");
}

function SpendingChart({ days }: { days: DashboardDTO["recentExpenses"] }) {
  const gradientId = useId();

  if (!days.length) {
    return (
      <EmptyState size="sm" className="py-10">
        <EmptyState.Media variant="icon">
          <Icon name="trend" size={20} />
        </EmptyState.Media>
        <EmptyState.Header>
          <EmptyState.Title>还没有足够的数据</EmptyState.Title>
          <EmptyState.Description>记下第一笔支出，这里就会展现每天的节奏变化。</EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  const chartData = days.map((day) => ({
    date: formatShortDate(day.date),
    fullDate: day.date,
    expenseYuan: Number((day.amountCents / 100).toFixed(2)),
    incomeYuan: Number((day.incomeCents / 100).toFixed(2)),
    amountCents: day.amountCents,
    incomeCents: day.incomeCents,
  }));

  const peakCents = Math.max(...days.map((day) => day.amountCents), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="h-[220px] w-full">
        <AreaChart data={chartData} height={220} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <AreaChart.Grid strokeDasharray="3 3" vertical={false} />
          <AreaChart.XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} />
          <AreaChart.YAxis
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(v: number) => `¥${v}`}
          />
          <AreaChart.Tooltip
            content={
              <AreaChart.TooltipContent
                indicator="dot"
                valueFormatter={(value) => `¥${Number(value).toFixed(2)}`}
              />
            }
          />
          <AreaChart.Area
            type="monotone"
            dataKey="expenseYuan"
            isAnimationActive={false}
            name="支出"
            stroke="var(--accent)"
            strokeWidth={2.2}
            fill={`url(#${gradientId})`}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-surface-secondary px-3.5 py-2.5 text-xs">
        <span className="text-muted">区间单日最高支出</span>
        <strong className="font-semibold tabular-nums text-foreground">{formatMoney(peakCents)}</strong>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const today = useToday();
  const [monthOverride, setMonthOverride] = useState("");
  const month = monthOverride || (today ? today.slice(0, 7) : "");
  const [reloadToken, setReloadToken] = useState(0);
  const setMonth = (next: string) => {
    setMonthOverride(next);
  };
  const reload = () => setReloadToken((token) => token + 1);
  const [data, setData] = useState<DashboardDTO | null>(null);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const { message, flash } = useFlash();

  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void runClientLoad({
      signal: controller.signal,
      work: () => Promise.all([
        apiFetch<DashboardDTO>(`/api/dashboard?month=${month}`, { signal: controller.signal }),
        apiFetch<{ categories: CategoryDTO[] }>("/api/categories", { signal: controller.signal }),
      ]),
      success: ([dashboard, categoryResult]) => {
        setData(dashboard);
        setCategories(categoryResult.categories || []);
        setBudgetInput("");
      },
      failure: setError,
      finished: () => setLoading(false),
      fallback: "暂时无法打开仪表盘",
    });
    return () => controller.abort();
  }, [month, reloadToken]);

  const ready = isCurrentMonthReady(month, data?.month, loading, error);

  async function saveBudget() {
    if (!ready || budgetSaving) return;
    if (!budgetInput.trim()) {
      flash("先输入一个预算金额");
      return;
    }
    setBudgetSaving(true);
    try {
      await apiFetch(`/api/budgets/${month}`, { method: "PUT", json: { amount: budgetInput } });
      flash("预算已更新");
      setBudgetInput("");
      reload();
    } catch (saveError) {
      flash(errorMessage(saveError, "预算保存失败"));
    } finally {
      setBudgetSaving(false);
    }
  }

  const focusDateLabel =
    data?.monthStatus === "future"
      ? "未开始"
      : data && data.focusDate === data.today
        ? "今日支出"
        : data
          ? `${data.focusDate.slice(5).replace("-", "/")} 支出`
          : "焦点日支出";

  const chartTitle =
    data?.monthStatus === "future" ? "月初预览" : data?.monthStatus === "past" ? "月末 7 天" : "最近 7 天趋势";

  const showBudgetPrompt = Boolean(data && data.budgetSource === "none");
  const isOverBudget = Boolean(data?.remainingCents !== null && (data?.remainingCents ?? 0) < 0);
  const clampedUsage = Math.min(Math.max(data?.usagePercent ?? 0, 0), 100);
  const categoryColors = useMemo(() => getCategoryColors([
    ...categories.map((category) => category.id),
    ...(data?.categoryBreakdown.map((category) => category.categoryId) ?? []),
  ]), [categories, data]);

  return (
    <AppShell actions={<><MonthSwitcher month={month} onChange={setMonth} /><Button onPress={() => setShowForm(true)} isDisabled={!ready}><Icon name="plus" size={16} />记一笔</Button></>}>
      <div className="page-stack">
        {loading || (!error && data?.month !== month) ? (
          <div className="grid gap-5 lg:grid-cols-12" aria-label="正在读取财务总览" aria-busy="true">
            <Skeleton className="h-[270px] rounded-[22px] lg:col-span-5" />
            <div className="grid grid-cols-2 gap-4 lg:col-span-7">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-[20px]" />)}</div>
            <Skeleton className="h-80 rounded-[20px] lg:col-span-7" /><Skeleton className="h-80 rounded-[20px] lg:col-span-5" />
          </div>
        ) : error ? (
          <Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Title>{error}</Alert.Title><Button variant="outline" size="sm" onPress={reload} className="mt-3">重新加载</Button></Alert.Content></Alert>
        ) : !data ? null : (
          <>
            <section className="grid gap-5 lg:grid-cols-12 reveal" aria-label="当月财务概况">
              <Card className="budget-hero lg:col-span-5">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="hero-label">{data.monthStatus === "past" ? "月末预算余量" : data.monthStatus === "future" ? "计划可用预算" : "这个月，还可以花"}</span>
                    <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px]"><Icon name="wallet" size={12} />预算账户</span>
                  </div>
                  <strong className={`hero-amount ${isOverBudget ? "text-[#ffc8b8]" : ""}`}>{data.remainingCents === null ? "先定一个小目标" : formatMoney(data.remainingCents)}</strong>
                  <p className="mt-3 text-[11px] text-white/65">{isOverBudget ? "已超出预算，适当调整接下来的节奏。" : data.budget ? "给今天一点从容，也给未来一点余地。" : "从设定月度预算开始，掌握自己的节奏。"}</p>
                </div>
                <div className="mt-8">
                  <div className="hero-budget-row"><span>月度预算 <strong>{data.budget ? formatMoney(data.budget.amountCents) : "未设置"}</strong></span><span>{data.usagePercent === null ? "等待设定" : `已使用 ${data.usagePercent}%`}</span></div>
                  <ProgressBar className="hero-progress" aria-label="预算使用比例" value={clampedUsage} size="sm" color={isOverBudget ? "danger" : (data.usagePercent ?? 0) >= 80 ? "warning" : "accent"}><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar>
                </div>
              </Card>
              <div className="grid grid-cols-2 gap-4 lg:col-span-7">
                <MetricCard label="当月总支出" value={formatMoney(data.expenseCents)} detail={`${data.expenseTransactionCount} 笔支出，认真记录的日常`} icon="expense" />
                <MetricCard label="当月总收入" value={formatMoney(data.incomeCents)} detail={`${data.transactionCount - data.expenseTransactionCount} 笔收入，每一份都值得`} icon="income" tone="income" />
                <MetricCard label={focusDateLabel} value={formatMoney(data.focusDateExpenseCents)} detail={data.monthStatus === "future" ? "月份尚未开始" : data.focusDate === data.today ? "今天，也在好好生活" : `${data.focusDate} 当日累计`} icon="calendar" />
                <MetricCard label="已记录账目" value={<>{data.transactionCount}<span className="ml-1.5 text-xs font-normal tracking-normal text-muted">笔</span></>} detail={data.monthStatus === "future" ? "提前安排，心中有数" : `本月已走过 ${data.daysElapsed} / ${data.daysInMonth} 天`} icon="receipt" />
              </div>
            </section>

            {showBudgetPrompt && <Card className="panel flex flex-col flex-wrap justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="section-title">给这个月，划一个舒适的范围</h2><p className="section-description">设置预算后，就能随时看见剩余的可用金额。</p></div><form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void saveBudget(); }}><input className="ledger-field max-w-36 tabular-nums" aria-label="本月预算金额" inputMode="decimal" placeholder="例如 2000" value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} required /><Button type="submit" isPending={budgetSaving}>设置预算</Button></form></Card>}
            {!showBudgetPrompt && isOverBudget && <Alert status="warning"><Alert.Indicator /><Alert.Content><Alert.Title>预算已超出，先看见它</Alert.Title><Alert.Description>可以减少接下来的非必要花销，或到<Link href="/settings" className="ml-1 underline underline-offset-4">设置</Link>调整预算。</Alert.Description></Alert.Content></Alert>}

            <div className="grid gap-5 lg:grid-cols-12 reveal reveal-delay-1">
              <Card className="panel lg:col-span-7">
                <div className="section-heading"><div><h2 className="section-title">{chartTitle}</h2><p className="section-description">日常花销的起伏，也是生活的节奏。</p></div><span className="flex items-center gap-1.5 text-[11px] text-muted"><i className="size-2 rounded-full bg-accent" />每日支出</span></div>
                <SpendingChart days={data.recentExpenses} />
              </Card>
              <Card className="panel lg:col-span-5">
                <div className="section-heading"><div><h2 className="section-title">钱都花在哪儿</h2><p className="section-description">当月支出分类，一眼看清轻重。</p></div><span className="text-muted"><Icon name="target" size={17} /></span></div>
                {data.categoryBreakdown.length === 0 ? (
                  <EmptyState size="sm" className="py-8"><EmptyState.Media variant="icon"><Icon name="coffee" size={22} /></EmptyState.Media><EmptyState.Header><EmptyState.Title>生活的第一笔，还等你写下</EmptyState.Title><EmptyState.Description>记下支出后，这里会自动汇总分类占比。</EmptyState.Description></EmptyState.Header><EmptyState.Content><Button variant="outline" size="sm" onPress={() => setShowForm(true)}>开始记录</Button></EmptyState.Content></EmptyState>
                ) : (
                  <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
                    <div className="relative size-[170px] shrink-0" aria-label={`支出共 ${data.categoryBreakdown.length} 个分类`}>
                      <PieChart width={170} height={170}>
                        <PieChart.Pie data={data.categoryBreakdown} dataKey="amountCents" nameKey="categoryName" cx="50%" cy="50%" innerRadius={58} outerRadius={77} paddingAngle={3} cornerRadius={4} stroke="none" isAnimationActive={false}>
                          {data.categoryBreakdown.map((category) => <PieChart.Cell key={category.categoryId} fill={(categoryColors.get(category.categoryId) ?? getCategoryColor(category.categoryId)).color} />)}
                        </PieChart.Pie>
                        <PieChart.Tooltip content={<PieChart.TooltipContent hideHeader valueFormatter={(value) => formatMoney(Number(value))} />} />
                      </PieChart>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-[10px] text-muted">支出分类</span><strong className="mt-1 text-2xl font-medium tabular-nums">{data.categoryBreakdown.length}<span className="ml-1 text-[10px] font-normal text-muted">类</span></strong></div>
                    </div>
                    <ul className="flex w-full min-w-0 flex-1 flex-col gap-4">
                      {data.categoryBreakdown.slice(0, 5).map((category) => <li key={category.categoryId} className="flex items-center gap-2 text-xs"><i className="size-2 shrink-0 rounded-full" style={{ background: (categoryColors.get(category.categoryId) ?? getCategoryColor(category.categoryId)).color }} /><span className="min-w-0 flex-1 truncate text-muted">{category.categoryName}</span><strong className="font-medium tabular-nums">{formatMoney(category.amountCents)}</strong><span className="w-8 text-right text-[10px] tabular-nums text-muted">{expenseSharePercent(category.amountCents, data.expenseCents)}%</span></li>)}
                      {data.categoryBreakdown.length > 5 && <li className="text-[11px] text-muted">还有 {data.categoryBreakdown.length - 5} 个分类，图中已完整展示</li>}
                    </ul>
                  </div>
                )}
              </Card>
            </div>

            <Card className="panel reveal reveal-delay-2">
              <div className="section-heading"><div><h2 className="section-title">最近的生活记录</h2><p className="section-description">那些不经意的花销，都有了自己的位置。</p></div><Link className="text-link" href={`/transactions?month=${month}`}>全部账目<Icon name="arrow" size={14} /></Link></div>
              {data.recentTransactions.length === 0 ? (
                <EmptyState size="sm" className="py-8"><EmptyState.Media variant="icon"><Icon name="receipt" size={22} /></EmptyState.Media><EmptyState.Header><EmptyState.Title>从今天的一笔开始</EmptyState.Title><EmptyState.Description>一杯咖啡、一份午餐，都是值得记录的日常。</EmptyState.Description></EmptyState.Header><EmptyState.Content><Button variant="outline" size="sm" onPress={() => setShowForm(true)}>记下第一笔</Button></EmptyState.Content></EmptyState>
              ) : (
                <table className="finance-table"><thead><tr><th scope="col">账目</th><th scope="col" className="hidden sm:table-cell">分类</th><th scope="col" className="hidden md:table-cell">日期</th><th scope="col">金额</th></tr></thead><tbody>
                  {data.recentTransactions.slice(0, 5).map((transaction) => {
                    const palette = categoryColors.get(transaction.category.id) ?? getCategoryColor(transaction.category.id);
                    const isIncome = transaction.type === "INCOME";
                    return <tr key={transaction.id}><td><div className="flex min-w-0 items-center gap-3"><span className="category-symbol" style={{ color: isIncome ? "var(--success)" : palette.color, background: isIncome ? "var(--success-soft)" : palette.surface }}><CategoryIcon categoryName={transaction.category.name} type={transaction.type} icon={transaction.category.icon} /></span><div className="min-w-0"><span className="block max-w-[140px] truncate font-medium sm:max-w-[240px]" title={transaction.note || transaction.category.name}>{transaction.note || transaction.category.name}</span><span className="mt-1 block text-[10px] tabular-nums text-muted sm:hidden">{transaction.occurredOn}</span></div></div></td><td className="hidden text-muted sm:table-cell">{transaction.category.name}{transaction.source === "SUBSCRIPTION" && <Chip size="sm" color="accent" variant="soft" className="ml-2"><Chip.Label>自动</Chip.Label></Chip>}</td><td className="hidden tabular-nums text-muted md:table-cell">{transaction.occurredOn}</td><td className={`whitespace-nowrap font-semibold tabular-nums ${isIncome ? "text-success" : ""}`}>{isIncome ? "+" : "−"}{formatMoney(transaction.amountCents)}</td></tr>;
                  })}
                </tbody></table>
              )}
            </Card>
          </>
        )}
      </div>
      {showForm && ready && data && <TransactionForm categories={categories} defaultDate={data.focusDate} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); reload(); }} />}
      {message && <Toast message={message} />}
    </AppShell>
  );
}
