"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--canvas, #f7f7f4)", color: "var(--ink, #26251e)", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>页面出了点问题</h1>
          <p style={{ color: "var(--body, #5a5852)", fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
            账本数据没有受到影响。可以重试一下，或者回到概览页继续记账。
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button type="button" onClick={reset} style={{ minHeight: 40, padding: "10px 18px", border: 0, borderRadius: 8, background: "var(--orange, #f54e00)", color: "#fff", fontSize: 14, cursor: "pointer" }}>
              重试
            </button>
            <a href="/dashboard" style={{ display: "inline-flex", alignItems: "center", minHeight: 40, padding: "10px 18px", border: "1px solid var(--line, #e6e5e0)", borderRadius: 8, background: "#fff", color: "var(--ink, #26251e)", fontSize: 14, textDecoration: "none" }}>
              回到概览
            </a>
          </div>
        </div>
      );
}
