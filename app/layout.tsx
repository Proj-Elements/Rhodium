import type { Metadata } from "next";
import type { ReactNode } from "react";
import { COLOR_MODE_SCRIPT_ID, COLOR_MODE_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rhodium · 个人生活账本",
  applicationName: "Rhodium",
  description: "记录每天的花销，也看见每个月的余量。",
};

/**
 * Runs before first paint: applies the stored color mode (or the OS scheme)
 * so the page never flashes the wrong theme. Kept tiny and dependency-free.
 */
const colorModeBootScript = `(function(){try{var m=localStorage.getItem("${COLOR_MODE_STORAGE_KEY}");if(m!=="light"&&m!=="dark"){m=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}var el=document.documentElement;el.dataset.colorScheme=m;el.dataset.theme=m;el.classList.toggle("dark",m==="dark");el.classList.toggle("light",m==="light")}catch(e){var el=document.documentElement;el.dataset.colorScheme="light";el.dataset.theme="light";el.classList.remove("dark");el.classList.add("light")}})()`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <script id={COLOR_MODE_SCRIPT_ID} dangerouslySetInnerHTML={{ __html: colorModeBootScript }} />
        {children}
      </body>
    </html>
  );
}
