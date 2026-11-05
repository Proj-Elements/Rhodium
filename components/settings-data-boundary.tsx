"use client";

import React, { type ReactNode } from "react";
import { Alert, Button } from "@heroui/react";

/** Keep unavailable settings distinct from a successfully loaded empty ledger. */
export function SettingsDataBoundary({ error, onRetry, children }: { error: string; onRetry: () => void; children: ReactNode }) {
  if (!error) return <>{children}</>;
  return (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{error}</Alert.Title>
        <Alert.Description>尚未取得当前设置，暂时不能修改预算、分类或导入记录。</Alert.Description>
        <Button size="sm" variant="outline" className="mt-3" onPress={onRetry}>重新加载</Button>
      </Alert.Content>
    </Alert>
  );
}
