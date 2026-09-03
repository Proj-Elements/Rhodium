"use client";

import { useCallback, useEffect, useState } from "react";
import { readStoredColorMode, schemeForMode, storeColorMode, systemPrefersDark, type ColorMode } from "@/lib/theme";

/**
 * Single source of truth for the color mode. Mirrors the boot script in
 * app/layout.tsx: reads the stored choice on mount, keeps html's
 * data-color-scheme in sync, and follows OS changes while in "system" mode.
 * Starts as "system" so server and client render identically.
 */
export function useColorMode() {
  const [mode, setMode] = useState<ColorMode>("system");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setMode(readStoredColorMode());
    setHydrated(true);
  }, []);

  // Apply the mode to <html> whenever it changes, and (while in "system")
  // keep following the OS scheme live.
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.colorScheme = schemeForMode(mode);
    };
    apply();
    if (mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [mode]);

  const setModeAndStore = useCallback((next: ColorMode) => {
    setMode(next);
    storeColorMode(next);
  }, []);

  return { mode, setMode: setModeAndStore, hydrated, systemDark: systemPrefersDark() };
}
