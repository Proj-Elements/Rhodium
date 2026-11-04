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
const colorModeBootScript = `(function(){try{var m=localStorage.getItem("${COLOR_MODE_STORAGE_KEY}");if(m!=="light"&&m!=="dark"){m=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.colorScheme=m}catch(e){document.documentElement.dataset.colorScheme="light"}})()`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script id={COLOR_MODE_SCRIPT_ID} dangerouslySetInnerHTML={{ __html: colorModeBootScript }} />
        {children}
      </body>
    </html>
  );
}
