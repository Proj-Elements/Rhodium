"use client";

import { Icon } from "@/components/icon";
import type { ColorMode } from "@/lib/theme";

const options: Array<{ value: ColorMode; label: string; icon: "monitor" | "sun" | "moon" }> = [
  { value: "system", label: "跟随系统", icon: "monitor" },
  { value: "light", label: "亮色", icon: "sun" },
  { value: "dark", label: "暗色", icon: "moon" },
];

/**
 * Three-way segmented control (跟随系统 / 亮 / 暗). Renders as a disabled
 * skeleton until hydration so SSR markup matches the client's first paint.
 */
export function ColorModeToggle({ mode, onChange, hydrated }: { mode: ColorMode; onChange: (mode: ColorMode) => void; hydrated: boolean }) {
  return (
    <div className="color-mode-toggle" role="radiogroup" aria-label="颜色模式">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          disabled={!hydrated}
          className={mode === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          title={option.label}
        >
          <span className="color-mode-icon"><Icon name={option.icon} size={14} /></span>
          <span className="color-mode-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
