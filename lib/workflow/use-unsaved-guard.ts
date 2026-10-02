"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Ask = (options: { title: string; message: string; confirmLabel: string; tone: "danger" }) => Promise<boolean>;

// Unsaved work is never lost silently (2026-10-02, the day simulation): the browser asks when the tab is closed or
// reloaded, and an in-app link is stopped, asked about with the in-app card and then followed.
export function useUnsavedGuard(active: boolean, ask: Ask, what = "uppgiften") {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest("a");
      if (anchor && anchor.origin === location.origin && anchor.href !== location.href && !anchor.hasAttribute("download") && anchor.target !== "_blank") {
        event.preventDefault();
        event.stopPropagation();
        const href = anchor.href;
        void ask({ title: `Lämna ${what}?`, message: "Ändringar som inte har sparats går förlorade.", confirmLabel: "Lämna utan att spara", tone: "danger" }).then((ok) => { if (ok) router.push(href.slice(location.origin.length)); });
      }
    };
    window.addEventListener("beforeunload", handler);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", handler);
      document.removeEventListener("click", navigate, true);
    };
  }, [active, ask, router, what]);
}

