"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A word on its way (2026-10-16, "sidan hoppar när den bygger och laddar innehåll"): a grey bar exactly one line of the
 * surrounding text high (the bar sits on a non-breaking space), so a heading or a row of facts keeps its height while the
 * real words are read. The same grey as `ListSkeleton` (`.native-skeleton`).
 * Lives here (stabil sidladdning steg 5, 2026-10-23) so the page template (components/page-shell.tsx) can draw it too;
 * features/kfid/ui.tsx re-exports it.
 */
export function SkeletonText({ className }: { className?: string }) {
  return <span className={cn("relative inline-flex max-w-full items-center", className ?? "w-32")} aria-hidden="true">{" "}<span className="native-skeleton absolute inset-x-0 h-[.7em] rounded" /></span>;
}

/**
 * A panel's list on its way (2026-10-16): grey rows of the real rows' height – two lines (title and the line under it)
 * and the status badge, or one line with `dense` (a place's latest jobs) – so the panel keeps its shape and nothing under
 * it jumps when the rows come. Display 2–3's counterpart of `ListSkeleton`; the words are for screen readers.
 */
export function RowsSkeleton({ rows = 3, dense = false, label, testId }: { rows?: number; dense?: boolean; label?: string; testId?: string }) {
  return <div aria-busy="true" data-testid={testId}>
    {label ? <span role="status" className="sr-only">{label}</span> : null}
    <ul aria-hidden="true" className={cn("divide-y", dense && "mt-1.5 text-sm")}>{Array.from({ length: rows }, (_, index) => <li key={index} className={cn("flex items-center justify-between gap-3", dense ? "py-2" : "py-2.5 first:pt-0 last:pb-0")}>
      {dense ? <SkeletonText className={["w-3/5", "w-1/2", "w-2/5"][index % 3]} />
        : <span className="flex min-w-0 flex-1 flex-col"><span className="text-sm"><SkeletonText className={["w-3/5", "w-1/2", "w-2/5"][index % 3]} /></span><span className="text-xs"><SkeletonText className="w-1/3" /></span></span>}
      <span className="native-skeleton h-5 w-20 shrink-0 rounded-full" />
    </li>)}</ul>
  </div>;
}

/** How long a skeleton waits before it is seen (steg 5): an answer faster than this never makes the page blink. */
export const SKELETON_DELAY_MS = 150;

/**
 * Whether a skeleton may be seen yet (stabil sidladdning steg 5, 2026-10-23): false for the first `delayMs`, then true.
 * The skeleton takes its room from the start and is only hidden (visibility), so the page never moves when it shows.
 */
export function useSkeletonReveal(delayMs = SKELETON_DELAY_MS) {
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) return;
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  return shown;
}

/**
 * The room of a skeleton that is not seen yet (steg 5): hidden for the first ~150 ms, but laid out at its full height, so
 * a quick answer replaces nothing visible and a slow one replaces grey rows of the real rows' height. The status words
 * inside are read once the skeleton is seen.
 */
export function DelayedSkeleton({ children, delayMs = SKELETON_DELAY_MS, className, testId }: { children: ReactNode; delayMs?: number; className?: string; testId?: string }) {
  const shown = useSkeletonReveal(delayMs);
  return <div className={className} style={shown ? undefined : { visibility: "hidden" }} data-skeleton="" data-skeleton-shown={shown ? "" : undefined} data-testid={testId}>{children}</div>;
}

/**
 * Statistics on their way (2026-10-24, "innehåll först när det är klart"): the shape of a statistics tab – a row of
 * four key-figure tiles and a chart card of the real chart's height (h-72) – so a tab whose numbers are still read keeps
 * the room it will take and nothing under it moves when they come. Seen only after ~150 ms, like every skeleton.
 */
export function StatisticsSkeleton({ label = "Hämtar statistik…", testId }: { label?: string; testId?: string }) {
  return <DelayedSkeleton testId={testId}>
    <div className="space-y-5" aria-busy="true">
      <span role="status" className="sr-only">{label}</span>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="stat-card"><span className="native-skeleton size-10 shrink-0 rounded-lg" /><div className="min-w-0 flex-1"><p className="text-xs"><SkeletonText className="w-16" /></p><p className="mt-1 text-2xl"><SkeletonText className="w-12" /></p><p className="text-xs"><SkeletonText className="w-24" /></p></div></div>)}
      </div>
      <div className="app-panel rounded-lg border bg-card" aria-hidden="true">
        <div className="px-4 pb-3 pt-3.5"><span className="section-title block"><SkeletonText className="w-48" /></span><p className="mt-0.5 text-xs"><SkeletonText className="w-64 max-w-full" /></p></div>
        <div className="px-4 pb-4"><div className="native-skeleton h-72 rounded-md" /></div>
      </div>
    </div>
  </DelayedSkeleton>;
}

/**
 * A part of a page that is drawn only when it can be shown whole (2026-10-24): its children are laid out from the
 * start (so they read their own data) but hidden until `ready`; meanwhile the `placeholder` (a skeleton of about the same
 * shape) stands in their place. The part then appears in one sweep instead of being built piece by piece.
 */
export function ShowWhenReady({ ready, placeholder, children, className, testId }: { ready: boolean; placeholder: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return <>
    {ready ? null : placeholder}
    <div hidden={!ready} className={className} data-ready={ready ? "" : undefined} data-testid={testId}>{children}</div>
  </>;
}
