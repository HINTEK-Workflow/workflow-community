"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import type { TypeKey } from "@/lib/workflow/native-mode";
import { cn } from "@/lib/utils";
import { DelayedSkeleton } from "@/components/skeleton";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { TypeIcon } from "./type-icon";

/** Hem's big buttons (Nivå 1 på mobil, 2026-10-09): two in a row, a wide one across for "Fortsätt". */
export function TileGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className="grid grid-cols-2 gap-3 pb-1 pt-1" data-testid={testId}>{children}</div>;
}

/**
 * `accessory`: one button of its own in the tile's top right corner (Tid's Stoppa, punkt 7). The tile's link then covers
 * the tile as a stretched link and the button sits above it, so a button is never inside a link.
 */
export function Tile({ title, subtitle, type, icon, href, onClick, wide = false, testId, accessory }: { title: ReactNode; subtitle?: ReactNode; type: TypeKey; icon?: LucideIcon; href?: string; onClick?: () => void; wide?: boolean; testId?: string; accessory?: ReactNode }) {
  const content = <>
    <TypeIcon type={type} icon={icon} size="tile" />
    <span className="block min-w-0">
      <span className="block truncate text-[0.9375rem] font-semibold">{title}</span>
      {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
    </span>
  </>;
  if (accessory && href) return <div className="native-tile tap-card" data-wide={wide || undefined} data-testid={testId}>
    <TypeIcon type={type} icon={icon} size="tile" />
    <span className="block min-w-0">
      <Link href={href} onClick={onClick} className="stretched-link block truncate text-[0.9375rem] font-semibold focus-visible:outline-none">{title}</Link>
      {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
    </span>
    <span className="absolute right-2 top-2 z-[2]">{accessory}</span>
  </div>;
  if (href) return <Link href={href} onClick={onClick} className="native-tile" data-wide={wide || undefined} data-testid={testId}>{content}</Link>;
  return <button type="button" onClick={onClick} className="native-tile" data-wide={wide || undefined} data-testid={testId}>{content}</button>;
}

/** The step bar under a job's title: green for done steps, blue for the current, grey for the rest. */
export function StepBar({ steps, label, testId = "native-step-bar" }: { steps: ("done" | "current" | "todo")[]; label: string; testId?: string }) {
  if (!steps.length) return null;
  return <div className="native-steps py-2" role="img" aria-label={label} data-testid={testId}>
    {steps.map((state, index) => <i key={index} data-state={state} />)}
  </div>;
}

/** One row of a list tile: what it is, a short fact or a chip at the end, and where a tap leads. */
export type TileListRow = { id: string; title: string; href: string; detail?: string; late?: boolean; chip?: { label: string; tone: IndicatorTone } };
/** How many rows a list tile always has room for, so it keeps its height whatever it holds. */
export const TILE_LIST_ROWS = 3;

/**
 * A wide tile with a short list (dashboard etapp 2, 2026-10-28: Gör detta nu, Förfallet, Mina avvikelser): the tile's
 * icon, title and figure as a link to the whole list, and room for three rows at a fixed height – grey rows while it is read
 * (seen only after a moment, DelayedSkeleton), the rows, or one short line when there is nothing – so nothing on Hem jumps.
 * `rows` null = still being read. The figure uses even-width digits.
 */
export function TileList({ title, type, icon, href, count, rows, empty, testId }: {
  title: string; type: TypeKey; icon?: LucideIcon; href?: string; count?: ReactNode; rows: readonly TileListRow[] | null; empty: string; testId?: string;
}) {
  const head = <>
    <TypeIcon type={type} icon={icon} size="tile" />
    <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">{title}</span>
    {rows === null ? <span className="native-skeleton h-3 w-10 shrink-0 rounded" aria-hidden="true" /> : count !== undefined && count !== null && count !== "" ? <span className="native-tile-list-count" data-testid={testId ? `${testId}-count` : undefined}>{count}</span> : null}
    {href ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" /> : null}
  </>;
  return <section className="native-tile-list" aria-label={title} aria-busy={rows === null || undefined} data-testid={testId}>
    {href ? <Link href={href} className="native-tile-list-head">{head}</Link> : <div className="native-tile-list-head">{head}</div>}
    {rows === null ? <DelayedSkeleton className="native-tile-list-rows">
      <span role="status" className="sr-only">Hämtar…</span>
      {Array.from({ length: TILE_LIST_ROWS }, (_, index) => <span key={index} className="native-tile-list-row" aria-hidden="true">
        <span className="native-skeleton h-3.5 rounded" style={{ width: `${64 - index * 12}%` }} /><span className="native-skeleton ml-auto h-3 w-14 rounded" />
      </span>)}
    </DelayedSkeleton>
      : rows.length ? <ul className="native-tile-list-rows">{rows.slice(0, TILE_LIST_ROWS).map((row) => <li key={row.id}>
        <Link href={row.href} className="native-tile-list-row" data-testid={testId ? `${testId}-row` : undefined}>
          <span className="min-w-0 flex-1 truncate">{row.title}</span>
          {row.chip ? <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold", indicatorBadge(row.chip.tone))}>{row.chip.label}</span>
            : row.detail ? <span className={cn("native-tile-list-detail", row.late && "font-medium text-destructive")}>{row.detail}</span> : null}
        </Link>
      </li>)}</ul>
      : <p className="native-tile-list-rows native-tile-list-empty" data-testid={testId ? `${testId}-empty` : undefined}>{empty}</p>}
  </section>;
}
