"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Input, ListBox, Select, Skeleton } from "@heroui/react";
import { DropZone, Segment } from "@heroui-pro/react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconButton } from "@/components/icon-button";
import { CategoryIcon } from "@/components/icon";
import { formatMoney } from "@/lib/domain";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icon";
import { Toast, useFlash } from "@/components/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { isCurrentMonthReady, runClientLoad } from "@/lib/client-load";
import { useToday } from "@/lib/use-today";
import { createImportPreviewController, type ImportPreviewState } from "@/lib/import-preview-controller";
import { SettingsDataBoundary } from "@/components/settings-data-boundary";
import { categoryIconLabels, categoryIconNames, isCategoryIconName, type CategoryIconName } from "@/lib/category-icons";
import { CategoryDTO } from "@/lib/types";

const fieldClassName = "ledger-field";

export default function SettingsPage() {
  const [confirmFuture, setConfirmFuture] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [categoryType, setCategoryType] = useState<"expense" | "income" | "both">("expense");
  const [categoryIcon, setCategoryIcon] = useState<CategoryIconName | null>(null);
  const [entryDateMode, setEntryDateMode] = useState("today");
  const [importState, setImportState] = useState<ImportPreviewState>({ status: "idle" });
  const [importController] = useState(() => createImportPreviewController(setImportState));
  const preview = importState.status === "ready" ? importState.selection.preview : null;
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadedMonth, setLoadedMonth] = useState("");
  const loadController = useRef<AbortController | null>(null);
  const { message, flash } = useFlash();

  // Budget state
  const [presetInput, setPresetInput] = useState("");
  const [monthBudgetInput, setMonthBudgetInput] = useState("");
  const [futureBudgetInput, setFutureBudgetInput] = useState("");
  const [budgetPresetCents, setBudgetPresetCents] = useState<number | null>(null);
  const [effectiveBudgetCents, setEffectiveBudgetCents] = useState<number | null>(null);
  const [currentMonthSource, setCurrentMonthSource] = useState<"month" | "preset" | "none">("none");
  const [budgetSaving, setBudgetSaving] = useState(false);

  const today = useToday();
  const currentMonth = today?.slice(0, 7) ?? "";
  const ready = isCurrentMonthReady(currentMonth, loadedMonth, loading, loadError);
  const currentMonthRef = useRef(currentMonth);

  const load = useCallback(async () => {
    const requestedMonth = currentMonthRef.current;
    if (!requestedMonth) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setLoadError("");
    await runClientLoad({
      signal: controller.signal,
      work: () => Promise.all([
        apiFetch<{ categories: CategoryDTO[] }>("/api/categories", { signal: controller.signal }),
        apiFetch<{
          budget: { amountCents: number } | null;
          preset: { amountCents: number } | null;
          effectiveBudgetCents: number | null;
        }>(`/api/budgets/${requestedMonth}`, { signal: controller.signal }),
      ]),
      success: ([categoryResult, budgetResult]) => {
        setCategories(categoryResult.categories || []);
        setBudgetPresetCents(budgetResult.preset?.amountCents ?? null);
        setEffectiveBudgetCents(budgetResult.effectiveBudgetCents ?? null);
        setCurrentMonthSource(budgetResult.budget ? "month" : budgetResult.preset ? "preset" : "none");
        setLoadedMonth(requestedMonth);
      },
      failure: setLoadError,
      finished: () => setLoading(false),
      fallback: "无法读取设置",
    });
  }, []);

  useEffect(() => {
    currentMonthRef.current = currentMonth;
    setConfirmFuture(false);
    void load();
    return () => { loadController.current?.abort(); };
  }, [currentMonth, load]);

  useEffect(() => () => importController.dispose(), [importController]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("yueyu-entry-date-mode");
      if (saved === "last" || saved === "today") setEntryDateMode(saved);
    } catch { /* Preferences are optional when browser storage is blocked. */ }
  }, []);

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    if (addingCategory || !ready) return;
    if (!newCategory.trim()) {
      flash("先输入分类名称");
      return;
    }
    setAddingCategory(true);
    try {
      await apiFetch("/api/categories", {
        method: "POST",
        json: { name: newCategory, type: categoryType, icon: categoryIcon },
      });
      setNewCategory("");
      setCategoryIcon(null);
      flash("分类已添加");
      await load();
    } catch (addError) {
      flash(errorMessage(addError, "添加分类失败"));
    } finally {
      setAddingCategory(false);
    }
  }

  async function archiveCategory(category: CategoryDTO) {
    if (!ready) return;
    try {
      await apiFetch(`/api/categories/${category.id}`, {
        method: "PATCH",
        json: { archived: !category.archivedAt },
      });
      flash(category.archivedAt ? "分类已重新启用" : "分类已停用");
      await load();
    } catch (archiveError) {
      flash(errorMessage(archiveError, "分类更新失败"));
    }
  }

  function changeDateMode(value: string) {
    try {
      window.localStorage.setItem("yueyu-entry-date-mode", value);
      setEntryDateMode(value);
      flash("默认日期设置已保存");
    } catch {
      flash("浏览器未允许保存偏好，暂时使用今天作为默认日期");
    }
  }

  function processSelectedFile(file: File | Promise<File>) {
    if (!ready || importingRef.current) return;
    void importController.select(file);
  }

  function cancelImport() {
    if (!importingRef.current) importController.cancel();
  }

  async function savePreset() {
    if (!ready || budgetSaving) return;
    if (!presetInput.trim()) {
      flash("先输入默认预算金额");
      return;
    }
    setBudgetSaving(true);
    try {
      await apiFetch("/api/budgets/preset", {
        method: "PUT",
        json: { amount: presetInput },
      });
      setPresetInput("");
      flash("默认预算已保存，之后每个月都会沿用");
      await load();
    } catch (saveError) {
      flash(errorMessage(saveError, "默认预算保存失败"));
    } finally {
      setBudgetSaving(false);
    }
  }

  async function saveCurrentMonthBudget() {
    if (!ready || budgetSaving) return;
    if (!monthBudgetInput.trim()) {
      flash("先输入本月预算金额");
      return;
    }
    setBudgetSaving(true);
    try {
      const result = await apiFetch<{ budget: { amountCents: number } }>(
        `/api/budgets/${currentMonth}`,
        { method: "PUT", json: { amount: monthBudgetInput } },
      );
      setEffectiveBudgetCents(result.budget.amountCents);
      setCurrentMonthSource("month");
      setMonthBudgetInput("");
      flash("本月预算已单独调整");
    } catch (saveError) {
      flash(errorMessage(saveError, "本月预算保存失败"));
    } finally {
      setBudgetSaving(false);
    }
  }

  async function saveFutureBudgets() {
    if (!ready || budgetSaving) return;
    if (!futureBudgetInput.trim()) {
      flash("先输入以后的每月预算金额");
      return;
    }
    setBudgetSaving(true);
    try {
      const result = await apiFetch<{ budget: { amountCents: number } }>(
        `/api/budgets/${currentMonth}?scope=future`,
        { method: "PUT", json: { amount: futureBudgetInput } },
      );
      setEffectiveBudgetCents(result.budget.amountCents);
      setCurrentMonthSource("month");
      setFutureBudgetInput("");
      setConfirmFuture(false);
      flash("本月及以后每个月的预算已更新");
    } catch (saveError) {
      flash(errorMessage(saveError, "预算保存失败"));
    } finally {
      setBudgetSaving(false);
    }
  }

  async function confirmImport() {
    if (!ready || importingRef.current || importState.status !== "ready" || importState.selection.preview.errors.length) return;
    const { format, rows, backup } = importState.selection;
    importingRef.current = true;
    setImporting(true);
    try {
      const result = await apiFetch<{ imported: number }>("/api/import", {
        method: "POST",
        json: { format, rows, backup },
      });
      importController.cancel();
      flash(`已导入 ${result.imported} 条记录`);
      await load();
    } catch (importError) {
      flash(errorMessage(importError, "导入失败"));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }

  const presetDisplay = budgetPresetCents === null ? "未设置" : formatMoney(budgetPresetCents);
  const currentMonthDisplay =
    effectiveBudgetCents === null ? "未设置" : formatMoney(effectiveBudgetCents);

  return (
    <AppShell actions={null}>
      <SettingsDataBoundary error={loadError} onRetry={() => void load()}>
      <div className="grid items-start gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          <Card className="panel reveal">
            <div className="section-heading"><div><h2 className="section-title">预算，给生活一点方向</h2><p className="section-description">合理的预算不是限制，而是花钱时的底气。</p></div><span className="metric-icon"><Icon name="target" size={18} /></span></div>
            <div className="settings-row"><div className="settings-copy"><h3>每月默认预算</h3><p>没有单独设定预算的月份，将自动沿用这个金额。<br />当前预设：<b className="font-medium tabular-nums text-foreground">{loading ? "读取中…" : presetDisplay}</b></p></div><form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void savePreset(); }}><Input className={`${fieldClassName} max-w-32 tabular-nums`} aria-label="每月默认预算金额" inputMode="decimal" placeholder="输入金额" value={presetInput} onChange={(event) => setPresetInput(event.target.value)} disabled={!ready || budgetSaving} required /><Button type="submit" variant="outline" isPending={budgetSaving} isDisabled={!ready}>{budgetPresetCents === null ? "设置" : "更新"}</Button></form></div>
            <div className="settings-row"><div className="settings-copy"><h3>只调整这个月 <span className="ml-1 text-[11px] font-normal tabular-nums text-muted">{currentMonth}</span></h3><p>当前生效：<b className="font-medium tabular-nums text-foreground">{loading ? "读取中…" : currentMonthDisplay}</b>{currentMonthSource === "preset" ? "（沿用默认预算）" : currentMonthSource === "month" ? "（本月单独设置）" : ""}<br />只对本月生效，不影响其他月份。</p></div><form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void saveCurrentMonthBudget(); }}><Input className={`${fieldClassName} max-w-32 tabular-nums`} aria-label="本月预算金额" inputMode="decimal" placeholder="输入金额" value={monthBudgetInput} onChange={(event) => setMonthBudgetInput(event.target.value)} disabled={!ready || budgetSaving} required /><Button type="submit" variant="outline" isPending={budgetSaving} isDisabled={!ready}>调整</Button></form></div>
            <details className="mt-5 border-t border-separator pt-5"><summary className="flex cursor-[var(--cursor-interactive)] list-none items-center justify-between gap-3 rounded-md text-xs text-muted focus-visible:outline-2 focus-visible:outline-focus">批量调整本月及以后的预算<Icon name="chevron" size={14} /></summary><div className="mt-5"><p className="mb-4 text-xs leading-6 text-muted">从 {currentMonth} 起，一次性设置未来 20 年内的月度预算，已结算的月份不会更改。</p><form className="flex flex-wrap items-center gap-3" onSubmit={(event) => { event.preventDefault(); if (ready && !budgetSaving && futureBudgetInput.trim()) setConfirmFuture(true); }}><Input className={`${fieldClassName} max-w-44 tabular-nums`} inputMode="decimal" aria-label="以后每月预算金额" placeholder="新的每月预算" value={futureBudgetInput} onChange={(event) => setFutureBudgetInput(event.target.value)} disabled={!ready || budgetSaving} required /><Button type="submit" variant="outline" isDisabled={!ready || budgetSaving}>应用到以后</Button></form></div></details>
          </Card>

          <Card className="panel reveal reveal-delay-1">
            <div className="section-heading"><div><h2 className="section-title">为每一笔，找到归属</h2><p className="section-description">系统分类始终保留，自定义分类可以随时停用或启用。</p></div><span className="metric-icon"><Icon name="tag" size={17} /></span></div>
            {loading ? <div className="grid grid-cols-2 gap-3" aria-busy="true">{[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div> : <div className="grid gap-x-5 sm:grid-cols-2">{categories.map((category) => <div key={category.id} className={`flex items-center gap-3 py-3.5 ${category.archivedAt ? "opacity-55" : ""}`}><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-muted"><CategoryIcon categoryName={category.name} type={category.type} icon={category.icon} size={17} /></span><div className="min-w-0 flex-1"><span className="block truncate text-xs font-medium" title={category.name}>{category.name}</span><span className="mt-1 block text-[10px] text-muted">{category.type === "BOTH" ? "通用" : category.type === "EXPENSE" ? "支出" : "收入"} · {category.archivedAt ? "已停用" : category.isSystem ? "系统分类" : "自定义"}</span></div>{!category.isSystem && <IconButton icon={category.archivedAt ? "check" : "close"} size="sm" label={`${category.archivedAt ? "启用" : "停用"}分类${category.name}`} onPress={() => void archiveCategory(category)} />}</div>)}</div>}
            <form className="mt-5 flex flex-wrap items-center gap-3 border-t border-separator pt-5" onSubmit={addCategory}>
              <Input className={`${fieldClassName} min-w-40 flex-1`} aria-label="新分类名称" placeholder="添加一个新分类" maxLength={30} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} required disabled={addingCategory || !ready} />
              <Select aria-label="新分类类型" className="w-28 shrink-0" variant="secondary" value={categoryType} isDisabled={addingCategory || !ready} onChange={(value) => { if (value === "expense" || value === "income" || value === "both") setCategoryType(value); }}>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover className="ledger-select-popover">
                  <ListBox aria-label="分类类型">
                    <ListBox.Item id="expense" textValue="支出">支出<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="income" textValue="收入">收入<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="both" textValue="通用">通用<ListBox.ItemIndicator /></ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select aria-label="新分类图标" className="w-36 shrink-0" variant="secondary" value={categoryIcon ?? "auto"} isDisabled={addingCategory || !ready} onChange={(value) => { if (value === "auto") setCategoryIcon(null); else if (isCategoryIconName(value)) setCategoryIcon(value); }}>
                <Select.Trigger>
                  <Select.Value className="flex items-center gap-2"><CategoryIcon categoryName={newCategory} type={categoryType === "income" ? "INCOME" : "EXPENSE"} icon={categoryIcon} size={17} /><span>{categoryIcon ? categoryIconLabels[categoryIcon] : "自动匹配"}</span></Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover className="ledger-select-popover">
                  <ListBox aria-label="分类图标" className="max-h-64 overflow-y-auto">
                    <ListBox.Item id="auto" textValue="自动匹配"><CategoryIcon categoryName={newCategory} type={categoryType === "income" ? "INCOME" : "EXPENSE"} size={17} /><span className="flex-1">自动匹配</span><ListBox.ItemIndicator /></ListBox.Item>
                    {categoryIconNames.map((name) => <ListBox.Item key={name} id={name} textValue={categoryIconLabels[name]}><Icon name={name} size={17} /><span className="flex-1">{categoryIconLabels[name]}</span><ListBox.ItemIndicator /></ListBox.Item>)}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Button type="submit" variant="outline" isPending={addingCategory} isDisabled={!ready}>添加分类</Button>
              <p className="basis-full text-[11px] leading-5 text-muted">选择喜欢的图标，或让账本按分类名称自动匹配。</p>
            </form>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:col-span-4">
          <Card className="panel reveal">
            <div className="section-heading"><div><h2 className="section-title">让记录更顺手</h2><p className="section-description">一些小小的习惯，日积月累。</p></div></div>
            <div><h3 className="mb-3 text-xs font-medium">默认记账日期</h3><Segment aria-label="默认记账日期" size="sm" selectedKey={entryDateMode} onSelectionChange={(key) => { if (key === "today" || key === "last") changeDateMode(key); }}><Segment.Item id="today" className="px-4">今天</Segment.Item><Segment.Item id="last" className="px-4">上次使用</Segment.Item></Segment><p className="mt-3 text-[11px] leading-6 text-muted">在同一个月份内沿用上次日期。切换到其他月份时，以所选月份为准。</p></div>
            <dl className="mt-5 flex flex-col gap-3 border-t border-separator pt-5 text-[11px]"><div className="flex justify-between"><dt className="text-muted">记账币种</dt><dd>人民币 · CNY</dd></div><div className="flex justify-between"><dt className="text-muted">账本时区</dt><dd>Asia/Shanghai</dd></div></dl>
          </Card>

          <Card className="panel reveal reveal-delay-1">
            <div className="section-heading"><div><h2 className="section-title">记录在这里，数据属于你</h2><p className="section-description">定期留一份备份，安心记录每一天。</p></div></div>
            <div className="flex flex-col gap-2.5"><a href="/api/export?format=json" className="flex items-center justify-between gap-3 rounded-xl bg-surface-secondary px-4 py-3.5 text-xs focus-visible:outline-2 focus-visible:outline-focus"><span><b className="font-medium">JSON 完整备份</b><small className="mt-1 block text-[10px] text-muted">预算、分类、订阅与全部账目</small></span><Icon name="download" size={16} /></a><a href="/api/export?format=csv" className="flex items-center justify-between gap-3 rounded-xl bg-surface-secondary px-4 py-3.5 text-xs focus-visible:outline-2 focus-visible:outline-focus"><span><b className="font-medium">CSV 账目导出</b><small className="mt-1 block text-[10px] text-muted">适合在表格软件中整理分析</small></span><Icon name="download" size={16} /></a></div>
            <div className="mt-6"><h3 className="mb-3 text-xs font-medium">导入已有记录</h3><DropZone className="w-full"><DropZone.Input id="import-file" accept=".json,.csv,application/json,text/csv" onSelect={(files) => { if (files?.[0]) void processSelectedFile(files[0]); }} /><DropZone.Area className="rounded-2xl p-5" onDrop={(event) => { const file = event.items.find((item) => item.kind === "file"); if (file && file.kind === "file") processSelectedFile(file.getFile()); }}><DropZone.Icon className="text-accent"><Icon name="upload" size={22} /></DropZone.Icon><DropZone.Label className="text-xs font-medium">把文件拖到这里</DropZone.Label><DropZone.Description className="text-[10px]">支持 JSON 备份或 CSV 账目</DropZone.Description><DropZone.Trigger className="mt-3">选择文件</DropZone.Trigger></DropZone.Area></DropZone></div>
            {preview && <Alert className="mt-4" status={preview.errors.length ? "danger" : "success"}><Alert.Indicator /><Alert.Content><Alert.Title>{preview.errors.length ? "文件需要修正" : "文件检查通过"}</Alert.Title><Alert.Description>{preview.valid} / {preview.total} 条记录可导入</Alert.Description>{preview.errors.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{preview.errors.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>}<div className="mt-3 flex flex-wrap gap-2">{!preview.errors.length && <Button size="sm" onPress={() => void confirmImport()} isPending={importing}>确认导入</Button>}<Button size="sm" variant="ghost" isDisabled={importing} onPress={cancelImport}>取消</Button></div></Alert.Content></Alert>}
            <p className="mt-4 text-[10px] leading-5 text-muted">CSV 作为新账目追加；恢复完整账本请使用 JSON 备份。导入前会先检查文件。</p>
          </Card>
          <p className="flex items-start gap-2 px-2 text-[10px] leading-5 text-muted"><span className="mt-1 shrink-0"><Icon name="shield" size={13} /></span>这是一个单人账本，不含登录鉴权。请仅在本机或可信网络中使用。</p>
        </div>
      </div>
      </SettingsDataBoundary>
      {confirmFuture && ready && <ConfirmDialog title="调整本月及以后的预算？" description={`从 ${currentMonth} 开始，将未来 20 年内未结算月份的每月预算都调整为 ${futureBudgetInput} 元。这会覆盖这些月份原本的预算设置。`} confirmLabel="确认应用" busy={budgetSaving} onConfirm={() => void saveFutureBudgets()} onClose={() => setConfirmFuture(false)} />}
      {message && <Toast message={message} />}
    </AppShell>
  );
}
