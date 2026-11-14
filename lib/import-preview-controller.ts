import { apiFetch, errorMessage } from "@/lib/api-client";
import { parseCsv } from "@/lib/csv";

export type ImportPreview = {
  total: number;
  valid: number;
  errors: string[];
  preview?: { index: number; date: string; amount: unknown; note: unknown }[];
  summary?: ImportSummary;
};

export type ImportSummary = {
  transactions: { create: number; update: number; unchanged: number };
  categories: { create: number; update: number };
  subscriptions: { create: number; update: number };
  budgets: { create: number; update: number };
  budgetPreset: { create: number; update: number; delete: number };
  settlements: { create: number; update: number };
  lockedMonths: string[];
  conflicts: string[];
};

type ImportFile = Pick<File, "name" | "size" | "arrayBuffer">;
export type ImportSelection = {
  format: "json" | "csv";
  rows: Record<string, unknown>[];
  backup?: Record<string, unknown>;
  preview: ImportPreview;
};
export type ImportPreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; selection: ImportSelection };

type PreviewRequest = (body: { backup: Record<string, unknown> } | { format: "json" | "csv"; rows: Record<string, unknown>[] }, signal?: AbortSignal) => Promise<ImportPreview>;

/** Owns a selected file and its preview as one unit, ready for a single import. */
export function createImportPreviewController(
  onChange: (state: ImportPreviewState) => void,
  requestPreview: PreviewRequest = (json, signal) => apiFetch("/api/import/preview", { method: "POST", json, signal }),
) {
  let current: AbortController | null = null;
  return {
    async select(pendingFile: ImportFile | Promise<ImportFile>) {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      onChange({ status: "loading" });
      try {
        const file = await pendingFile;
        if (controller.signal.aborted) return;
        if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 64 * 1024 * 1024) {
          throw new Error("导入文件不能超过 64 MiB");
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        if (controller.signal.aborted) return;
        const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
        let backup: Record<string, unknown> | undefined;
        let rows: Record<string, unknown>[];
        if (format === "json") {
          const data = JSON.parse(text) as Record<string, unknown>;
          if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("JSON 文件必须是账目或完整备份对象");
          backup = ["version", "categories", "subscriptions", "settlements", "budgets", "budgetPreset", "transactionHistory", "settlementHistory", "creationRequests"].some((key) => key in data) ? data : undefined;
          const rawRows = data.transactions ?? data.rows ?? [];
          if (!Array.isArray(rawRows) || rawRows.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) {
            throw new Error("账目必须是对象数组，文件中存在无法导入的记录");
          }
          rows = rawRows;
        } else {
          rows = parseCsv(text);
        }
        if (!rows.length && !backup) throw new Error("文件中没有可导入的内容");
        const preview = await requestPreview(backup ? { backup } : { format, rows }, controller.signal);
        if (!controller.signal.aborted) onChange({ status: "ready", selection: { format, rows, backup, preview } });
      } catch (error) {
        if (!controller.signal.aborted) onChange({ status: "error", message: errorMessage(error, "无法读取这个文件，请检查格式") });
      }
    },
    cancel() {
      current?.abort();
      current = null;
      onChange({ status: "idle" });
    },
    dispose() {
      current?.abort();
      current = null;
    },
  };
}
