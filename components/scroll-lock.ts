"use client";

import { useEffect } from "react";
import { shouldBlockTouch, type ScrollBox } from "@/lib/workflow/scroll-lock";

/**
 * Låst sida bakom ett blad (mobil 2026-11-22: "lager på lager"): one shared lock for every overlay of the app look – Ny and Mer in
 * the tab bar, NativeSheet (filters, an editor's ⋯) and Workflow AI's screen. While any of them is open:
 *  - html gets `data-scroll-held` (app/globals.css): overflow hidden and no overscroll, so the page keeps its place and its scroll
 *    position but a wheel, a key or a finger cannot move it (the same place Radix's own lock uses, so the sticky bars stay put);
 *  - a finger drag that lands outside something that can still scroll that way is stopped (lib/workflow/scroll-lock.ts), since
 *    iOS Safari scrolls the page and chains an overscroll to it despite overflow: hidden.
 * Counted, so two overlays at once (Mer and a sheet from a row) release the page only when the last one closes.
 */
let holders = 0;
let startY = 0;
let startX = 0;

function scrollBoxes(target: EventTarget | null): ScrollBox[] {
  const boxes: ScrollBox[] = [];
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node instanceof HTMLElement) {
      const overflow = window.getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll" || node instanceof HTMLTextAreaElement) boxes.push({ scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
    }
    node = node.parentElement;
  }
  return boxes;
}

const onTouchStart = (event: TouchEvent) => { if (event.touches.length === 1) { startY = event.touches[0]!.clientY; startX = event.touches[0]!.clientX; } };
const onTouchMove = (event: TouchEvent) => {
  // Two fingers are a pinch to zoom, never a scroll of the page.
  if (event.touches.length !== 1 || !event.cancelable) return;
  // The step since the last move, so a finger that turns back mid-drag is judged by where it goes now.
  const { clientX: x, clientY: y } = event.touches[0]!;
  const dy = y - startY;
  const dx = x - startX;
  startY = y; startX = x;
  // A sideways swipe (a row of chips, a carousel) is never the page's vertical scroll.
  if (Math.abs(dx) > Math.abs(dy)) return;
  if (shouldBlockTouch(scrollBoxes(event.target), dy)) event.preventDefault();
};

function hold() {
  holders += 1;
  if (holders > 1) return;
  document.documentElement.setAttribute("data-scroll-held", "");
  document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
}

function release() {
  holders = Math.max(0, holders - 1);
  if (holders > 0) return;
  document.documentElement.removeAttribute("data-scroll-held");
  document.removeEventListener("touchstart", onTouchStart, { capture: true });
  document.removeEventListener("touchmove", onTouchMove, { capture: true });
}

/** Holds the page still while `active` (an open sheet or screen); releases it when it closes or unmounts. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    hold();
    return release;
  }, [active]);
}
