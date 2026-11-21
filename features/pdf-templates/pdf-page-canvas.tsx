"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

/**
 * The real PDF drawn page by page on canvases (PDF-mallar 2026-11-04): pdf.js reads the very bytes the generator wrote, so what
 * the owner clicks on is the output itself and no look-alike of it. pdf.js and its worker are loaded only here, when the
 * editor opens. A new file is drawn beside the old one and swapped in when done, so the page does not flicker while typing.
 * Only the pages in or near the window are drawn (2026-11-05: a five-page document drew all five on every key press); the
 * others keep their last picture until they are scrolled to.
 */
type PdfJs = typeof import("pdfjs-dist");
let loading: Promise<PdfJs> | null = null;
/** pdf.js and its worker, loaded once (also used by a board's PDF card, features/boards/cards/file.tsx). */
export function pdfJs() {
  loading ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    return module;
  });
  return loading;
}

/** The file being closed: pdf.js refuses a new one on the same worker until the last one is gone. */
let closing: Promise<void> = Promise.resolve();

export type PdfPageSize = { width: number; height: number };

/** How far outside the window a page still counts as near. */
const NEAR = "600px 0px";

/** One page: its canvas in the page's proportions, the children (click targets) laid over it in percent of the page. */
export function PdfPages({ data, pages, overlay, onDrawn, label }: { data: Uint8Array | null; pages: readonly PdfPageSize[]; overlay: (page: number) => ReactNode; onDrawn?: (version: number) => void; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const drawn = useRef(0);
  const [drawCount, setDrawCount] = useState(0);
  // What the observer and the drawing share: the pages near the window, and how to draw those that still show an older picture.
  const near = useRef(new Set<number>());
  const drawNear = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    const element = host.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setWidth(Math.round(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The pages near the window, told again whenever the number of pages changes.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const items = [...element.querySelectorAll<HTMLElement>("[data-testid=pdf-template-page]")];
    if (typeof IntersectionObserver === "undefined") { near.current = new Set(items.map((_, index) => index)); return; }
    near.current = new Set();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const index = items.indexOf(entry.target as HTMLElement);
        if (entry.isIntersecting) near.current.add(index); else near.current.delete(index);
      }
      void drawNear.current();
    }, { rootMargin: NEAR });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [pages.length]);

  useEffect(() => {
    if (!data || !width) return;
    let active = true;
    let task: PDFDocumentLoadingTask | null = null;
    let rendering: RenderTask | null = null;
    let drawingNow = false;
    let reported = false;
    let opened: PDFDocumentProxy | null = null;
    let stale = new Set<number>();
    const drawPages = async () => {
      if (drawingNow || !opened) return;
      drawingNow = true;
      try {
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        for (;;) {
          // The first page is always drawn when nothing is known to be near yet (the observer answers a moment later).
          const next = [...stale].filter((index) => near.current.has(index) || (!near.current.size && index === 0)).sort((a, b) => a - b)[0];
          if (next === undefined || !active) break;
          const page = await opened.getPage(next + 1);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width * ratio) / base.width });
          const offscreen = window.document.createElement("canvas");
          offscreen.width = Math.ceil(viewport.width);
          offscreen.height = Math.ceil(viewport.height);
          rendering = page.render({ canvas: offscreen, viewport });
          await rendering.promise;
          rendering = null;
          if (!active) return;
          const visible = canvases.current[next];
          if (visible) {
            visible.width = offscreen.width;
            visible.height = offscreen.height;
            visible.getContext("2d")?.drawImage(offscreen, 0, 0);
          }
          stale.delete(next);
        }
        if (active && !reported) {
          reported = true;
          drawn.current += 1;
          setDrawCount(drawn.current);
          setFailed(false);
          onDrawn?.(drawn.current);
        }
      } catch (cause) {
        if (active && (cause as Error)?.name !== "RenderingCancelledException") { console.warn("PDF-sidan kunde inte ritas.", (cause as Error)?.name ?? "fel"); setFailed(true); }
      } finally { drawingNow = false; }
    };
    const timer = setTimeout(async () => {
      try {
        const pdfjs = await pdfJs();
        await closing;
        if (!active) return;
        // pdf.js takes the buffer over to its worker: it gets its own copy.
        task = pdfjs.getDocument({ data: data.slice(), verbosity: 0 });
        opened = await task.promise;
        if (!active) return;
        stale = new Set(Array.from({ length: opened.numPages }, (_, index) => index));
        drawNear.current = drawPages;
        await drawPages();
      } catch (cause) {
        if (active) { console.warn("PDF-sidan kunde inte ritas.", (cause as Error)?.name ?? "fel"); setFailed(true); }
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      rendering?.cancel();
      drawNear.current = async () => undefined;
      if (task) closing = closing.then(() => task!.destroy()).catch(() => undefined);
    };
  }, [data, width]); // eslint-disable-line react-hooks/exhaustive-deps -- onDrawn only reports

  return <div ref={host} className="space-y-4" data-testid="pdf-template-pages" data-page-width={width} data-drawn={drawCount} aria-label={label}>
    {failed ? <p role="alert" className="notice text-sm text-destructive" data-testid="pdf-template-draw-error">Sidan kunde inte ritas i webbläsaren. Texterna går att ändra under Alla texter, och Visa PDF öppnar filen.</p> : null}
    {pages.map((page, index) => <div key={index} className="relative overflow-hidden rounded-sm border bg-white shadow-sm" style={{ aspectRatio: `${page.width} / ${page.height}` }} data-testid="pdf-template-page" data-page={index}>
      <canvas ref={(element) => { canvases.current[index] = element; }} className="absolute inset-0 size-full" role="img" aria-label={`Sida ${index + 1} av ${pages.length}`} />
      {overlay(index)}
    </div>)}
  </div>;
}
