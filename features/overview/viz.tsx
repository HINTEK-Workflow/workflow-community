"use client";

import { Children, useId, type CSSProperties, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Inbox, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { personInitials, personSolidTone } from "@/features/workflow/person-tone";
import type { PanelArea } from "@/lib/workflow/panel-area";
import { cn } from "@/lib/utils";
import { Panel } from "@/features/kfid/ui";

/**
 * The visual pieces of Översikten (from the approved proposal, layout A – 2026-10-27/28: "tänk modern dashboard",
 * moved here from the design lab 2026-10-28 so shipped code never imports the lab). Built on the app's
 * tokens (--primary, --type-*, --card, --border, the indicator colours) so they read as Workflow; only drawn here in SVG
 * and CSS, nothing new in the package list. Every graphic has words for a screen reader (a caption or a table), and every
 * movement stops under "mindre rörelse" (motion-safe / motion-reduce, and the shared .native-skeleton).
 */

/** Soft entrance for a box: fades and rises 4 px, staggered by `delay` ms; nothing under reduced motion. */
export const enter = "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-500 motion-safe:fill-mode-both";
export const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/** A screen-reader table for a graphic (the graphic itself is aria-hidden). */
export function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return <table className="sr-only">
    <caption>{caption}</caption>
    <thead><tr>{head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column}>{cell}</td>)}</tr>)}</tbody>
  </table>;
}

/** The empty state inside a box: a quiet icon and one short line. */
export function EmptyNote({ icon: Icon = Inbox, title, text, compact = false }: { icon?: LucideIcon; title: string; text?: string;
  /** One calm line instead of a centred block (Översiktens lyft, 2026-10-29): an empty box takes little room. */
  compact?: boolean }) {
  if (compact) return <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground" data-empty-note="compact">
    <Icon className="size-4 shrink-0" aria-hidden="true" />{title}{text ? <span className="text-xs">· {text}</span> : null}
  </p>;
  return <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 px-4 py-6 text-center">
    <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-5" aria-hidden="true" /></span>
    <p className="text-sm font-semibold">{title}</p>
    {text ? <p className="max-w-64 text-xs text-muted-foreground">{text}</p> : null}
  </div>;
}

/**
 * The gap between the boxes: the app's 1.25 rem, and tighter in display level 2 (Lagom), where the page is denser
 * (2026-10-28: "Visning 2 = kompakt datorvy").
 */
export const BOX_GAP = "gap-5 [html[data-detail='2']_&]:gap-3";

/**
 * Översiktens rutnät (2026-10-29: "korten … lika breda oavsett flik … utgå ifrån Jag"). Every tab is built from the
 * same rows as Jag, so a card of the same sort has the same width and place on every tab, only its content differs:
 * - SideMain: a narrow card (a third) beside the main list (two thirds) from 1280 px – Jag's Tid | Gör detta nu, Teamet's
 *   Just nu | Kräver åtgärd, Ekonomi's Offerter | Att fakturera, Kunder's Närmaste veckan | Kräver åtgärd. Narrower they stack,
 *   the main list first only where the tab says so (`mainFirst`); alone, a card takes the whole row.
 * - Halves: cards side by side from 768 px (`wide`: from 1024 px, for a calendar or a chart that needs the room); a lone
 *   card keeps its half, as on Jag, so it never changes width with its neighbour.
 * A card that needs the whole width (Teamet's Belastning) is placed alone in the tab's own column.
 */
/**
 * All four tabs of Översikten (2026-11-02, replaces the narrow and the wide column): half and half from 1024 px, and in
 * each column the cards right under each other at their own height, so no card leaves air.
 */
export function Columns({ left, right, testId }: { left: ReactNode; right: ReactNode; testId?: string }) {
  const stack = (cards: ReactNode) => { const items = Children.toArray(cards).filter(Boolean); return items.length ? <div className={cn("grid min-w-0 content-start", BOX_GAP)}>{items}</div> : null; };
  return <div className={cn("grid items-start lg:grid-cols-2", BOX_GAP)} data-testid={testId}>{stack(left)}{stack(right)}</div>;
}

export function Halves({ children, wide = false, testId }: { children: ReactNode; wide?: boolean; testId?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  return <div className={cn("grid", wide ? "lg:grid-cols-2" : "md:grid-cols-2", BOX_GAP)} data-testid={testId}>
    {items.map((item, index) => <div key={(item as { key?: string }).key ?? index} className="min-w-0 [&>div]:h-full" data-slot="half">{item}</div>)}
  </div>;
}

/** The same rows as a skeleton, so a tab on its way has the shape it will have. */
export const ROWS_SKELETON = [
  { span: "lg:col-span-12", height: "h-20" },
  { span: "lg:col-span-6", height: "h-64" }, { span: "lg:col-span-6", height: "h-64" },
  { span: "lg:col-span-6", height: "h-56" }, { span: "lg:col-span-6", height: "h-56" },
] as const;

/** The app's rule for what display level 2 leaves out (app/globals.css: [data-detail-min="3"] is hidden at levels 1 and 2). */
export const ONLY_LEVEL_3 = { "data-detail-min": "3" } as const;

/**
 * A box of Översikten: the app's own card (Panel – the same header, icon square in the area's colour, title, padding and
 * border as every other card in the app). `extra` marks a box that display level 2 leaves out, so Lagom shows fewer boxes.
 * `anchor` is an id the greeting's chips jump to. A box without a title (a key figure) is the same card without a header.
 */
export function Box({ title, area, icon, action, className, children, label, extra = false, anchor }: {
  title?: string;
  area?: PanelArea;
  /** The title's icon; left out = the area's own, null = none (Min plan under its own Visa i kalendern, 2026-10-29). */
  icon?: LucideIcon | null;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  /** The box's accessible name when it has no visible title. */
  label?: string;
  /** Left out in display level 2 (Lagom). */
  extra?: boolean;
  anchor?: string;
}) {
  const detail = extra ? ONLY_LEVEL_3 : {};
  if (!title) return <section aria-label={label} className={cn("app-panel min-w-0 rounded-lg border bg-card p-4", className)} {...detail}>{children}</section>;
  // A column (flex) so a box stretched to its row lets its content fill the height (Tid).
  const panel = <Panel title={title} area={area} icon={icon} actions={action} className="flex h-full min-w-0 flex-col [&>.panel-content]:flex-1">{children}</Panel>;
  return <div id={anchor} className={cn("min-w-0 scroll-mt-6", className)} {...detail}>{panel}</div>;
}

/** A change against the last period: an arrow and the figure in a status pill. `good` says which way is good. */
export function Trend({ value, text, good }: { value: number; text: string; good: "up" | "down" }) {
  const up = value >= 0;
  const tone: IndicatorTone = value === 0 ? "neutral" : up === (good === "up") ? "success" : "danger";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return <span className={cn("inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-xs font-semibold tabular-nums", indicatorBadge(tone))}>
    <Icon className="size-3.5" aria-hidden="true" />{text}
  </span>;
}

/**
 * A sparkline: a 2 px line with a soft fill under it and a dot on the last value, in `currentColor` (give it a text
 * colour class). Decorative – the figure beside it carries the meaning; `label` is read instead.
 */
export function Sparkline({ values, className, label, height = 40 }: { values: number[]; className?: string; label: string; height?: number }) {
  const id = useId();
  const width = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => [(index / (values.length - 1)) * width, height - 4 - ((value - min) / span) * (height - 8)] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  return <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("block w-full overflow-visible", className)} style={{ height }}>
    <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".22" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${id})`} />
    <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    <circle cx={lastX} cy={lastY} r="3" fill="currentColor" stroke="var(--card)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
  </svg>;
}

/**
 * A progress ring: a track and an arc that draws itself in once (CSS @starting-style, nothing under reduced motion).
 * `color` is a CSS colour (a token); `children` sits in the middle.
 */
export function Ring({ value, max, size = 120, thickness = 10, color = "var(--primary)", track = "var(--muted)", label, children, className }: {
  value: number; max: number; size?: number; thickness?: number; color?: string; track?: string; label: string; children?: ReactNode; className?: string;
}) {
  const radius = (size - thickness) / 2;
  const length = 2 * Math.PI * radius;
  const offset = length * (1 - Math.min(1, value / max));
  return <div role="img" aria-label={label} className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
    <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={thickness} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" strokeDasharray={length}
        style={{ "--off": offset, "--full": length } as CSSProperties}
        className="[stroke-dashoffset:var(--off)] transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none starting:[stroke-dashoffset:var(--full)]" />
    </svg>
    <div className="relative text-center" aria-hidden="true">{children}</div>
  </div>;
}

/** A thin horizontal bar that grows in once; `tone` colours it with the indicator fills. */
export function GrowBar({ value, max, className, fill }: { value: number; max: number; className?: string; fill: string }) {
  return <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)} aria-hidden="true">
    <div className={cn("h-full rounded-full [width:var(--w)] transition-[width] duration-700 ease-out motion-reduce:transition-none starting:[width:0]", fill)} style={{ "--w": `${Math.min(100, (value / max) * 100)}%` } as CSSProperties} />
  </div>;
}

/** A big figure with its label above and a line under (the overview tiles' order, larger). */
export function Figure({ label, value, unit, note, className, size = "lg" }: { label: string; value: ReactNode; unit?: string; note?: ReactNode; className?: string; size?: "lg" | "xl" }) {
  return <div className={cn("min-w-0", className)}>
    <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
    <p className={cn("font-bold tracking-tight tabular-nums", size === "xl" ? "text-4xl sm:text-5xl" : "text-2xl")}>{value}{unit ? <span className={cn("font-semibold text-muted-foreground", size === "xl" ? "text-2xl" : "text-base")}> {unit}</span> : null}</p>
    {note ? <div className="mt-1 text-xs text-muted-foreground">{note}</div> : null}
  </div>;
}

/** A status pill: the shared Badge with the shared indicator colours. */
export function Pill({ tone, children, className }: { tone: IndicatorTone; children: ReactNode; className?: string }) {
  return <Badge variant="outline" className={cn(indicatorBadge(tone), className)}>{children}</Badge>;
}

/** A person's initials in their calendar colour (as PersonAvatars). */
export function Avatar({ personKey, name, size = "md" }: { personKey: string; name: string; size?: "sm" | "md" }) {
  return <span title={name} aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold text-white", personSolidTone(personKey), size === "sm" ? "size-6 text-[10px]" : "size-8 text-[11px]")}>{personInitials(name)}</span>;
}
