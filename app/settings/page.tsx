"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icon";
import { CategoryDTO } from "@/lib/types";

type ImportPreview = { total: number; valid: number; errors: string[]; preview?: { index: number; date: string; amount: unknown; note: unknown }[] };

function parseCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const parseLine = (line: string) => {
    const values: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === "," && !quoted) { values.push(current); current = ""; continue; }
      current += char;
    }
    values.push(current);
    return values;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(parseLine(line).map((item, index) => [headers[index], item])));
}

function Toast({ message }: { message: string }) {
  return <div className="undo-toast" role="status" aria-live="polite">{message}</div>;
}

export default function SettingsPage() {
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [categoryType, setCategoryType] = useState("expense");
  const [entryDateMode, setEntryDateMode] = useState("today");
  const [message, setMessage] = useState("");
  const [importRows, setImportRows] = useState<Record<string, unknown>[] | null>(null);
  const [backupPayload, setBackupPayload] = useState<Record<string, unknown> | undefined>(undefined);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/categories");
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "无法读取分类");
      setCategories(result.categories || []);
    } catch (loadError) {
      showMessage(loadError instanceof Error ? loadError.message : "无法读取分类");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const saved = window.localStorage.getItem("yueyu-entry-date-mode");
    if (saved === "last" || saved === "today") setEntryDateMode(saved);
  }, []);

  function showMessage(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2600);
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    if (!newCategory.trim()) {
      showMessage("先输入分类名称");
      return;
    }
    try {
      const response = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCategory, type: categoryType }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "添加分类失败");
      setNewCategory("");
      showMessage("分类已添加");
      await load();
    } catch (addError) {
      showMessage(addError instanceof Error ? addError.message : "添加分类失败");
    }
  }

  async function archiveCategory(category: CategoryDTO) {
    try {
      const response = await fetch(`/api/categories/${category.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: !category.archivedAt }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "分类更新失败");
      showMessage(category.archivedAt ? "分类已重新启用" : "分类已停用");
      await load();
    } catch (archiveError) {
      showMessage(archiveError instanceof Error ? archiveError.message : "分类更新失败");
    }
  }

  function changeDateMode(value: string) {
    setEntryDateMode(value);
    window.localStorage.setItem("yueyu-entry-date-mode", value);
    showMessage("默认日期设置已保存");
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
      const response = await fetch("/api/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format, rows }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "无法检查导入文件");
      setImportRows(rows);
      setBackupPayload(backup);
      setPreview(result);
    } catch (fileError) {
      showMessage(fileError instanceof Error ? fileError.message : "无法读取这个文件，请检查格式");
    }
    event.target.value = "";
  }

  function cancelImport() {
    setImportRows(null);
    setBackupPayload(undefined);
    setPreview(null);
  }

  async function confirmImport() {
    if (!importRows || !preview || preview.errors.length) return;
    setImporting(true);
    try {
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "json", rows: importRows, backup: backupPayload }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "导入失败");
      cancelImport();
      showMessage(`已导入 ${result.imported} 条记录`);
    } catch (importError) {
      showMessage(importError instanceof Error ? importError.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  return <AppShell>
    <div className="settings-grid">
      <section className="card settings-card"><p className="card-label">PREFERENCES</p><h2>记账偏好</h2><p>让每次打开记账表单时，都更接近你的习惯。</p><label className="form-label" htmlFor="date-mode">默认记账日期</label><select id="date-mode" className="form-control" value={entryDateMode} onChange={(event) => changeDateMode(event.target.value)}><option value="today">今天</option><option value="last">上次使用的日期</option></select><div className="settings-meta"><span>人民币（CNY）</span><i className="settings-meta-dot" /><span>Asia/Shanghai</span></div></section>
      <section className="card settings-card"><p className="card-label">PORTABILITY</p><h2>数据带走</h2><p>定期导出一份备份，长时间使用更安心。</p><div className="data-actions"><a className="button button-secondary button-small" href="/api/export?format=json"><Icon name="download" size={14} />JSON 完整备份</a><a className="button button-secondary button-small" href="/api/export?format=csv"><Icon name="download" size={14} />CSV 账目</a></div><div className="import-box"><label htmlFor="import-file"><Icon name="upload" size={15} />选择 JSON / CSV 导入<input id="import-file" type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => void handleFile(event)} /></label>{preview && <div className={`import-summary ${preview.errors.length ? "error" : "success"}`}><strong>{preview.errors.length ? "文件需要修正" : "文件检查通过"}</strong><div>{preview.valid} / {preview.total} 条记录可导入</div>{preview.errors.length > 0 && <ul className="import-errors">{preview.errors.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>}<div className="import-actions">{preview.errors.length === 0 && <button type="button" className="button button-primary button-small" onClick={() => void confirmImport()} disabled={importing}>{importing ? "导入中…" : "确认导入"}</button>}<button type="button" className="button button-quiet button-small" onClick={cancelImport}>取消</button></div></div>}</div></section>
      <section className="card settings-card full"><p className="card-label">CATEGORIES</p><h2>分类管理</h2><p>系统分类不能停用；自定义分类停用后，历史账目仍会保留。</p>{loading ? <div className="loading" style={{ minHeight: 100 }}>正在读取分类…</div> : <><div className="category-list">{categories.map((category) => <div className={`category-chip${category.archivedAt ? " archived" : ""}`} key={category.id}><span>{category.name}</span><span className="chip-type">{category.type === "BOTH" ? "通用" : category.type === "EXPENSE" ? "支出" : "收入"}</span>{!category.isSystem && <button type="button" className="icon-button" onClick={() => void archiveCategory(category)} aria-label={category.archivedAt ? "启用分类" : "停用分类"} title={category.archivedAt ? "启用分类" : "停用分类"}><Icon name={category.archivedAt ? "check" : "close"} size={12} /></button>}</div>)}</div><form className="add-category" onSubmit={addCategory}><input className="form-control" style={{ maxWidth: 230 }} placeholder="新分类名称" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} /><select className="form-control" style={{ maxWidth: 120 }} value={categoryType} onChange={(event) => setCategoryType(event.target.value)}><option value="expense">支出</option><option value="income">收入</option><option value="both">通用</option></select><button className="button button-secondary" type="submit"><Icon name="plus" size={15} />添加分类</button></form></>}</section>
    </div>
    {message && <Toast message={message} />}
  </AppShell>;
}
