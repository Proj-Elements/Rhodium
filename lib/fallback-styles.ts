import type { CSSProperties } from "react";

/**
 * `app/error.tsx` and `app/not-found.tsx` render their own <html>/<body>, so they
 * sit outside the app layout and cannot rely on globals.css being loaded. Both
 * therefore inline their styles; sharing them here keeps the two pages from
 * drifting apart. The CSS variables still win when the stylesheet did load.
 */
export const fallbackBodyStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "var(--canvas, #f7f7f4)",
  color: "var(--ink, #26251e)",
  fontFamily: "system-ui, sans-serif",
};

export const fallbackPanelStyle: CSSProperties = { maxWidth: 420, padding: 32, textAlign: "center" };

export const fallbackEyebrowStyle: CSSProperties = {
  margin: "0 0 8px",
  color: "var(--muted, #807d72)",
  fontSize: 13,
  letterSpacing: 1,
};

export const fallbackTitleStyle: CSSProperties = { fontSize: 22, fontWeight: 600, margin: "0 0 12px" };

export const fallbackBodyTextStyle: CSSProperties = {
  color: "var(--body, #5a5852)",
  fontSize: 14,
  lineHeight: 1.6,
  margin: "0 0 20px",
};

const fallbackActionBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 40,
  padding: "10px 18px",
  borderRadius: 8,
  fontSize: 14,
  textDecoration: "none",
};

export const fallbackPrimaryActionStyle: CSSProperties = {
  ...fallbackActionBase,
  border: 0,
  background: "var(--orange, #f54e00)",
  color: "#fff",
  cursor: "pointer",
};

export const fallbackSecondaryActionStyle: CSSProperties = {
  ...fallbackActionBase,
  border: "1px solid var(--line, #e6e5e0)",
  background: "var(--card, #fff)",
  color: "var(--ink, #26251e)",
  cursor: "pointer",
};

export const fallbackActionsRowStyle: CSSProperties = { display: "flex", gap: 10, justifyContent: "center" };
