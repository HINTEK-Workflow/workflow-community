"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COOKIE_DETAILS_EVENT, COOKIE_GROUPS, COOKIE_NOTICE_STORAGE_KEY, COOKIE_NOTICE_VERSION } from "@/lib/cookies";

function readSeen() {
  try { return window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) === COOKIE_NOTICE_VERSION; } catch { return false; }
}

/** Opens the cookie details from anywhere, for example the round cookie button in the menu. */
export function openCookieDetails() {
  window.dispatchEvent(new Event(COOKIE_DETAILS_EVENT));
}

/** The small round cookie button (2026-10-03): after the notice is read, the way back to the details. */
export function CookieButton({ className = "" }: { className?: string }) {
  return <button type="button" onClick={openCookieDetails} aria-label="Om kakor och lagring" title="Om kakor och lagring" data-testid="cookie-button"
    className={`flex size-9 items-center justify-center rounded-full border bg-card text-primary shadow-sm transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}>
    <Cookie className="size-4" aria-hidden="true" />
  </button>;
}

/**
 * Kakor (2026-10-03), in the style of the open-source consent tools: a small card the first time ("Vi använder
 * kakor", OK or Visa detaljer), the details in a pop-up grouped by purpose and marked "Alltid på", and afterwards only a
 * round cookie button. Nothing optional is stored, so there is nothing to accept or refuse; see lib/cookies.ts.
 */
export function CookieNotice() {
  // Read after hydration; the server never shows the card, so nothing flashes for someone who has read it.
  const seen = useSyncExternalStore(() => () => {}, readSeen, () => true);
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(COOKIE_DETAILS_EVENT, show);
    return () => window.removeEventListener(COOKIE_DETAILS_EVENT, show);
  }, []);
  // /cookies sends people to the login page with ?kakor=1, which opens the details.
  const asked = searchParams.get("kakor") === "1";
  const acknowledge = () => {
    try { window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, COOKIE_NOTICE_VERSION); } catch { /* shown again next time */ }
    setClosed(true);
  };
  const read = seen || closed;
  // The app has the round button beside the version in its menu; other pages get it in the corner.
  const inApp = pathname === "/";
  return <>
    {!read ? <div role="region" aria-label="Kakor" data-testid="cookie-notice"
      className="cookie-notice fixed left-3 z-[60] w-[calc(100%-1.5rem)] max-w-sm rounded-2xl border bg-card p-5 text-sm shadow-xl print:hidden sm:left-6">
      <p className="flex items-center gap-2 font-semibold text-foreground"><Cookie className="size-4 text-primary" aria-hidden="true" />Vi använder kakor</p>
      <p className="mt-2 leading-6 text-muted-foreground">Bara kakor och lagring i webbläsaren som behövs för att logga in, skydda kontot och spara det du arbetar med. Inget används för statistik eller reklam.</p>
      <div className="mt-4 flex gap-2">
        <Button type="button" className="flex-1" onClick={acknowledge}>OK</Button>
        <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(true)}>Visa detaljer</Button>
      </div>
    </div> : !inApp ? <CookieButton className="cookie-corner fixed left-4 z-[60] print:hidden" /> : null}
    <Dialog.Root open={open || asked} onOpenChange={(next) => { setOpen(next); if (!next && asked) window.history.replaceState(null, "", window.location.pathname); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] flex max-h-[min(88dvh,46rem)] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-card shadow-2xl" data-testid="cookie-details">
          <div className="flex items-start gap-3 border-b p-5">
            <Cookie className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold">Kakor och lagring i webbläsaren</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-muted-foreground">
                Allt nedan behövs för något du själv gör: att logga in, att skydda kontot, att inte förlora det du arbetar med och att komma ihåg val du har gjort. Därför ber vi inte om samtycke, men du ska veta vad som sparas.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Stäng"><X className="size-4" /></Dialog.Close>
          </div>
          <div className="space-y-2 overflow-y-auto p-5">
            {COOKIE_GROUPS.map((group) => <details key={group.title} className="group rounded-xl border" data-testid="cookie-group">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{group.title}</span><span className="block text-xs text-muted-foreground">{group.description}</span></span>
                <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground">Alltid på</span>
              </summary>
              <ul className="divide-y border-t text-xs">
                {group.entries.map((entry) => <li key={entry.name} className="grid gap-1 p-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-4" data-testid="cookie-entry">
                  <div className="min-w-0"><p className="break-words font-mono text-[11px] text-foreground">{entry.name}</p><p className="mt-0.5 text-muted-foreground">{entry.kind}</p></div>
                  <div className="min-w-0 space-y-0.5 text-muted-foreground">
                    <p><span className="font-medium text-foreground">Ändamål:</span> {entry.purpose}</p>
                    <p><span className="font-medium text-foreground">Innehåll:</span> {entry.content}</p>
                    <p><span className="font-medium text-foreground">Lagringstid:</span> {entry.lifetime}</p>
                  </div>
                </li>)}
              </ul>
            </details>)}
            <div className="rounded-xl bg-muted/40 p-4 text-xs leading-5 text-muted-foreground">
              <p><span className="font-medium text-foreground">Andra webbplatser.</span> Workflow laddar inga skript, typsnitt eller bilder från andra webbplatser. Loggar du in med Google, eller betalar via Stripe där installationen tar betalt, skickas du till deras sidor; där gäller deras egna kakor och villkor. AI-anrop görs från servern och sätter inga kakor i din webbläsare.</p>
              <p className="mt-2">Du kan ta bort kakor och lagring i webbläsarens inställningar. Då loggas du ut och osparade utkast i webbläsaren försvinner. Hur personuppgifter behandlas står i <Link href="/legal/privacy" className="font-medium text-primary underline-offset-2 hover:underline">integritetspolicyn</Link>.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t p-4">
            <Button type="button" onClick={() => { acknowledge(); setOpen(false); if (asked) window.history.replaceState(null, "", window.location.pathname); }}>Jag förstår</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
