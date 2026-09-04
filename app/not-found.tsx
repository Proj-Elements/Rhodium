import Link from "next/link";
import {
  fallbackBodyStyle,
  fallbackBodyTextStyle,
  fallbackEyebrowStyle,
  fallbackPanelStyle,
  fallbackPrimaryActionStyle,
  fallbackTitleStyle,
} from "@/lib/fallback-styles";

export default function NotFound() {
  return (
    <html lang="zh-CN">
      <body style={fallbackBodyStyle}>
        <main style={fallbackPanelStyle}>
          <p style={fallbackEyebrowStyle}>404</p>
          <h1 style={fallbackTitleStyle}>这里没有账目</h1>
          <p style={fallbackBodyTextStyle}>你访问的页面不存在，或者已经被移动了。</p>
          <Link href="/dashboard" style={fallbackPrimaryActionStyle}>
            回到概览
          </Link>
        </main>
      </body>
    </html>
  );
}
