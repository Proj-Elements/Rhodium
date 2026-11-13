"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatMoney } from "@/lib/domain";
import { useLedgerRevision } from "@/lib/ledger-events";

type HistoryEntry = { id: string; revision: number; action: string; recordedAt: string; snapshot: { expenseAmountCents: number; incomeAmountCents: number; remainingAmountCents: number | null } };
type HistoryPage = { history: HistoryEntry[]; nextCursor: number | null };
const actions: Record<string, string> = { settle: "结算", reopen: "重新打开", restore_backup: "恢复备份" };

export function SettlementHistory({ month }: { month: string }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const moreRequest = useRef<AbortController | null>(null);
  const revision = useLedgerRevision();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setEntries([]);
    setCursor(null);
    setError("");
    void apiFetch<HistoryPage>(`/api/settlements/${month}/history`, { signal: controller.signal })
      .then((page) => { if (!controller.signal.aborted) { setEntries(page.history); setCursor(page.nextCursor); } })
      .catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure, "无法读取结算历史")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); moreRequest.current?.abort(); moreRequest.current = null; };
  }, [month, revision, retry]);
  async function loadMore() {
    if (!cursor || loading || moreRequest.current) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const page = await apiFetch<HistoryPage>(`/api/settlements/${month}/history?cursor=${cursor}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setEntries((previous) => [...previous, ...page.history.filter((entry) => !previous.some((item) => item.id === entry.id))]);
      setCursor(page.nextCursor);
    } catch (failure) { if (!controller.signal.aborted) setError(errorMessage(failure, "无法读取更多历史")); }
    finally { if (moreRequest.current === controller) moreRequest.current = null; if (!controller.signal.aborted) setLoading(false); }
  }
  return <details className="panel mt-5"><summary className="cursor-pointer text-sm font-medium">结算变更历史</summary>
    <div className="mt-4 flex flex-col gap-3">
      {entries.map((entry) => <div key={entry.id} className="rounded-xl bg-surface-secondary p-4 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><strong>{actions[entry.action] ?? entry.action} · 修订 {entry.revision}</strong><time dateTime={entry.recordedAt}>{new Date(entry.recordedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</time></div>
        <p className="mt-3">账面支出 {formatMoney(entry.snapshot.expenseAmountCents)} · 收入 {formatMoney(entry.snapshot.incomeAmountCents)} · 预算剩余 {formatMoney(entry.snapshot.remainingAmountCents)}</p>
      </div>)}
      {!entries.length && !loading && !error && <p className="text-xs text-muted">尚无已保存的结算历史。</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {cursor ? <Button variant="outline" isPending={loading} onPress={() => void loadMore()}>加载更早历史</Button> : error ? <Button variant="outline" onPress={() => setRetry((value) => value + 1)}>重新加载</Button> : loading ? <p role="status" className="text-xs">正在读取历史…</p> : null}
    </div>
  </details>;
}
