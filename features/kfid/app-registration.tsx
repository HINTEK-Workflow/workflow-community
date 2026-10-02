"use client";
import { useEffect } from "react";

/** The browser's offer to install Workflow as an app, kept until the person asks for it under Inställningar. */
export type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export const INSTALL_PROMPT_EVENT = "hintek:install-prompt";
declare global { interface Window { hintekInstallPrompt?: InstallPrompt | null } }

export function AppRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    // Chrome, Edge and Android offer installation with this event; Workflow shows its own button instead of a banner.
    const keep = (event: Event) => { event.preventDefault(); window.hintekInstallPrompt = event as InstallPrompt; window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT)); };
    const installed = () => { window.hintekInstallPrompt = null; window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT)); };
    window.addEventListener("beforeinstallprompt", keep);
    window.addEventListener("appinstalled", installed);
    return () => { window.removeEventListener("beforeinstallprompt", keep); window.removeEventListener("appinstalled", installed); };
  }, []);
  return null;
}
