"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/components/instance-provider";
import { COOKIE_DETAILS_EVENT, COOKIE_NOTICE_STORAGE_KEY, COOKIE_NOTICE_VERSION, visibleCookieGroups } from "@/lib/cookies";
import { measuredPageNow, readConsent, reportConsentChoice, subscribeConsent, subscribeMeasuredPage, takeCarriedConsent, writeConsent } from "@/lib/analytics/consent-client";
import type { ConsentChoice } from "@/lib/analytics/catalog";

function readSeen() {
  try { return window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) === COOKIE_NOTICE_VERSION; } catch { return false; }
}

/** Opens the cookie details from anywhere, for example the round cookie button in the menu. */
export function openCookieDetails() {
  window.dispatchEvent(new Event(COOKIE_DETAILS_EVENT));
}

/**
 * The small round cookie button (2026-10-03): after the notice is read, the way back to the details. `floating` is the
 * button in the corner of the public pages (2026-11-11): a 48 px round button with the same icon and place as on
 * the public website (the look is .cookie-corner in app/globals.css; the shared spec is in docs/regler/samtycke.md). In the app's menu
 * and on the operator page it stays the smaller button in its row.
 */
export function CookieButton({ className = "", floating = false }: { className?: string; floating?: boolean }) {
  const look = floating ? "cookie-corner" : "flex size-9 items-center justify-center rounded-full border bg-card text-primary shadow-sm transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return <button type="button" onClick={openCookieDetails} aria-label="Ändra cookieval" title="Ändra cookieval" data-testid="cookie-button" className={`${look} ${className}`}>
    <Cookie className={floating ? "size-6" : "size-4"} aria-hidden="true" />
  </button>;
}

/**
 * Kakor (2026-10-03), in the style of the open-source consent tools: a small card the first time, the details in a
 * pop-up grouped by purpose, and afterwards only a round cookie button.
 *
 * Where the installation measures its public pages (`statistics`, Beteendeanalys 2026-10-07) the card is a choice –
 * "Bara nödvändiga" or "Tillåt statistik", equally easy – and on the measured pages themselves (the landing page, Skapa
 * konto) it is a box that blocks the page until the visitor has answered; nothing is loaded or set before that. The
 * round cookie button opens the details, where the choice can be changed at any time. Without statistics (the community
 * edition) nothing optional is stored, so there is only the information as before; see lib/cookies.ts.
 */
export function CookieNotice({ statistics = false }: { statistics?: boolean }) {
  const { features } = useInstance();
  // Read after hydration; the server never shows the card, so nothing flashes for someone who has answered.
  const seen = useSyncExternalStore(() => () => {}, readSeen, () => true);
  const consent = useSyncExternalStore(subscribeConsent, readConsent, (): ConsentChoice | null => "necessary");
  const measured = useSyncExternalStore(subscribeMeasuredPage, measuredPageNow, () => false);
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // An answer given on the public site comes along in the link (2026-10-15): stored here, so the box does not ask again.
  useEffect(() => { if (statistics) takeCarriedConsent(); }, [statistics]);
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
  const closeDetails = () => { setOpen(false); if (asked) window.history.replaceState(null, "", window.location.pathname); };
  const choose = (choice: ConsentChoice) => { writeConsent(choice); reportConsentChoice(choice); acknowledge(); closeDetails(); };
  const decided = statistics ? consent !== null : seen || closed;
  // The page waits for the answer only where it is measured and nothing has been answered.
  const blocking = statistics && !decided && measured;
  // The app has the round button beside the version in its menu and the operator page at the foot of its page; other pages get it in the corner.
  const inApp = (pathname === "/" && !measured) || pathname.startsWith("/operator/") || pathname === "/plc-simulator";
  // The customer's quote page (Fas 2, 2026-10-11): the visitor has come to read and answer, so the notice is one slim
  // line along the bottom edge that never covers the page's own actions (the page keeps room below its content).
  const slim = pathname.startsWith("/offert/");
  const groups = visibleCookieGroups(statistics);
  const choices = <div className="flex flex-wrap gap-2">
    <Button type="button" className="min-w-40 flex-1" onClick={() => choose("necessary")} data-testid="consent-necessary">Bara nödvändiga</Button>
    <Button type="button" className="min-w-40 flex-1" onClick={() => choose("statistics")} data-testid="consent-statistics">Tillåt statistik</Button>
  </div>;
  return <>
    {blocking ? <Dialog.Root open modal>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] max-h-[min(85dvh,40rem)] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-6 shadow-2xl"
          data-testid="consent-dialog" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
          <Dialog.Title className="flex items-center gap-2 text-lg font-semibold"><Cookie className="size-5 text-primary" aria-hidden="true" />Tillåt statistik?</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            Vi mäter hur besökare tar sig runt på de publika sidorna, till exempel startsidan, för att göra dem bättre. Mätningen sker på vår egen server, utan tredje part, och kräver ditt samtycke: ingenting laddas eller sätts förrän du har valt. Kakor som behövs för att logga in och skydda kontot sätts alltid. Du kan ändra dig när som helst med kakknappen.
          </Dialog.Description>
          <details className="mt-4 rounded-xl border text-xs" data-testid="consent-what">
            <summary className="cursor-pointer p-3 font-medium text-foreground">Vad sparas om du tillåter statistik?</summary>
            <div className="space-y-1 border-t p-3 leading-5 text-muted-foreground">
              {groups.filter((group) => group.optional === "statistics").flatMap((group) => group.entries).map((entry) => <div key={entry.name} className="space-y-1">
                <p className="font-mono text-[11px] text-foreground">{entry.name}</p>
                <p><span className="font-medium text-foreground">Ändamål:</span> {entry.purpose}</p>
                <p><span className="font-medium text-foreground">Innehåll:</span> {entry.content}</p>
                <p><span className="font-medium text-foreground">Lagringstid:</span> {entry.lifetime}</p>
              </div>)}
              <p>Hur personuppgifter behandlas står i <Link href="/legal/privacy" className="font-medium text-primary underline-offset-2 hover:underline">integritetspolicyn</Link>.</p>
            </div>
          </details>
          <div className="mt-5">{choices}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root> : null}
    {!decided && !blocking && slim ? <div role="region" aria-label="Kakor" data-testid="cookie-notice" data-slim=""
      className="cookie-notice-slim fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-xs shadow-lg print:hidden">
      <Cookie className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1 basis-48 leading-5 text-muted-foreground">Bara kakor som behövs för att sidan ska fungera. Inget för statistik eller reklam.</p>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>Detaljer</Button>
        <Button type="button" onClick={() => statistics ? choose("necessary") : acknowledge()} data-testid="cookie-notice-ok">OK</Button>
      </div>
    </div> : null}
    {!decided && !blocking && !slim ? <div role="region" aria-label="Kakor" data-testid="cookie-notice"
      className="cookie-notice fixed left-3 z-[60] w-[calc(100%-1.5rem)] max-w-sm rounded-2xl border bg-card p-5 text-sm shadow-xl print:hidden sm:left-6">
      <p className="flex items-center gap-2 font-semibold text-foreground"><Cookie className="size-4 text-primary" aria-hidden="true" />Vi använder kakor</p>
      {statistics
        ? <p className="mt-2 leading-6 text-muted-foreground">Kakor och lagring som behövs för att logga in, skydda kontot och spara det du arbetar med sätts alltid. Vill du dessutom hjälpa oss se hur de publika sidorna används – på vår egen server, utan tredje part – kan du tillåta statistik. Inget används för reklam.</p>
        : <p className="mt-2 leading-6 text-muted-foreground">Bara kakor och lagring i webbläsaren som behövs för att logga in, skydda kontot och spara det du arbetar med. Inget används för statistik eller reklam.</p>}
      {statistics ? <div className="mt-4 space-y-2">{choices}<Button type="button" variant="ghost" className="w-full" onClick={() => setOpen(true)}>Visa detaljer</Button></div>
        : <div className="mt-4 flex gap-2">
          <Button type="button" className="flex-1" onClick={acknowledge}>OK</Button>
          <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(true)}>Visa detaljer</Button>
        </div>}
    </div> : decided && !inApp ? <CookieButton floating /> : null}
    <Dialog.Root open={open || asked} onOpenChange={(next) => { if (!next) closeDetails(); else setOpen(true); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] flex max-h-[min(85dvh,46rem)] w-[min(calc(100%-1.5rem),32.5rem)] max-w-[32.5rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-card shadow-2xl max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0" data-testid="cookie-details">
          <div className="flex items-start gap-3 border-b p-5 max-sm:pt-[calc(1.25rem+env(safe-area-inset-top))]">
            <Cookie className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold">Kakor och lagring i webbläsaren</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-muted-foreground">
                {statistics
                  ? "Det mesta nedan behövs för något du själv gör: att logga in, att skydda kontot, att inte förlora det du arbetar med och att komma ihåg val du har gjort. Det kräver inget samtycke, men du ska veta vad som sparas. Statistik är valfri och sätts bara om du tillåter den."
                  : "Allt nedan behövs för något du själv gör: att logga in, att skydda kontot, att inte förlora det du arbetar med och att komma ihåg val du har gjort. Därför ber vi inte om samtycke, men du ska veta vad som sparas."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Stäng"><X className="size-4" /></Dialog.Close>
          </div>
          <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain p-5 max-sm:flex-1">
            {groups.map((group) => <details key={group.title} className="group rounded-xl border" data-testid="cookie-group">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                <ChevronDown className="size-4 shrink-0 text-muted-foreground -rotate-90 group-open:rotate-0" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{group.title}</span><span className="block text-xs text-muted-foreground">{group.description}</span></span>
                {group.optional === "statistics"
                  ? <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground" data-testid="statistics-state">{consent === "statistics" ? "På" : "Av"}</span>
                  : <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground">Alltid på</span>}
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
              <p><span className="font-medium text-foreground">Andra webbplatser.</span> {features.billing
                ? "Workflow laddar inga skript, typsnitt eller bilder från andra webbplatser. Produktbilder hämtas av vår server, inte av din webbläsare. Loggar du in med Google eller Microsoft, eller betalar via Stripe där installationen tar betalt, skickas du till deras sidor. Där gäller deras egna kakor och villkor."
                : "Workflow laddar inga skript, typsnitt eller bilder från andra webbplatser. Har installationen kopplat en grossist hämtas produktbilderna av installationens server, inte av din webbläsare. Loggar du in med Google eller Microsoft skickas du till deras sidor. Där gäller deras egna kakor och villkor."} AI-anrop görs från servern och sätter inga kakor i din webbläsare.</p>
              <p className="mt-2">Du kan ta bort kakor och lagring i webbläsarens inställningar. Då loggas du ut och osparade utkast i webbläsaren försvinner. Hur personuppgifter behandlas står i <Link href="/legal/privacy" className="font-medium text-primary underline-offset-2 hover:underline">integritetspolicyn</Link>.</p>
            </div>
          </div>
          <div className="border-t p-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {statistics
              ? <div className="space-y-2"><p className="text-xs text-muted-foreground" role="status">{consent === "statistics" ? "Du har tillåtit statistik." : consent === "necessary" ? "Du har valt bara nödvändiga kakor." : "Du har inte valt ännu."}</p>{choices}</div>
              : <div className="flex justify-end gap-2"><Button type="button" onClick={() => { acknowledge(); closeDetails(); }}>Jag förstår</Button></div>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
