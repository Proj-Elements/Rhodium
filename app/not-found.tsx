import Link from "next/link";
export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--canvas, #f7f7f4)", color: "var(--ink, #26251e)", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
          <p style={{ margin: "0 0 8px", color: "var(--muted, #807d72)", fontSize: 13, letterSpacing: 1 }}>404</p>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>这里没有账目</h1>
          <p style={{ color: "var(--body, #5a5852)", fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
            你访问的页面不存在，或者已经被移动了。
          </p>
          <Link href="/dashboard" style={{ display: "inline-flex", alignItems: "center", minHeight: 40, padding: "10px 18px", border: 0, borderRadius: 8, background: "var(--orange, #f54e00)", color: "#fff", fontSize: 14, textDecoration: "none" }}>
            回到概览
          </Link>
        </div>
      );
}
