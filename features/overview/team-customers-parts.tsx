"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DelayedSkeleton, SkeletonText } from "@/components/skeleton";
import { indicatorText, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { Figure } from "@/features/overview/viz";
import { cn } from "@/lib/utils";
import { formatCapacityHours } from "@/lib/workflow/capacity-summary";
import { shortDay } from "@/lib/workflow/schedule";
import { formatKronor } from "@/lib/quotes/native";

/**
 * Small pieces the real Teamet and Kunder tabs share (2026-10-28, 0.29.0). They only compose the overview's own parts
 * (Figure from the design proposal, the shared skeleton and indicator colours); nothing here is a new pattern.
 */

/** Rows per list: fewer in display level 2 (Lagom), the full short list in level 3. */
export const rowLimit = (level: 2 | 3) => (level === 2 ? 3 : 6);

/** "7,5 h" – minutes as hours with at most one decimal. */
export const hours = formatCapacityHours;
/** "12 345 kr" – whole kronor. */
export const kronor = (value: number) => `${formatKronor(value)} kr`;
/** "3 nov" – a Swedish day, or a dash. */
export const day = (value: string | null | undefined) => (value ? shortDay(value) : "–");

/**
 * A key figure that opens the list it counts (dashboard etapp 3: "Varje nyckeltal ska öppna rätt lista med rätt filter"). The
 * whole figure is the link; a warning tone colours the number only when it is not zero (a zero never alarms).
 */
export function FigureLink({ label, value, href, tone, note, testId }: { label: string; value: number; href: string; tone?: IndicatorTone; note?: ReactNode; testId?: string }) {
  return <Link href={href} data-testid={testId} className="-m-1.5 block min-w-0 rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-3 focus-visible:ring-ring/40">
    <Figure label={label} value={<span className={cn(tone && value > 0 && indicatorText(tone))}>{value}</span>} note={note} />
  </Link>;
}

/** A plain key figure (nothing to open). */
export function FigureText({ label, value, tone, note }: { label: string; value: number | string; tone?: IndicatorTone; note?: ReactNode }) {
  return <Figure label={label} value={<span className={cn(tone && value !== 0 && indicatorText(tone))}>{value}</span>} note={note} />;
}

/** One row of a box's short list: the title is the link, a line under it, and an optional button or value at the end. */
export function BoxRow({ href, title, subtitle, end, testId }: { href: string; title: ReactNode; subtitle?: ReactNode; end?: ReactNode; testId?: string }) {
  return <li data-testid={testId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
    <span className="min-w-0 flex-1">
      <Link href={href} className="block truncate text-sm font-medium hover:text-primary">{title}</Link>
      {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
    </span>
    {end ? <span className="flex shrink-0 items-center gap-2">{end}</span> : null}
  </li>;
}

/** "Visar 6 av 14" under a cut list. */
export function MoreNote({ shown, total, what }: { shown: number; total: number; /** What the total counts, when the box's head shows another figure. */ what?: string }) {
  return total > shown ? <p className="mt-3 text-xs text-muted-foreground">Visar {shown} av {total}{what ? ` ${what}` : ""}.</p> : null;
}

/**
 * A tab on its way: boxes of a fixed height in the tab's grid, so nothing below moves when the numbers come. Seen only after
 * ~150 ms, like every skeleton (components/skeleton.tsx).
 */
export function TabSkeleton({ label, heights, testId }: { label: string; heights: readonly { span: string; height: string }[]; testId?: string }) {
  return <DelayedSkeleton testId={testId}>
    <div className="grid gap-5 lg:grid-cols-12 [html[data-detail='2']_&]:gap-3" aria-busy="true">
      <span role="status" className="sr-only">{label}</span>
      {heights.map((box, index) => <div key={index} aria-hidden="true" className={cn("app-panel min-w-0 rounded-lg border bg-card p-4", box.span)}>
        <span className="section-title block"><SkeletonText className="w-40" /></span>
        <div className={cn("native-skeleton mt-4 rounded-md", box.height)} />
      </div>)}
    </div>
  </DelayedSkeleton>;
}
