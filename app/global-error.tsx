"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: this one replaces the root layout, so it is the only
 * error file allowed to render <html>/<body>. Page-level failures are handled
 * by app/error.tsx, which renders inside the existing layout.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body className="grid min-h-screen place-items-center bg-background p-6 text-foreground antialiased">
        <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-surface">
          <p className="mb-3 text-xs text-muted">Rhodium · 稍作停留</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">页面暂时没能打开</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            可以重新加载试试，或先回到总览。如果问题持续，请检查应用服务与数据库连接。
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-foreground"
            >
              重试
            </button>
            <a
              href="/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-surface-secondary px-4 text-sm font-medium text-foreground"
            >
              回到总览
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
