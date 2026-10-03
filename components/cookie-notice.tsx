"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COOKIE_NOTICE_STORAGE_KEY, COOKIE_NOTICE_VERSION } from "@/lib/cookies";

function readSeen() {
  try { return window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) === COOKIE_NOTICE_VERSION; } catch { return false; }
}

/**
 * Kakor (2026-10-03): tells every visitor once that Workflow only uses cookies and browser storage that are
 * needed for the service, with a link to the full list. Nothing optional is used, so there is nothing to accept or
 * refuse; the notice is remembered per browser and shown again when the list changes (a new version).
 */
export function CookieNotice() {
  // Read from the browser after hydration; the server never shows it, so nothing flashes for someone who has seen it.
  const seen = useSyncExternalStore(() => () => {}, readSeen, () => true);
  const [closed, setClosed] = useState(false);
  if (seen || closed) return null;
  const close = () => {
    try { window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, COOKIE_NOTICE_VERSION); } catch { /* shown again next time */ }
    setClosed(true);
  };
  return <div role="region" aria-label="Information om kakor" data-testid="cookie-notice"
    className="cookie-notice fixed inset-x-3 z-[60] mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm shadow-lg print:hidden sm:inset-x-6">
    <Cookie className="size-5 shrink-0 text-primary" aria-hidden="true" />
    <p className="min-w-0 flex-1 text-foreground">
      Vi använder bara kakor och lokal lagring som behövs för att du ska kunna logga in, för säkerheten och för dina egna inställningar. Inga kakor för statistik eller marknadsföring.{" "}
      <Link href="/cookies" className="font-medium text-primary underline-offset-2 hover:underline">Läs mer om kakor</Link>
    </p>
    <Button type="button" onClick={close} className="shrink-0">Jag förstår</Button>
  </div>;
}
