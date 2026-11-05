"use client";

import Link from "next/link";
import { Card } from "@heroui/react";

/** Renders inside the root layout's <body>; no <html>/<body> here. */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className="panel w-full max-w-md items-center p-8 text-center sm:p-12">
        <span className="brand-mark mb-6" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M22 46V18h12a9 9 0 0 1 0 18H22m12 0 10 10" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <p className="text-6xl font-medium tracking-tighter tabular-nums text-accent/40">404</p>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">这一页，走丢了</h1>
        <p className="mt-3 text-sm leading-7 text-muted">
          这里暂时没有内容。回到熟悉的地方，继续记录你的生活。
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-5 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          >
            回到总览
          </Link>
        </div>
      </Card>
    </main>
  );
}
