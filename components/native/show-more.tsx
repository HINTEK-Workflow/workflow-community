"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SHOW_MORE_ALWAYS_HIDDEN, SHOW_MORE_HIDDEN_SELECTORS, SHOW_MORE_PHONE_HIDDEN, SHOW_MORE_MARKER, showMoreButtonShown, showMoreLabel } from "@/lib/workflow/show-more";

/**
 * Visa mer (UX-granskningen A2, lib/workflow/show-more.ts): the one button at the foot of a page in the app on a phone
 * that shows what Lagom and Allt showed – the same page, more content. The shell draws it under the page and owns the
 * choice; the button only looks whether the page has anything more. Display only.
 */
export function ShowMoreButton({ offered, on, page, onToggle }: { offered: boolean; on: boolean; page: string; onToggle: (on: boolean) => void }) {
  const hasMore = usePageHasMore(offered && !on, page);
  if (!showMoreButtonShown({ offered, on, hasMore })) return null;
  return <div className="flex justify-center pt-6" data-testid="show-more-row">
    <Button type="button" variant="outline" className="h-11 min-w-36" aria-pressed={on} onClick={() => onToggle(!on)} data-testid="show-more">
      {on ? <ChevronUp /> : <ChevronDown />}{showMoreLabel(on)}
    </Button>
  </div>;
}

/**
 * Tells the button that the open page has more (lib/workflow/show-more.ts, SHOW_MORE_MARKER): drawn by an app screen that
 * leaves a function out at content level 1 and shows it with Visa mer. Nothing is seen.
 */
export function ShowMoreMarker({ when = true }: { when?: boolean }) {
  return when ? <span hidden data-show-more="" /> : null;
}

/** Something the content level leaves out on the open page that would be seen with Visa mer (its parent is drawn and it says something). */
function countsAsMore(element: Element): boolean {
  if (element.matches(SHOW_MORE_ALWAYS_HIDDEN)) return false;
  if (document.documentElement.dataset.device === "phone" && element.matches(SHOW_MORE_PHONE_HIDDEN)) return false;
  const parent = element.parentElement;
  if (!parent || !parent.getClientRects().length) return false;
  return Boolean(element.textContent?.trim()) || Boolean(element.querySelector("img, svg, canvas, table, input, button"));
}

function pageHasMore(): boolean {
  const main = document.querySelector(".workspace-main");
  if (!main) return false;
  if (main.querySelector(SHOW_MORE_MARKER)) return true;
  for (const selector of SHOW_MORE_HIDDEN_SELECTORS) {
    let found: NodeListOf<Element>;
    try { found = document.querySelectorAll(selector); } catch { continue; }
    for (const element of found) if (main.contains(element) && countsAsMore(element)) return true;
  }
  return false;
}

/** Whether the open page has more to show, looked at again when the page changes (`active` false: not looked at). */
function usePageHasMore(active: boolean, page: string): boolean {
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const look = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setHasMore(pageHasMore())); };
    look();
    const main = document.querySelector(".workspace-main");
    const observer = main ? new MutationObserver(look) : null;
    observer?.observe(main!, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [active, page]);
  return active && hasMore;
}
