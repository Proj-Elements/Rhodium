"use client";

import { Icon as IconifyIcon } from "@iconify/react";
import icons from "@/lib/gravity-icons.json";
import { resolveCategoryIcon } from "@/lib/category-icons";

export type IconName = keyof typeof icons;

/** Bundled Gravity UI icons render offline without external network requests. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number; stroke?: number }) {
  return <IconifyIcon icon={icons[name]} width={size} height={size} aria-hidden="true" />;
}

export function CategoryIcon({ categoryName, type, icon, size = 17 }: { categoryName: string; type: "EXPENSE" | "INCOME" | "BOTH"; icon?: string | null; size?: number; stroke?: number }) {
  return <Icon name={resolveCategoryIcon(categoryName, type, icon)} size={size} />;
}
