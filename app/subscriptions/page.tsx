"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { CategoryIcon, Icon } from "@/components/icon";
import { SubscriptionForm } from "@/components/subscription-form";
import { Toast, useFlash } from "@/components/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { getCategoryColor } from "@/lib/category-colors";
import { addMonths, billingDate, dateOnlyKey, formatMoney, todayInShanghai } from "@/lib/domain";
import { CategoryDTO, SubscriptionDTO } from "@/lib/types";

type SubscriptionFilter = "all" | "active" | "paused";

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year} / ${month}`;
}

/**
 * Label for the next charge. All comparisons go through YYYY-MM / YYYY-MM-DD
 * keys derived with `dateOnlyKey`, so a subscription that starts or ends in the
 * current month is classified the same way the server plans occurrences.
 */
function nextBillingLabel(subscription: SubscriptionDTO, today: string) {
  if (!subscription.active) return "已暂停";
  const currentMonth = today.slice(0, 7);
  const startMonth = subscription.startMonth.slice(0, 7);
  const endMonth = subscription.endMonth ? subscription.endMonth.slice(0, 7) : null;
  if (startMonth > currentMonth) return `${monthLabel(startMonth)} 开始`;
  if (endMonth && endMonth < currentMonth) return "已结束";

  const currentDue = billingDate(currentMonth, subscription.billingDay);
  const dueDate = dateOnlyKey(currentDue) >= today ? currentDue : billingDate(addMonths(currentMonth, 1), subscription.billingDay);
  const dueKey = dateOnlyKey(dueDate);
  if (endMonth && dueKey.slice(0, 7) > endMonth) return "已结束";
  return `${dueKey.slice(5, 7)} / ${dueKey.slice(8, 10)}`;
}

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [filter, setFilter] = useState<SubscriptionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SubscriptionDTO | null>(null);
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
    setBusyId(subscription.id);
    try {
      await apiFetch(`/api/subscriptions/${subscription.id}`, { method: "PATCH", json: { active: !subscription.active } });
      setSubscriptions((items) => items.map((item) => item.id === subscription.id ? { ...item, active: !item.active } : item));
      flash(subscription.active ? "订阅已暂停" : "订阅已启用");
    } catch (toggleError) {
      flash(errorMessage(toggleError, "状态更新失败"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(subscription: SubscriptionDTO) {
    if (!window.confirm(`停用「${subscription.name}」？已有自动账目会保留。`)) return;
    setBusyId(subscription.id);
    try {
      await apiFetch(`/api/subscriptions/${subscription.id}`, { method: "DELETE" });
      setSubscriptions((items) => items.map((item) => item.id === subscription.id ? { ...item, active: false } : item));
      flash("订阅已停用，历史账目仍会保留");
    } catch (removeError) {
      flash(errorMessage(removeError, "停用失败"));
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = subscriptions.filter((item) => item.active).length;
  const activeTotal = subscriptions.filter((item) => item.active).reduce((sum, item) => sum + item.amountCents, 0);
  const visibleSubscriptions = useMemo(() => subscriptions.filter((item) => filter === "all" || (filter === "active" ? item.active : !item.active)), [subscriptions, filter]);
  const currentMonth = today.slice(0, 7);

  return <AppShell>
    <div className="subscription-toolbar">
      <div className="subscription-summary"><strong>{activeCount} 项启用中</strong><span className="subscription-summary-divider" /><span>每月约 {formatMoney(activeTotal)}</span></div>
      <button type="button" className="button button-primary" onClick={() => setShowForm(true)}><Icon name="plus" size={16} />添加固定支出</button>
    </div>
    <div className="subscription-filter" role="group" aria-label="固定支出筛选"><button type="button" aria-pressed={filter === "all"} className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 {subscriptions.length}</button><button type="button" aria-pressed={filter === "active"} className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}>启用中 {activeCount}</button><button type="button" aria-pressed={filter === "paused"} className={filter === "paused" ? "active" : ""} onClick={() => setFilter("paused")}>已暂停 {subscriptions.length - activeCount}</button></div>
    {loading ? <div className="loading">正在读取固定支出…</div> : error ? <div className="inline-error"><strong>{error}</strong><button type="button" className="button button-secondary button-small" onClick={reload}>再试一次</button></div> : visibleSubscriptions.length === 0 ? <div className="card empty-state"><strong>{subscriptions.length === 0 ? "还没有固定支出" : "这个筛选下没有订阅"}</strong><span>{subscriptions.length === 0 ? "把每月都会发生的支出交给月余记住。" : "切换筛选，看看其他固定支出。"}</span>{subscriptions.length === 0 && <button type="button" className="button button-primary button-small" onClick={() => setShowForm(true)}><Icon name="plus" size={14} />添加第一项</button>}</div> : <div className="subscription-grid">{visibleSubscriptions.map((subscription) => { const palette = getCategoryColor(subscription.category.id); return <article className={`card subscription-card${subscription.active ? "" : " inactive"}`} key={subscription.id}><div className="subscription-head"><div className="subscription-title"><span className="subscription-avatar" style={{ color: palette.color, backgroundColor: palette.surface }}><CategoryIcon categoryName={subscription.category.name} type="EXPENSE" size={18} /></span><div><strong>{subscription.name}</strong><span>{subscription.category.name}</span></div></div><button type="button" className={`toggle${subscription.active ? " on" : ""}`} onClick={() => void toggle(subscription)} disabled={busyId === subscription.id} aria-label={subscription.active ? "暂停订阅" : "启用订阅"} aria-pressed={subscription.active}><span /></button></div><div className="subscription-price">{formatMoney(subscription.amountCents)} <small>/ 月</small></div><div className="subscription-meta"><div className="subscription-meta-row"><span>扣款日</span><strong>每月 {subscription.billingDay} 日</strong></div><div className="subscription-meta-row"><span className="subscription-next"><Icon name="clock" size={12} />下次记录</span><strong>{nextBillingLabel(subscription, today)}</strong></div><div className="subscription-meta-row"><span>有效期</span><strong>{monthLabel(subscription.startMonth.slice(0, 7))}{subscription.endMonth ? ` — ${monthLabel(subscription.endMonth.slice(0, 7))}` : "起"}</strong></div></div>{subscription.note && <p className="subscription-note" title={subscription.note}>{subscription.note}</p>}<div className="subscription-actions"><span className={`status-badge ${subscription.active ? "active" : "paused"}`}>{subscription.active ? "自动记账中" : "已暂停"}</span><button type="button" className="button button-quiet button-small" onClick={() => setEditing(subscription)}><Icon name="edit" size={14} />编辑</button><button type="button" className="button button-danger button-small" onClick={() => void remove(subscription)} disabled={busyId === subscription.id}><Icon name="trash" size={14} />{subscription.active ? "停用" : "删除"}</button></div></article>; })}</div>}
    {(showForm || editing) && <SubscriptionForm categories={categories} subscription={editing} defaultMonth={currentMonth} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); reload(); }} />}
    {message && <Toast message={message} />}
  </AppShell>;
}
