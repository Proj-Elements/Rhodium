export type ColorMode = "system" | "light" | "dark";

// Keep the legacy key so the product rename preserves saved preferences.
export const COLOR_MODE_STORAGE_KEY = "yueyu-color-mode";
export const COLOR_MODE_SCRIPT_ID = "color-mode-boot";

export function isColorMode(value: unknown): value is ColorMode {
  return value === "system" || value === "light" || value === "dark";
}

export function readStoredColorMode(): ColorMode {
  try {
    const value = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    return isColorMode(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function storeColorMode(mode: ColorMode): void {
  try {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    // Private browsing or storage disabled — the choice just won't persist.
  }
}

/**
 * Resolve "system" against the OS setting at this moment. Safe on the server
 * only for "light"/"dark"; callers on the server should never resolve system.
 */
export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Map a mode to the html[data-color-scheme] value ("light" | "dark"). */
export function schemeForMode(mode: ColorMode): "light" | "dark" {
  return mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
}

/**
 * Cycle system -> opposite OS scheme -> explicit OS scheme -> system.
 * The first tap visibly changes the theme without skipping either explicit mode.
 */
export function nextColorMode(mode: ColorMode, systemDark: boolean): ColorMode {
  if (mode === "system") return systemDark ? "light" : "dark";
  const systemScheme = systemDark ? "dark" : "light";
  return mode === systemScheme ? "system" : systemScheme;
}
