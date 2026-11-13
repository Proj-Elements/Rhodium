import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportPreviewStatus } from "@/components/import-preview-status";
import type { ImportPreviewState } from "@/lib/import-preview-controller";

function render(state: ImportPreviewState, disabled = false, busy = false) {
  return renderToStaticMarkup(<ImportPreviewStatus state={state} disabled={disabled} busy={busy} onConfirm={() => {}} onCancel={() => {}} />);
}

const ready: ImportPreviewState = { status: "ready", selection: { format: "json", rows: [], preview: { total: 0, valid: 0, errors: [] } } };

describe("import preview feedback", () => {
  it("shows file-read and network errors persistently without a confirm action", () => {
    const markup = render({ status: "error", message: "文件不是有效 JSON" });
    expect(markup).toContain("文件检查失败");
    expect(markup).toContain("文件不是有效 JSON");
    expect(markup).not.toContain("确认导入");
  });

  it("shows cancellable progress instead of confirming a stale preview", () => {
    const markup = render({ status: "loading" });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("取消");
    expect(markup).not.toContain("确认导入");
  });

  it("disables confirmation when settings are unavailable or an import is in flight", () => {
    expect(render(ready, true)).toMatch(/disabled=""[^>]*>确认导入/);
    expect(render(ready, false, true)).toMatch(/disabled=""[^>]*>/);
  });

  it("retains row validation errors and supports an empty backup envelope", () => {
    expect(render(ready)).toContain("0 / 0 条记录可导入");
    const markup = render({ ...ready, selection: { ...ready.selection, preview: { total: 1, valid: 0, errors: ["第 1 行：日期无效"] } } });
    expect(markup).toContain("第 1 行：日期无效");
    expect(markup).not.toContain("确认导入");
    expect(render({ status: "idle" })).toBe("");
  });

  it("does not offer a green confirmation for a conflicting target ledger", () => {
    const counts = { create: 0, update: 0 };
    const markup = render({ ...ready, selection: { ...ready.selection, preview: { total: 0, valid: 0, errors: [], summary: {
      transactions: { ...counts, unchanged: 0 }, categories: counts, subscriptions: counts, budgets: counts, settlements: counts,
      budgetPreset: { create: 0, update: 0, delete: 0 },
      lockedMonths: ["2026-10"], conflicts: ["结算与目标账目不一致"],
    } } } });
    expect(markup).toContain("结算与目标账目不一致");
    expect(markup).toContain("2026-10");
    expect(markup).not.toContain("文件检查通过");
    expect(markup).not.toContain("确认导入");
  });

  it("shows removal of the default budget before asking to import an empty backup", () => {
    const counts = { create: 0, update: 0 };
    const markup = render({ ...ready, selection: { ...ready.selection, preview: { total: 0, valid: 0, errors: [], summary: {
      transactions: { ...counts, unchanged: 0 }, categories: counts, subscriptions: counts, budgets: counts, settlements: counts,
      budgetPreset: { create: 0, update: 0, delete: 1 }, lockedMonths: [], conflicts: [],
    } } } });
    expect(markup).toContain("默认预算：新增 0，修改 0，删除 1");
    expect(markup).toContain("确认导入");
  });
});
