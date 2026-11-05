"use client";

import { Segment } from "@heroui-pro/react";
import { Icon } from "@/components/icon";
import type { ColorMode } from "@/lib/theme";

const options: Array<{ value: ColorMode; label: string; icon: "monitor" | "sun" | "moon" }> = [
  { value: "system", label: "跟随系统", icon: "monitor" },
  { value: "light", label: "亮色", icon: "sun" },
  { value: "dark", label: "暗色", icon: "moon" },
];

/**
 * Three-way segmented control (跟随系统 / 亮 / 暗). Renders as a disabled
 * control until hydration so SSR markup matches the client's first paint.
 */
export function ColorModeToggle({
  mode,
  onChange,
  hydrated,
}: {
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
  hydrated: boolean;
}) {
  return (
    <Segment
      aria-label="颜色模式"
      size="sm"
      selectedKey={mode}
      isDisabled={!hydrated}
      onSelectionChange={(key) => {
        if (key === "system" || key === "light" || key === "dark") {
          onChange(key);
        }
      }}
      className="w-full"
    >
      {options.map((option) => (
        <Segment.Item
          key={option.value}
          id={option.value}
          aria-label={option.label}
          className="flex-1 justify-center gap-1.5 text-xs"
        >
          <Icon name={option.icon} size={14} />
          <span>{option.value === "system" ? "自动" : option.label}</span>
        </Segment.Item>
      ))}
    </Segment>
  );
}
