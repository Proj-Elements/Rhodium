import { apiFetch, errorMessage } from "@/lib/api-client";
import { parseCsv } from "@/lib/csv";

export type ImportPreview = {
  total: number;
  valid: number;
  errors: string[];
  preview?: { index: number; date: string; amount: unknown; note: unknown }[];
};

type ImportFile = Pick<File, "name" | "text">;
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

type PreviewRequest = (body: Omit<ImportSelection, "preview">, signal?: AbortSignal) => Promise<ImportPreview>;

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
        const text = await file.text();
        if (controller.signal.aborted) return;
        const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
        let backup: Record<string, unknown> | undefined;
        let rows: Record<string, unknown>[];
        if (format === "json") {
          const data = JSON.parse(text) as Record<string, unknown>;
          backup = data.version ? data : undefined;
          const rawRows = data.transactions || data.rows;
          rows = Array.isArray(rawRows)
            ? rawRows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
            : [];
        } else {
          rows = parseCsv(text);
        }
        if (!rows.length && !backup) throw new Error("文件中没有可导入的内容");
        const preview = await requestPreview({ format, rows, backup }, controller.signal);
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
