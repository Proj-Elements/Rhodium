"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icon";
import { Toast, useFlash } from "@/components/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { parseCsv } from "@/lib/csv";
import { CategoryDTO } from "@/lib/types";

type ImportPreview = { total: number; valid: number; errors: string[]; preview?: { index: number; date: string; amount: unknown; note: unknown }[] };

const CURRENT_MONTH = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
  return parts.slice(0, 7);
};

export default function SettingsPage() {
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [categoryType, setCategoryType] = useState("expense");
  const [entryDateMode, setEntryDateMode] = useState("today");
  const [importRows, setImportRows] = useState<Record<string, unknown>[] | null>(null);
  const [backupPayload, setBackupPayload] = useState<Record<string, unknown> | undefined>(undefined);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const { message, flash } = useFlash();

  // Budget state
  const [presetInput, setPresetInput] = useState("");
  const [monthBudgetInput, setMonthBudgetInput] = useState("");
  const [futureBudgetInput, setFutureBudgetInput] = useState("");
  const [budgetPresetCents, setBudgetPresetCents] = useState<number | null>(null);
  const [currentMonthBudgetCents, setCurrentMonthBudgetCents] = useState<number | null>(null);
  const [currentMonthSource, setCurrentMonthSource] = useState<"month" | "preset" | "none">("none");
  const [budgetSaving, setBudgetSaving] = useState(false);

  // Resolved once per mount: building an Intl formatter on every render was
  // pure waste, and the value only changes across a date boundary.
  const currentMonth = useMemo(() => CURRENT_MONTH(), []);

  async function load() {
    setLoading(true);
    try {
      const [categoryResult, budgetResult] = await Promise.all([
        apiFetch<{ categories: CategoryDTO[] }>("/api/categories"),
        apiFetch<{ budget: { amountCents: number } | null; preset: { amountCents: number } | null; effectiveBudgetCents: number | null }>(`/api/budgets/${currentMonth}`),
      ]);
      setCategories(categoryResult.categories || []);
      setBudgetPresetCents(budgetResult.preset?.amountCents ?? null);
      setCurrentMonthBudgetCents(budgetResult.budget?.amountCents ?? null);
      setCurrentMonthSource(budgetResult.budget ? "month" : budgetResult.preset ? "preset" : "none");
    } catch (loadError) {
      flash(errorMessage(loadError, "无法读取设置"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const saved = window.localStorage.getItem("yueyu-entry-date-mode");
    if (saved === "last" || saved === "today") setEntryDateMode(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    if (!newCategory.trim()) {
      flash("先输入分类名称");
      return;
    }
    try {
      await apiFetch("/api/categories", { method: "POST", json: { name: newCategory, type: categoryType } });
      setNewCategory("");
      flash("分类已添加");
      await load();
    } catch (addError) {
      flash(errorMessage(addError, "添加分类失败"));
    }
  }

  async function archiveCategory(category: CategoryDTO) {
    try {
      await apiFetch(`/api/categories/${category.id}`, { method: "PATCH", json: { archived: !category.archivedAt } });
      flash(category.archivedAt ? "分类已重新启用" : "分类已停用");
      await load();
    } catch (archiveError) {
      flash(errorMessage(archiveError, "分类更新失败"));
    }
  }

  function changeDateMode(value: string) {
    setEntryDateMode(value);
    window.localStorage.setItem("yueyu-entry-date-mode", value);
    flash("默认日期设置已保存");
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let backup: Record<string, unknown> | undefined;
      let rows: Record<string, unknown>[];
      if (file.name.toLowerCase().endsWith(".json")) {
        const data = JSON.parse(text) as Record<string, unknown>;
        backup = data.version ? data : undefined;
        const rawRows = data.transactions || data.rows;
        rows = Array.isArray(rawRows) ? rawRows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null) : [];
      } else {
        rows = parseCsv(text);
      }
      if (!rows.length) throw new Error("文件中没有可导入的账目");
      const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
      const result = await apiFetch<ImportPreview>("/api/import/preview", { method: "POST", json: { format, rows } });
      setImportRows(rows);
      setBackupPayload(backup);
      setPreview(result);
    } catch (fileError) {
      flash(errorMessage(fileError, "无法读取这个文件，请检查格式"));
    }
    event.target.value = "";
  }

  function cancelImport() {
    setImportRows(null);
    setBackupPayload(undefined);
    setPreview(null);
  }

  async function savePreset() {
    if (!presetInput.trim()) {
      flash("先输入默认预算金额");
      return;
    }
    setBudgetSaving(true);
    try {
      const result = await apiFetch<{ preset: { amountCents: number } }>("/api/budgets/preset", { method: "PUT", json: { amount: presetInput } });
      setBudgetPresetCents(result.preset.amountCents);
      setPresetInput("");
      flash("默认预算已保存，之后每个月都会沿用");
    } catch (saveError) {
      flash(errorMessage(saveError, "默认预算保存失败"));
    } finally {
      setBudgetSaving(false);
    }
  }

  async function saveCurrentMonthBudget() {
    if (!monthBudgetInput.trim()) {
      flash("先输入本月预算金额");
      return;
    }
    setBudgetSaving(true);
    try {
      const result = await apiFetch<{ budget: { amountCents: number } }>(`/api/budgets/${currentMonth}`, { method: "PUT", json: { amount: monthBudgetInput } });
      // Trust the server's parsing instead of re-deriving cents on the client.
      setCurrentMonthBudgetCents(result.budget.amountCents);
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
    if (!futureBudgetInput.trim()) {
      flash("先输入以后的每月预算金额");
      return;
    }
    if (!window.confirm(`把 ${currentMonth} 及之后每个月的预算都设为 ${futureBudgetInput} 元？这会覆盖默认预设对这些月份的作用。`)) return;
    setBudgetSaving(true);
    try {
      const result = await apiFetch<{ budget: { amountCents: number } }>(`/api/budgets/${currentMonth}?scope=future`, { method: "PUT", json: { amount: futureBudgetInput } });
      setCurrentMonthBudgetCents(result.budget.amountCents);
      setCurrentMonthSource("month");
      setFutureBudgetInput("");
      flash("本月及以后每个月的预算已更新");
    } catch (saveError) {
      flash(errorMessage(saveError, "预算保存失败"));
    } finally {
      setBudgetSaving(false);
    }
  }

  async function confirmImport() {
    if (!importRows || !preview || preview.errors.length) return;
    setImporting(true);
    try {
      const result = await apiFetch<{ imported: number }>("/api/import", { method: "POST", json: { format: "json", rows: importRows, backup: backupPayload } });
      cancelImport();
      flash(`已导入 ${result.imported} 条记录`);
    } catch (importError) {
      flash(errorMessage(importError, "导入失败"));
    } finally {
      setImporting(false);
    }
  }

  const presetDisplay = budgetPresetCents === null ? "未设置" : `¥${(budgetPresetCents / 100).toFixed(2)}`;
  const currentMonthDisplay = currentMonthBudgetCents === null ? "未设置" : `¥${(currentMonthBudgetCents / 100).toFixed(2)}`;

  return <AppShell>
    <div className="settings-grid">
      <section className="card settings-card"><p className="card-label">BUDGET</p><h2>预算</h2><p>设一个每月默认预算；需要变化时，可以只改本月，或一次性改到以后每个月。</p>
        <div className="budget-setting-row"><div className="budget-setting-copy"><strong>每月默认预算</strong><span>当前：{presetDisplay} · 没有单独设置的月份都会沿用这个金额</span></div><div className="budget-setting-input"><input className="form-control" inputMode="decimal" aria-label="每月默认预算金额" placeholder="例如 2000" value={presetInput} onChange={(event) => setPresetInput(event.target.value)} /><button type="button" className="button button-secondary button-small" onClick={() => void savePreset()} disabled={budgetSaving}>{budgetPresetCents === null ? "设置" : "更新"}</button></div></div>
        <div className="budget-setting-row"><div className="budget-setting-copy"><strong>只调整本月（{currentMonth}）</strong><span>当前生效：{currentMonthDisplay}{currentMonthSource === "preset" ? "（来自默认预算）" : currentMonthSource === "none" ? "" : "（本月单独设置）"}</span></div><div className="budget-setting-input"><input className="form-control" inputMode="decimal" aria-label="本月预算金额" placeholder="例如 1500" value={monthBudgetInput} onChange={(event) => setMonthBudgetInput(event.target.value)} /><button type="button" className="button button-secondary button-small" onClick={() => void saveCurrentMonthBudget()} disabled={budgetSaving}>调整</button></div></div>
        <div className="budget-setting-row"><div className="budget-setting-copy"><strong>调整本月和以后每个月</strong><span>从 {currentMonth} 起，每个月都写入这个金额</span></div><div className="budget-setting-input"><input className="form-control" inputMode="decimal" aria-label="以后每月预算金额" placeholder="例如 2500" value={futureBudgetInput} onChange={(event) => setFutureBudgetInput(event.target.value)} /><button type="button" className="button button-secondary button-small" onClick={() => void saveFutureBudgets()} disabled={budgetSaving}>应用</button></div></div>
      </section>
      <section className="card settings-card"><p className="card-label">PREFERENCES</p><h2>记账偏好</h2><p>让每次打开记账表单时，都更接近你的习惯。</p><label className="form-label" htmlFor="date-mode">默认记账日期</label><select id="date-mode" className="form-control" value={entryDateMode} onChange={(event) => changeDateMode(event.target.value)}><option value="today">今天</option><option value="last">上次使用的日期</option></select><div className="settings-meta"><span>人民币（CNY）</span><i className="settings-meta-dot" /><span>Asia/Shanghai</span></div></section>
      <section className="card settings-card"><p className="card-label">PORTABILITY</p><h2>数据带走</h2><p>定期导出一份备份，长时间使用更安心。</p><div className="data-actions"><a className="button button-secondary button-small" href="/api/export?format=json"><Icon name="download" size={14} />JSON 完整备份</a><a className="button button-secondary button-small" href="/api/export?format=csv"><Icon name="download" size={14} />CSV 账目</a></div><div className="import-box"><label htmlFor="import-file"><Icon name="upload" size={15} />选择 JSON / CSV 导入<input id="import-file" type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => void handleFile(event)} /></label>{preview && <div className={`import-summary ${preview.errors.length ? "error" : "success"}`}><strong>{preview.errors.length ? "文件需要修正" : "文件检查通过"}</strong><div>{preview.valid} / {preview.total} 条记录可导入</div>{preview.errors.length > 0 && <ul className="import-errors">{preview.errors.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>}<div className="import-actions">{preview.errors.length === 0 && <button type="button" className="button button-primary button-small" onClick={() => void confirmImport()} disabled={importing}>{importing ? "导入中…" : "确认导入"}</button>}<button type="button" className="button button-quiet button-small" onClick={cancelImport}>取消</button></div></div>}</div></section>
      <section className="card settings-card full"><p className="card-label">CATEGORIES</p><h2>分类管理</h2><p>系统分类不能停用；自定义分类停用后，历史账目仍会保留。</p>{loading ? <div className="loading" style={{ minHeight: 100 }}>正在读取分类…</div> : <><div className="category-list">{categories.map((category) => <div className={`category-chip${category.archivedAt ? " archived" : ""}`} key={category.id}><span>{category.name}</span><span className="chip-type">{category.type === "BOTH" ? "通用" : category.type === "EXPENSE" ? "支出" : "收入"}</span>{!category.isSystem && <button type="button" className="icon-button" onClick={() => void archiveCategory(category)} aria-label={category.archivedAt ? "启用分类" : "停用分类"} title={category.archivedAt ? "启用分类" : "停用分类"}><Icon name={category.archivedAt ? "check" : "close"} size={12} /></button>}</div>)}</div><form className="add-category" onSubmit={addCategory}><input className="form-control" style={{ maxWidth: 230 }} placeholder="新分类名称" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} /><select className="form-control" style={{ maxWidth: 120 }} value={categoryType} onChange={(event) => setCategoryType(event.target.value)}><option value="expense">支出</option><option value="income">收入</option><option value="both">通用</option></select><button className="button button-secondary" type="submit"><Icon name="plus" size={15} />添加分类</button></form></>}</section>
    </div>
    {message && <Toast message={message} />}
  </AppShell>;
}
