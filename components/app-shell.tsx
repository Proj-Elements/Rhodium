"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Tooltip } from "@heroui/react";
import { AppLayout, Sidebar } from "@heroui-pro/react";
import { Icon } from "@/components/icon";
import { IconButton } from "@/components/icon-button";
import { requestNewTransaction } from "@/lib/new-transaction-intent";
import { nextColorMode } from "@/lib/theme";
import { useColorMode } from "@/lib/use-color-mode";
import { useToday } from "@/lib/use-today";
import { apiFetch } from "@/lib/api-client";
import { announceLedgerUpdate } from "@/lib/ledger-events";

const navItems = [
  { href: "/dashboard", label: "财务总览", icon: "grid" },
  { href: "/transactions", label: "收支明细", icon: "receipt" },
  { href: "/subscriptions", label: "固定支出", icon: "repeat" },
  { href: "/settlements", label: "月度回顾", icon: "calendar" },
] as const;

const colorModeLabels = { system: "跟随系统", light: "亮色", dark: "暗色" } as const;

const pages: Record<string, { label: string; title: string; description: string }> = {
  "/dashboard": { label: "财务总览", title: "把日子，过得有余。", description: "看清每一笔来去，从容安排接下来的生活。" },
  "/transactions": { label: "收支明细", title: "每一笔，都有迹可循。", description: "日常的小小记录，是留给生活的清晰注脚。" },
  "/subscriptions": { label: "固定支出", title: "固定的事，不必惦记。", description: "管理每月如期而至的支出，让记账自然发生。" },
  "/settlements": { label: "月度回顾", title: "回望一个月，看见新可能。", description: "把生活的轨迹整理好，再轻装走向下个月。" },
  "/settings": { label: "账本设置", title: "你的账本，你的节奏。", description: "设定预算与习惯，让 Rhodium 更懂你的日常。" },
};

export function AppShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const page = pages[pathname] || pages["/dashboard"];
  const today = useToday();
  const [syncState, setSyncState] = useState<"syncing" | "ready" | "error">("syncing");
  const [unknownHistoryCount, setUnknownHistoryCount] = useState(0);
  const { mode, setMode, hydrated, systemDark } = useColorMode();
  const nextMode = nextColorMode(mode, systemDark);

  function openNewTransaction() {
    requestNewTransaction();
    if (pathname !== "/transactions") router.push("/transactions");
  }

  useEffect(() => {
    if (!today) return;
    const controller = new AbortController();
    setSyncState("syncing");
    void apiFetch<{ skippedUnknownHistory?: number }>("/api/subscriptions/sync", { method: "POST", signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setSyncState("ready");
        setUnknownHistoryCount(result.skippedUnknownHistory ?? 0);
        announceLedgerUpdate();
      })
      .catch(() => { if (!controller.signal.aborted) setSyncState("error"); });
    return () => controller.abort();
  }, [today]);

  const sidebarContent = (
    <>
      <Sidebar.Header className="px-5 pb-7 pt-8">
        <Link href="/dashboard" aria-label="Rhodium，回到财务总览" className="flex w-fit items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
          <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M22 46V18h12a9 9 0 0 1 0 18H22m12 0 10 10" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span><b className="block text-[21px] font-semibold tracking-[-0.04em]">Rhodium</b><small className="block text-[10px] tracking-[0.03em] text-muted">A little more to life.</small></span>
        </Link>
      </Sidebar.Header>
      <Sidebar.Content className="gap-5 px-4">
        <Sidebar.Group>
          <Sidebar.GroupLabel className="mb-3 px-3 text-[10px]">日常与计划</Sidebar.GroupLabel>
          <Sidebar.Menu aria-label="主导航" showGuideLines={false}>
            {navItems.map((item) => (
              <Sidebar.MenuItem key={item.href} id={item.href} href={item.href} isCurrent={pathname === item.href} textValue={item.label}>
                <Sidebar.MenuIcon><Icon name={item.icon} size={18} /></Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
                {pathname === item.href && <span className="ml-auto size-1.5 rounded-full bg-accent" aria-hidden="true" />}
              </Sidebar.MenuItem>
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      <Sidebar.Footer className="shrink-0 px-4 pb-6 pt-6">
        <Sidebar.Group>
          <Sidebar.GroupLabel className="mb-3 px-3 text-[10px]">管理与偏好</Sidebar.GroupLabel>
          <Sidebar.Menu aria-label="账本管理" showGuideLines={false}>
            <Sidebar.MenuItem id="/settings" href="/settings" isCurrent={pathname === "/settings"} textValue="账本设置">
              <Sidebar.MenuIcon><Icon name="settings" size={18} /></Sidebar.MenuIcon><Sidebar.MenuLabel>账本设置</Sidebar.MenuLabel>
              {pathname === "/settings" && <span className="ml-auto size-1.5 rounded-full bg-accent" aria-hidden="true" />}
            </Sidebar.MenuItem>
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Footer>
    </>
  );

  const dateLabel = today ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Shanghai" }).format(new Date(`${today}T00:00:00+08:00`)) : "";

  return (
    <AppLayout
      className="ledger-shell"
      navigate={(href) => router.push(href)}
      sidebarCollapsible="none"
      sidebarVariant="sidebar"
      sidebar={<><Sidebar className="ledger-sidebar">{sidebarContent}</Sidebar><Sidebar.Mobile className="ledger-sidebar">{sidebarContent}</Sidebar.Mobile></>}
      navbar={
        <div className="ledger-topbar">
          <div className="flex min-w-0 items-center gap-3 text-xs">
            <Tooltip delay={350}><AppLayout.MenuToggle aria-label="打开导航" variant="ghost" /><Tooltip.Content>打开导航</Tooltip.Content></Tooltip>
            <span className="hidden text-muted sm:inline">我的账本</span><span className="hidden text-muted/50 sm:inline" aria-hidden="true">/</span><span className="font-medium">{page.label}</span>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="hidden text-[11px] tabular-nums text-muted sm:block">{dateLabel}</span>
            <IconButton icon={mode === "system" ? "monitor" : mode === "light" ? "sun" : "moon"} label={`颜色模式：${colorModeLabels[mode]}，切换为${colorModeLabels[nextMode]}`} size="sm" isDisabled={!hydrated} onPress={() => setMode(nextMode)} />
          </div>
        </div>
      }
    >
      <a href="#ledger-content" className="sr-only z-50 rounded-xl bg-overlay px-4 py-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">跳到主要内容</a>
      <div className="ledger-main">
        <header className="page-heading reveal">
          <div><h1 className="page-title outline-none" id="ledger-content" tabIndex={-1}>{page.title}</h1><p className="page-description">{page.description}</p></div>
          <div className="page-actions">{actions !== undefined ? actions : <Button variant="primary" onPress={openNewTransaction}><Icon name="plus" size={16} />记一笔</Button>}</div>
        </header>
        {syncState === "error" && <p role="status" className="mb-5 text-xs text-warning">固定支出同步失败，请刷新重试。</p>}
        {syncState === "ready" && unknownHistoryCount > 0 && <p role="status" className="mb-5 text-xs leading-6 text-warning">有 {unknownHistoryCount} 项固定支出的早期价格未知，早期缺口未自动补记。请在<Link className="underline underline-offset-4" href="/subscriptions">固定支出</Link>核对，并在需要时手动记账。</p>}
        {children}
      </div>
    </AppLayout>
  );
}
