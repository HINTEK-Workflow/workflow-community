"use client";

import { useEffect } from "react";

/**
 * Every cut-off text has its full text as a tooltip (2026-10-11, "kontrollera texter så de inte ligger utanför card").
 * A line that is shortened with `truncate` or `line-clamp` gets `title` when it is really cut, and loses it again when the
 * room grows. Lines that carry their own title, or sit in a control that has a label, are left alone.
 */
const SELECTOR = ".truncate, [class*='line-clamp-'], [class*='text-ellipsis']";
const OWN = "data-auto-title";

function isCut(element: HTMLElement) {
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
}

function mark(root: ParentNode) {
  for (const element of root.querySelectorAll<HTMLElement>(SELECTOR)) {
    const own = element.hasAttribute(OWN);
    if (element.hasAttribute("title") && !own) continue;
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    if (text && isCut(element)) {
      if (element.getAttribute("title") !== text) element.setAttribute("title", text);
      element.setAttribute(OWN, "");
    } else if (own) {
      element.removeAttribute("title");
      element.removeAttribute(OWN);
    }
  }
}

export function TruncationTitles() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      mark(document.body);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(run);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
