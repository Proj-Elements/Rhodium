"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import { ColorModeToggle } from "@/components/color-mode-toggle";
import { useColorMode } from "@/lib/use-color-mode";

type NavItem = { href: string; label: string; description: string; icon: "grid" | "receipt" | "repeat" | "calendar" | "settings" };

const navItems: NavItem[] = [
  { href: "/dashboard", label: "概览", description: "本月状态", icon: "grid" },
  { href: "/transactions", label: "账目", description: "逐笔记录", icon: "receipt" },
  { href: "/subscriptions", label: "固定支出", description: "自动记账", icon: "repeat" },
  { href: "/settlements", label: "月度回顾", description: "结算与趋势", icon: "calendar" },
];

const secondaryItems: NavItem[] = [{ href: "/settings", label: "设置", description: "分类与数据", icon: "settings" }];

const titles: Record<string, { eyebrow: string; title: string; description: string }> = {
  "/dashboard": { eyebrow: "MONTHLY OVERVIEW", title: "把这个月，过得有数。", description: "记录日常的小额选择，也看见预算还剩下多少空间。" },
  "/transactions": { eyebrow: "LEDGER", title: "每一笔，都有出处。", description: "按日期回看你的日常花销，也可以随时补记或修正。" },
  "/subscriptions": { eyebrow: "RECURRING", title: "固定的支出，交给月余记得。", description: "让每月都会发生的费用自动出现，少一点遗忘，多一点确定。" },
  "/settlements": { eyebrow: "MONTHLY REVIEW", title: "这个月，留下些什么？", description: "用一次月末回顾，把花销变成下一月更好的参考。" },
  "/settings": { eyebrow: "SETTINGS", title: "把账本调成你的样子。", description: "管理分类、导入旧账，或把数据完整地带走。" },
};

/** Mirrors the CSS breakpoint: below this width the mobile chrome is used. */
const MOBILE_QUERY = "(max-width: 900px)";

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return <Link href={item.href} className={`nav-item${active ? " active" : ""}`}>
    <span className="nav-icon"><Icon name={item.icon} size={17} /></span>
    <span className="nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
    {active && <span className="nav-dot" />}
  </Link>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const page = titles[pathname] || titles["/dashboard"];
  const [syncState, setSyncState] = useState<"syncing" | "ready" | "error">("syncing");
  const isMobile = useIsMobileViewport();
  const { mode, setMode: setColorMode, hydrated: themeHydrated } = useColorMode();

  useEffect(() => {
    let mounted = true;
    fetch("/api/subscriptions/sync", { method: "POST" })
      .then((response) => { if (!response.ok) throw new Error("sync failed"); if (mounted) setSyncState("ready"); })
      .catch(() => { if (mounted) setSyncState("error"); });
    return () => { mounted = false; };
  }, []);

  const syncLabel = syncState === "syncing" ? "正在同步固定支出" : syncState === "error" ? "同步稍后重试" : "固定支出已同步";

  return <div className="app-frame">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand-lockup" aria-label="回到月余概览">
        <span className="brand-mark"><span>月</span></span>
        <span className="brand-copy"><b>月余</b><small>PERSONAL LEDGER</small></span>
      </Link>
      <div className="sidebar-rule" />
      <nav className="side-nav" aria-label="主导航">
        <p className="nav-label">账本空间</p>
        {navItems.map((item) => <NavLink key={item.href} item={item} active={pathname === item.href} />)}
        <p className="nav-label secondary-label">工具</p>
        {secondaryItems.map((item) => <NavLink key={item.href} item={item} active={pathname === item.href} />)}
      </nav>
      <div className="sidebar-spacer" />
      <div className="theme-toggle-row">
        <ColorModeToggle mode={mode} onChange={setColorMode} hydrated={themeHydrated} />
      </div>
      <div className="sidebar-note">
        <span className="note-kicker"><Icon name="spark" size={12} /> SMALL HABIT</span>
        <p>记下一杯饮料，<br />也记住自己的节奏。</p>
        <Link href="/transactions?new=1" className="text-link">现在记一笔 <Icon name="arrow" size={14} /></Link>
      </div>
      <div className="sync-status"><span className={`sync-dot ${syncState}`} />{syncLabel}</div>
      <div className="sidebar-footer">CNY · ASIA/SHANGHAI</div>
    </aside>
    <main className="main-content">
      {/* Mobile chrome is only mounted on narrow viewports; previously it was
          always in the DOM and merely hidden by CSS, so any stylesheet glitch
          leaked the nav bar onto wide screens (top-right of the window). */}
      {isMobile && (
        <>
          <div className="mobile-topbar">
            <Link href="/dashboard" className="mobile-brand"><span className="brand-mark"><span>月</span></span><strong>月余</strong></Link>
            <div className="mobile-topbar-actions">
              <button
                type="button"
                className="icon-button theme-cycle-button"
                aria-label={`颜色模式：${mode === "system" ? "跟随系统" : mode === "light" ? "亮色" : "暗色"}（点按切换）`}
                disabled={!themeHydrated}
                onClick={() => setColorMode(mode === "system" ? (themeHydrated && document.documentElement.dataset.colorScheme === "dark" ? "light" : "dark") : mode === "light" ? "dark" : "system")}
              >
                <Icon name={mode === "system" ? "monitor" : mode === "light" ? "sun" : "moon"} size={16} />
              </button>
              <Link href="/transactions?new=1" className="button button-primary button-small"><Icon name="plus" size={15} />记一笔</Link>
            </div>
          </div>
          <nav className="mobile-nav" aria-label="移动端导航">
            {[...navItems, ...secondaryItems].map((item) => <Link href={item.href} key={item.href} className={pathname === item.href ? "active" : ""}><Icon name={item.icon} size={18} /><span>{item.label}</span></Link>)}
          </nav>
        </>
      )}
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p className="page-description">{page.description}</p>
        </div>
        <Link href="/transactions?new=1" className="button button-primary page-cta"><Icon name="plus" size={17} />记一笔</Link>
      </header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}
