"use client";

import { Suspense, useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useBackClosesFirst } from "@/components/history-nav";
import { ListSkeleton, NativeLargeTitle } from "./list";

/**
 * Bottenbladet (mobil 2026-11-18, docs/ui/MOBIL-DESIGNFORSLAG.md): a short choice made with the thumb – the filters of a list –
 * rises from the bottom of the screen over a dimmed page, like Ny in the tab bar. A tap on the dimmed page, the round ×, Escape
 * or Bakåt closes it. Drawn on <body>, so no page around it can clip it or lift something above it. Only for the app look.
 */
export function NativeSheet({ open, onClose, title, children, footer, testId, keepMounted = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode;
  /** A row of its own under the content (Visa resultat), always in sight at the sheet's foot. */
  footer?: ReactNode; testId?: string;
  /**
   * The rows stay mounted, hidden, while the sheet is closed (an editor's ⋯, 2026-11-18): a row that opens a dialog of its own
   * (Exportera) keeps it when the sheet closes, and a lazily loaded row is read with the page, not on the first tap.
   */
  keepMounted?: boolean }) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  const stableClose = useCallback(() => closeRef.current(), []);
  useBackClosesFirst(open ? stableClose : null);
  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>("[data-sheet-title]")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if ((!open && !keepMounted) || typeof document === "undefined") return null;
  const close = <button type="button" className="native-sheet-close" aria-label="Stäng" onClick={() => closeRef.current()} data-testid={testId ? `${testId}-close` : undefined}><X aria-hidden="true" /></button>;
  return createPortal(<>
    {/* data-sheet-layer="top": above a dialog shown as a screen and the tab bar (an editor's ⋯ in a dialog's bar, 2026-11-18). */}
    {open ? <div className="native-sheet-backdrop" data-sheet-layer="top" aria-hidden="true" onClick={() => closeRef.current()} data-testid={testId ? `${testId}-backdrop` : undefined} /> : null}
    <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={title} className="native-sheet" data-sheet="bottom" data-sheet-layer="top" data-testid={open ? testId : undefined} hidden={!open} inert={!open || undefined}>
      <NativeLargeTitle actions={close}><span data-sheet-title tabIndex={-1} className="outline-none">{title}</span></NativeLargeTitle>
      {/* A row that is read in the first time it is drawn (a lazily loaded part of an editor's action) waits here, in the sheet –
          never in the page's own boundary, which would draw the whole page anew and close the sheet (2026-11-18). */}
      <Suspense fallback={<ListSkeleton rows={3} title={false} />}>
        {children}
        {footer ? <div className="native-sheet-footer">{footer}</div> : null}
      </Suspense>
    </div>
  </>, document.body);
}
