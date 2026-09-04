"use client";

import { useEffect } from "react";
import {
  fallbackActionsRowStyle,
  fallbackBodyStyle,
  fallbackBodyTextStyle,
  fallbackPanelStyle,
  fallbackPrimaryActionStyle,
  fallbackSecondaryActionStyle,
  fallbackTitleStyle,
} from "@/lib/fallback-styles";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body style={fallbackBodyStyle}>
        <main style={fallbackPanelStyle}>
          <h1 style={fallbackTitleStyle}>页面出了点问题</h1>
          <p style={fallbackBodyTextStyle}>账本数据没有受到影响。可以重试一下，或者回到概览页继续记账。</p>
          <div style={fallbackActionsRowStyle}>
            <button type="button" onClick={reset} style={fallbackPrimaryActionStyle}>
              重试
            </button>
            <a href="/dashboard" style={fallbackSecondaryActionStyle}>
              回到概览
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
