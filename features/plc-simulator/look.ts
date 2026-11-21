"use client";

import { useEffect } from "react";
import { applyTheme, resolveTheme, type ThemeChoice } from "@/lib/theme";

/** The person's own look, as the workspace sets it, on a page outside the workspace shell: text size and theme, following the device when the choice is "system". */
export function useLook(theme: ThemeChoice, textScale: number) {
  useEffect(() => {
    document.documentElement.style.fontSize = `${(textScale / 100) * 16}px`;
    const device = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(document.documentElement, resolveTheme(theme, device.matches));
    apply();
    if (theme !== "system") return;
    device.addEventListener("change", apply);
    return () => device.removeEventListener("change", apply);
  }, [theme, textScale]);
}
