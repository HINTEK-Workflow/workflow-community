"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * An editor's canvas shows the page as a visitor on this screen sees it (2026-11-12: "det jag ser i redigeraren är det
 * som är live"; the landing editor and Min webbsida). The canvas is narrower than the screen (the settings panel and the app's
 * menu take room), but the page's layout follows the screen's width (its media rules, or on Min webbsida the site's width
 * queries as container queries), so the canvas lays the page out at the screen's own width – the public page's width – and
 * scales it down to fit. `scaled` false shows it at its natural size in the canvas instead (larger texts to edit, but the
 * layout of a narrower page is not what a visitor on this screen gets).
 *
 * The page's width is the body's: the app's page and the public page have the same root (a scroll bar that is always there,
 * `overflow-y: scroll` with a stable gutter), so the body is as wide here as on the public page – with a classic scroll bar
 * and with an overlay one alike (a probe element's scroll bar said 0 where the page still kept a 15 px gutter).
 */
export function TrueWidth({ children, scaled = true, testId = "landing-true-width" }: { children: ReactNode; scaled?: boolean; testId?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; zoom: number } | null>(null);
  useEffect(() => {
    const element = outer.current;
    if (!element || !scaled) return;
    const measure = () => {
      const page = Math.round(document.body.getBoundingClientRect().width) || window.innerWidth;
      const room = element.clientWidth;
      setFit(room > 0 && room < page ? { width: page, zoom: room / page } : null);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [scaled]);
  const shown = scaled ? fit : null;
  return <div ref={outer} data-testid={testId} data-zoom={shown ? shown.zoom.toFixed(3) : undefined}>
    <div style={shown ? { width: shown.width, zoom: shown.zoom } : undefined}>{children}</div>
  </div>;
}
