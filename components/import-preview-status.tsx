"use client";

import React from "react";
import { Alert, Button } from "@heroui/react";
import type { ImportPreviewState } from "@/lib/import-preview-controller";

/** Render every preview state without leaving a stale file available to import. */
export function ImportPreviewStatus({ state, busy, disabled, onConfirm, onCancel }: {
  state: ImportPreviewState;
  busy: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return (
    <div className="mt-4 text-xs text-muted" role="status" aria-live="polite" aria-busy="true">
      正在读取并检查文件…
      <Button size="sm" variant="ghost" onPress={onCancel}>取消</Button>
    </div>
  );
  if (state.status === "error") return (
    <Alert className="mt-4" status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>文件检查失败</Alert.Title>
        <Alert.Description>{state.message}</Alert.Description>
        <Button size="sm" variant="ghost" className="mt-3" onPress={onCancel}>关闭</Button>
      </Alert.Content>
    </Alert>
  );
  const { preview } = state.selection;
  const issues = [
    ...preview.errors,
    ...(preview.summary?.conflicts ?? []),
    ...(preview.summary?.lockedMonths.length ? [`已结算月份：${preview.summary.lockedMonths.join("、")}`] : []),
  ];
  return (
    <Alert className="mt-4" status={issues.length ? "danger" : "success"}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{issues.length ? "文件或目标账本需要处理" : "文件检查通过"}</Alert.Title>
        <Alert.Description>{preview.valid} / {preview.total} 条记录可导入</Alert.Description>
        {preview.summary && <div className="mt-3 flex flex-col gap-1 text-xs" aria-label="导入变更摘要">
          <p>账目：新增 {preview.summary.transactions.create}，修改 {preview.summary.transactions.update}，不变 {preview.summary.transactions.unchanged}</p>
          <p>分类：新增 {preview.summary.categories.create}，修改 {preview.summary.categories.update}；固定支出：新增 {preview.summary.subscriptions.create}，修改 {preview.summary.subscriptions.update}</p>
          <p>月度预算：新增 {preview.summary.budgets.create}，修改 {preview.summary.budgets.update}；结算：新增 {preview.summary.settlements.create}，修改 {preview.summary.settlements.update}</p>
          <p>默认预算：新增 {preview.summary.budgetPreset.create}，修改 {preview.summary.budgetPreset.update}，删除 {preview.summary.budgetPreset.delete}</p>
        </div>}
        {issues.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
          {[...new Set(issues)].slice(0, 5).map((item) => <li key={item}>{item}</li>)}
        </ul>}
        <div className="mt-3 flex flex-wrap gap-2">
          {!issues.length && <Button size="sm" onPress={onConfirm} isPending={busy} isDisabled={disabled || busy}>确认导入</Button>}
          <Button size="sm" variant="ghost" isDisabled={busy} onPress={onCancel}>取消</Button>
        </div>
      </Alert.Content>
    </Alert>
  );
}
