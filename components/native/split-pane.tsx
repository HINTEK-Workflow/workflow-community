"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MousePointerClick } from "lucide-react";
import { SPLIT_FRAME, SPLIT_MIN_WIDTH, SPLIT_OPEN_MESSAGE, splitAddress, splitDetailHref, splitListView, splitOpenFromAddress } from "@/lib/workflow/app-feel";
import { useAppForm } from "@/features/workflow/use-detail-level";

/**
 * Lista och det öppnade bredvid varandra (appkänslan, beslutad 2026-11-23; surfplattans appvy, docs/ui-system.md 9): on a tablet
 * held sideways (from SPLIT_MIN_WIDTH) a list that has things to open – Jobb, Arbetsordrar, Projekt, Kunder, Offerter,
 * Driftronder, Inköp, Notiser – keeps its place to the left and shows the opened thing to the right. The pane is the same app
 * in a frame, as the app column is (components/native/app-column.tsx): its own narrow window, so every screen, step and
 * dialog-as-screen of the thing is exactly the phone's, and its own back and history stay inside it. The list is the page's own;
 * a link in it that opens one of its things is shown in the pane instead of leaving the list (splitDetailHref), every other
 * link is followed as usual. The opened thing is kept in the list's address (`oppnat`, replaced, never a new history entry),
 * so a reload or a copied link opens the same thing beside the list. Drawn by the shell once, so every such list gets it.
 * Display only: the frame is the same signed-in session and the server decides every call.
 */
export function SplitPane() {
  const form = useAppForm();
  const params = useSearchParams();
  const listView = splitListView(new URLSearchParams(params.toString()));
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const read = () => setWide(window.innerWidth >= SPLIT_MIN_WIDTH);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  const on = form === "tablet" && wide && listView !== null;
  // The frame is loaded once per list; the next thing is opened inside it by the app there (a message to its shell,
  // SPLIT_OPEN_MESSAGE), so choosing another row changes the screen without loading the app again.
  const [open, setOpen] = useState<{ list: string; href: string } | null>(null);
  const fromAddress = listView ? splitOpenFromAddress(listView, new URLSearchParams(params.toString())) : null;
  const shown = !on ? null : open?.list === listView ? open.href : fromAddress;
  const selected = useRef<Element | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const loaded = useRef(false);
  // The page's area becomes two columns while the pane is on (app/globals.css, [data-split]).
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (!main || !on) return;
    main.dataset.split = "";
    return () => { delete main.dataset.split; };
  }, [on]);
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (!main || !on || !listView) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.closest(".native-split-pane, .native-top-bar") || (link.target && link.target !== "_self")) return;
      const href = splitDetailHref(listView, link.getAttribute("href"));
      if (!href) return;
      // The list stays; Next's own link never hears of the press.
      event.preventDefault();
      selected.current?.removeAttribute("data-split-selected");
      selected.current = link.closest(".native-row") ?? link;
      selected.current.setAttribute("data-split-selected", "");
      const inside = frame.current?.contentWindow;
      if (inside && loaded.current) inside.postMessage({ type: SPLIT_OPEN_MESSAGE, href }, window.location.origin);
      else { loaded.current = false; setOpen({ list: listView, href }); }
      window.history.replaceState(window.history.state, "", splitAddress(window.location.pathname, window.location.search, href));
    };
    main.addEventListener("click", onClick, true);
    return () => { main.removeEventListener("click", onClick, true); selected.current?.removeAttribute("data-split-selected"); selected.current = null; };
  }, [on, listView]);
  if (!on) return null;
  return <aside className="native-split-pane" aria-label="Det öppnade" data-testid="native-split-pane">
    {shown ? <iframe ref={frame} name={SPLIT_FRAME} src={shown} title="Det öppnade" allow="camera; geolocation; clipboard-write" onLoad={() => { loaded.current = true; }} data-testid="native-split-frame" />
      : <div className="native-split-empty" data-testid="native-split-empty"><MousePointerClick aria-hidden="true" /><p>Välj i listan så visas det här.</p></div>}
  </aside>;
}
