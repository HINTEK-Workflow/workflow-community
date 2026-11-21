"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { returnToOrigin, stepBack } from "@/components/history-nav";
import { pickParam, returnLabel, returnOf, returnTargetWord, returnWithPick, RETURN_PARAM, withReturn, type PickKind } from "@/lib/workflow/return-link";
import { withParam } from "@/lib/workflow/navigation";

/**
 * Samband (2026-10-26, lib/workflow/return-link.ts): the way back a sub-page was opened with. One hook for every
 * sub-page, so Avbryt, Spara and "Tillbaka till …" behave the same everywhere:
 * - `cancel()` goes exactly one step back (to the page it came from, as it was; opened directly: to `returnTo`);
 * - `done(kind, id)` goes back there with the new thing marked for the field it was asked for (`usePicked` takes it);
 * - `pass(href)` keeps the way back on a link onward in the same chain (Ny uppgift → the chosen type).
 * Null when the page was not opened as a sub-page: it then behaves as before.
 */
export function useReturnTo() {
  const params = useSearchParams();
  const router = useRouter();
  const returnTo = returnOf(params);
  return useMemo(() => {
    if (!returnTo) return null;
    const replace = (href: string) => router.replace(href, { scroll: false });
    return {
      returnTo,
      /** "arbetsordern", "projektet" … */
      word: returnTargetWord(returnTo),
      /** "Tillbaka till arbetsordern". */
      label: returnLabel(returnTo),
      cancel: () => stepBack(returnTo, router.push),
      done: (kind?: PickKind, id?: string) => returnToOrigin(returnTo, router.push, { then: kind && id ? returnWithPick(returnTo, kind, id) : undefined, replace }),
      pass: (href: string) => withParam(href, RETURN_PARAM, returnTo),
    };
  }, [returnTo, router]);
}

/** The address of the page the person is on, for a link that opens a sub-page from it (`withReturn(href, here)`). */
export function useHere(): string {
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

/** A link to a sub-page that comes back here: `useSubPageHref()(href)`. */
export function useSubPageHref() {
  const here = useHere();
  return (href: string) => withReturn(href, here);
}

/**
 * The field a sub-page was opened for takes what was made there, once (`pick<Kind>=<id>` on the way back), and the marker
 * leaves the address so a reload or Bakåt does not take it again. `onPick` returns false while it cannot take it yet
 * (the list it chooses from is still being read); it is offered again on the next render.
 */
export function usePicked(kind: PickKind, onPick: (id: string) => boolean | void, enabled = true) {
  const params = useSearchParams();
  const router = useRouter();
  const key = pickParam(kind);
  const picked = params.get(key);
  const handled = useRef<string | null>(null);
  const latest = useRef(onPick);
  useEffect(() => { latest.current = onPick; });
  useEffect(() => {
    if (!picked || !enabled || handled.current === picked) return;
    if (latest.current(picked) === false) return;
    handled.current = picked;
    const next = new URLSearchParams(window.location.search);
    next.delete(key);
    const query = next.toString();
    router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`, { scroll: false });
  });
  return picked;
}

/**
 * "Tillbaka till arbetsordern" in a sub-page's header (top right, left of its primary action), shown only when the page was
 * opened as a sub-page. A page whose work is saved as it goes (a protocol, the article search) uses it as its way back.
 */
export function ReturnButton({ variant = "outline", testId = "return-to-origin" }: { variant?: "outline" | "default"; testId?: string }) {
  const back = useReturnTo();
  if (!back) return null;
  return <Button type="button" variant={variant} onClick={() => back.done()} data-testid={testId}><Undo2 />{back.label}</Button>;
}
