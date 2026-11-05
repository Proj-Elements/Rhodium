"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Chip, Skeleton, Switch } from "@heroui/react";
import { EmptyState, Segment } from "@heroui-pro/react";
import { MetricCard } from "@/components/metric-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { applySubscriptionRemoval, nextSubscriptionDate, subscriptionState } from "@/lib/subscription-view";
import { AppShell } from "@/components/app-shell";
import { CategoryIcon, Icon } from "@/components/icon";
import { SubscriptionForm } from "@/components/subscription-form";
import { Toast, useFlash } from "@/components/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { getCategoryColor, getCategoryColors } from "@/lib/category-colors";
import { formatMoney, todayInShanghai } from "@/lib/domain";
import { CategoryDTO, SubscriptionDTO } from "@/lib/types";

type SubscriptionFilter = "all" | "active" | "paused";

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year} / ${month}`;
}

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [filter, setFilter] = useState<SubscriptionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SubscriptionDTO | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SubscriptionDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const { message, flash } = useFlash();
  const today = todayInShanghai();

  const reload = () => setReloadToken((token) => token + 1);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [subscriptionResult, categoryResult] = await Promise.all([
          apiFetch<{ subscriptions: SubscriptionDTO[] }>("/api/subscriptions", { signal: controller.signal }),
          apiFetch<{ categories: CategoryDTO[] }>("/api/categories", { signal: controller.signal }),
        ]);
        setSubscriptions(subscriptionResult.subscriptions || []);
        setCategories(categoryResult.categories || []);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(errorMessage(loadError, "暂时无法读取固定支出"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [reloadToken]);

  async function toggle(subscription: SubscriptionDTO) {
    if (busyId) return;
    setBusyId(subscription.id);
    try {
      await apiFetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        json: { active: !subscription.active },
      });
      setSubscriptions((items) =>
        items.map((item) => (item.id === subscription.id ? { ...item, active: !item.active } : item)),
      );
      flash(subscription.active ? "订阅已暂停" : "订阅已启用");
    } catch (toggleError) {
      flash(errorMessage(toggleError, "状态更新失败"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(subscription: SubscriptionDTO) {
    if (busyId) return;
    setBusyId(subscription.id);
    try {
      const result = await apiFetch<{ deleted?: boolean; subscription?: SubscriptionDTO }>(`/api/subscriptions/${subscription.id}`, { method: "DELETE" });
      setSubscriptions((items) => applySubscriptionRemoval(items, subscription.id, result));
      setPendingDelete(null);
      flash(result.deleted ? "固定支出已删除" : "固定支出已停用，历史账目仍会保留");
    } catch (removeError) {
      flash(errorMessage(removeError, "停用失败"));
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = subscriptions.filter((item) => item.active).length;
  const currentSubscriptions = subscriptions.filter((item) => subscriptionState(item, today) === "current");
  const activeTotal = currentSubscriptions.reduce((sum, item) => sum + item.amountCents, 0);
  const nextDue = subscriptions.map((item) => nextSubscriptionDate(item, today)).filter((date): date is string => Boolean(date)).sort()[0];
  const visibleSubscriptions = useMemo(
    () =>
      subscriptions.filter(
        (item) => filter === "all" || (filter === "active" ? item.active : !item.active),
      ),
    [subscriptions, filter],
  );
  const currentMonth = today.slice(0, 7);
  const categoryColors = useMemo(() => getCategoryColors([
    ...categories.map((category) => category.id),
    ...subscriptions.map((subscription) => subscription.category.id),
  ]), [categories, subscriptions]);

  return (
    <AppShell actions={<Button onPress={() => setShowForm(true)} isDisabled={loading}><Icon name="plus" size={16} />添加固定支出</Button>}>
      <div className="page-stack">
        <section className="grid gap-4 sm:grid-cols-3 reveal" aria-label="固定支出概况">
          <MetricCard label="本月固定支出" value={loading ? "—" : formatMoney(activeTotal)} detail="仅计入本月生效且分类可用的项目" icon="wallet" />
          <MetricCard label="本月生效项目" value={<>{loading ? "—" : currentSubscriptions.length}<span className="ml-1.5 text-xs font-normal tracking-normal text-muted">项</span></>} detail={`共 ${subscriptions.length} 项记录 · ${activeCount} 项已启用`} icon="repeat" />
          <MetricCard label="下次自动记录" value={loading ? "—" : nextDue ? `${Number(nextDue.slice(5, 7))} 月 ${Number(nextDue.slice(8))} 日` : "暂无安排"} detail="到达记录日后，打开账本即会同步" icon="calendar" />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segment aria-label="固定支出筛选" size="sm" selectedKey={filter} onSelectionChange={(key) => { if (key === "all" || key === "active" || key === "paused") setFilter(key); }}>
            <Segment.Item id="all" className="px-4">全部 {subscriptions.length}</Segment.Item><Segment.Item id="active" className="px-4">已启用 {activeCount}</Segment.Item><Segment.Item id="paused" className="px-4">已暂停 {subscriptions.length - activeCount}</Segment.Item>
          </Segment>
          <span className="flex items-center gap-1.5 text-[11px] text-muted"><Icon name="shield" size={13} />只自动记账，不会发起真实扣款</span>
        </div>

        {loading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="正在读取固定支出">{[1, 2, 3].map((i) => <Skeleton className="h-72 rounded-[20px]" key={i} />)}</div> : error ? <Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Title>{error}</Alert.Title><Button size="sm" variant="outline" className="mt-3" onPress={reload}>重新加载</Button></Alert.Content></Alert> : !visibleSubscriptions.length ? (
          <Card className="panel"><EmptyState className="py-12"><EmptyState.Media variant="icon"><Icon name="repeat" size={24} /></EmptyState.Media><EmptyState.Header><EmptyState.Title>{subscriptions.length ? "这里暂时没有匹配的项目" : "把每月的固定开销，安顿好"}</EmptyState.Title><EmptyState.Description>{subscriptions.length ? "切换到全部项目，查看其他固定支出。" : "校园网、音乐会员、房租……设定一次，以后自然记得。"}</EmptyState.Description></EmptyState.Header><EmptyState.Content>{subscriptions.length ? <Button variant="outline" onPress={() => setFilter("all")}>查看全部</Button> : <Button onPress={() => setShowForm(true)}>添加第一项</Button>}</EmptyState.Content></EmptyState></Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 reveal reveal-delay-1">
            {visibleSubscriptions.map((subscription) => {
              const palette = categoryColors.get(subscription.category.id) ?? getCategoryColor(subscription.category.id);
              const state = subscriptionState(subscription, today);
              const due = nextSubscriptionDate(subscription, today);
              const stateLabel = { current: "自动记账中", upcoming: "尚未开始", ended: "已结束", paused: "已暂停", archived: "分类已停用" }[state];
              return <Card key={subscription.id} className="panel flex flex-col justify-between gap-6">
                <div>
                  <div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="category-symbol" style={{ color: palette.color, background: palette.surface }}><CategoryIcon categoryName={subscription.category.name} type="EXPENSE" icon={subscription.category.icon} size={20} /></span><div className="min-w-0"><h2 className="truncate text-sm font-semibold" title={subscription.name}>{subscription.name}</h2><p className="mt-1 text-[11px] text-muted">{subscription.category.name}</p></div></div>
                    <Switch size="sm" isSelected={subscription.active} isDisabled={Boolean(busyId)} aria-label={`${subscription.active ? "暂停" : "启用"}${subscription.name}`} onChange={() => void toggle(subscription)}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch>
                  </div>
                  <div className="mb-6 mt-7 flex items-center gap-2"><strong className="text-[30px] font-medium leading-none tracking-tight tabular-nums">{formatMoney(subscription.amountCents)}</strong><span className="self-end text-[11px] text-muted">/ 月</span></div>
                  <dl className="flex flex-col gap-3.5 text-xs"><div className="flex items-center justify-between gap-2"><dt className="text-muted">记录日</dt><dd className="tabular-nums">每月 {subscription.billingDay} 日</dd></div><div className="flex items-center justify-between gap-2"><dt className="text-muted">下次记录</dt><dd className="tabular-nums">{due ? due.replaceAll("-", " / ") : "—"}</dd></div><div className="flex items-center justify-between gap-2"><dt className="text-muted">生效月份</dt><dd className="text-right text-[11px] tabular-nums">{monthLabel(subscription.startMonth.slice(0, 7))}{subscription.endMonth ? ` — ${monthLabel(subscription.endMonth.slice(0, 7))}` : " 起"}</dd></div></dl>
                  {subscription.note && <p className="mt-4 line-clamp-2 text-xs leading-6 text-muted" title={subscription.note}>{subscription.note}</p>}
                </div>
                <div className="flex items-center justify-between gap-2 pt-2"><Chip size="sm" variant="soft" color={state === "current" ? "success" : "default"}><Chip.Label>{stateLabel}</Chip.Label></Chip><div className="flex items-center gap-1"><Button size="sm" variant="ghost" onPress={() => setEditing(subscription)} isDisabled={Boolean(busyId)}>编辑</Button><Button size="sm" variant="ghost" className="text-muted hover:text-danger" onPress={() => setPendingDelete(subscription)} isDisabled={Boolean(busyId)}>移除</Button></div></div>
              </Card>;
            })}
          </div>
        )}
      </div>
      {(showForm || editing) && <SubscriptionForm categories={categories} subscription={editing} defaultMonth={currentMonth} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); reload(); }} />}
      {pendingDelete && <ConfirmDialog title="移除这项固定支出？" description={`「${pendingDelete.name}」之后不再自动记账。存在历史账目的项目会保留并暂停；尚未生成账目的项目将被删除。`} confirmLabel="确认移除" danger busy={Boolean(busyId)} onConfirm={() => void remove(pendingDelete)} onClose={() => setPendingDelete(null)} />}
      {message && <Toast message={message} />}
    </AppShell>
  );
}
