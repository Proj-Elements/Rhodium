"use client";

import { useEffect } from "react";
import { Button, Card } from "@heroui/react";
import { Icon } from "@/components/icon";

/**
 * Page-level boundary. It renders inside the root layout's <body>, so it must
 * not emit <html>/<body> itself — that belongs to app/global-error.tsx.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className="panel w-full max-w-md items-center p-8 text-center sm:p-12">
        <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-warning-soft text-warning-soft-foreground"><Icon name="info" size={24} /></span>
        <p className="mb-2 text-xs text-muted">Rhodium · 稍作停留</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">页面暂时没能打开</h1>
        <p className="mt-3 text-sm leading-7 text-muted">
          可以重新加载试试，或先回到总览。如果问题持续，请检查应用服务与数据库连接。
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="primary" onPress={reset}>
            重试
          </Button>
          <a
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-surface-secondary px-4 text-sm font-medium text-foreground transition hover:bg-default"
          >
            回到总览
          </a>
        </div>
      </Card>
    </main>
  );
}
