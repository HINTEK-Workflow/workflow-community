"use client";

import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TypeKey } from "@/lib/workflow/native-mode";
import { indicatorBadge, PILL_FIXED_WIDTH_SM, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { TypeIcon } from "./type-icon";
import { glueDashes } from "@/lib/workflow/glue-dashes";

/**
 * Lists like the phone's settings (Nivå 1 på mobil, 2026-10-09): a large title, a compact search field and
 * "inset grouped" lists – rounded groups of rows, each with a coloured icon square, a title, one line under it, an optional
 * pill or value and a chevron, with thin dividers and no cards.
 */
export function NativePage({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <div className={cn("native-page space-y-1 pb-4", className)} data-testid={testId}>{children}</div>;
}

export function NativeLargeTitle({ children, actions, subtitle, inBar = false }: { children: ReactNode; actions?: ReactNode; subtitle?: ReactNode;
  /** The top bar already shows the title (M1, 2026-10-12): the heading stays for screen readers only and the row holds just the subtitle and actions. */
  inBar?: boolean }) {
  if (inBar && !actions && !subtitle) return <h1 className="sr-only" data-testid="native-large-title">{children}</h1>;
  // The title stands in the middle like the top bar's (2026-10-16), the actions to the right; an empty first column keeps it centred.
  return <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 pb-2 pt-1">
    <span aria-hidden="true" />
    <div className="min-w-0 text-center">
      <h1 className={inBar ? "sr-only" : "native-large-title"} data-testid="native-large-title">{children}</h1>
      {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
    {actions ? <div className="flex shrink-0 items-center justify-self-end gap-1">{actions}</div> : <span aria-hidden="true" />}
  </div>;
}

/** The compact search field under the large title. */
export function NativeSearch({ value, onChange, label, placeholder = "Sök" }: { value: string; onChange: (value: string) => void; label: string; placeholder?: string }) {
  return <label className="relative mb-2 block">
    <span className="sr-only">{label}</span>
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label} data-testid="native-search"
      className="native-search-field h-10 w-full rounded-[10px] border-0 pl-9 pr-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40" />
  </label>;
}

/** The same field as a button that opens Sök (Mer at level 1): looks like the search field, opens the search window. */
export function NativeSearchButton({ onClick, label = "Sök i Workflow", testId }: { onClick: () => void; label?: string; testId?: string }) {
  return <button type="button" onClick={onClick} data-testid={testId} className="native-search-field relative mb-2 flex h-10 w-full items-center rounded-[10px] pl-9 pr-3 text-left text-base text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />{label}
  </button>;
}

// The rows of a list whose pills stand in one column (lika breda etiketter, 2026-10-30).
const AlignPills = createContext(false);

/**
 * One rounded group of rows with an optional small heading above it and a note under it. `alignPills`: a list of items
 * (jobs, quotes, rounds …) whose rows' pills get one shared width from sm so they line up (PILL_FIXED_WIDTH_SM; an upright phone keeps the natural width); not for a detail
 * page's fact rows or a single row.
 */
export function ListGroup({ title, footer, children, testId, className, alignPills = false }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; testId?: string; className?: string; alignPills?: boolean }) {
  return <section className={className} data-testid={testId}>
    {title ? <h2 className="native-group-title">{title}</h2> : <div className="h-3" aria-hidden="true" />}
    <div className="native-group" role="list"><AlignPills.Provider value={alignPills}>{children}</AlignPills.Provider></div>
    {footer ? <p className="px-4 pt-1.5 text-xs leading-5 text-muted-foreground">{footer}</p> : null}
  </section>;
}

export type ListRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** The subtitle in the primary colour ("Nästa steg"). */
  subtitleTone?: "primary" | "danger";
  type?: TypeKey;
  icon?: LucideIcon;
  /** Extra classes on the icon square (a row tinted by its meaning gives the icon its own base, Avvikelser 2026-10-30). */
  iconClassName?: string;
  /** A small coloured dot instead of an icon square (notifications). */
  dot?: TypeKey;
  /** `className` replaces the tone's colours (a scale step, Avvikelser 2026-10-30). */
  pill?: { label: string; tone: IndicatorTone; className?: string } | null;
  value?: ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  /** Buttons of their own at the row's end (they sit above the row's link). */
  accessory?: ReactNode;
  testId?: string;
  ariaLabel?: string;
  className?: string;
  /** The row's main text may wrap (a description). */
  wrap?: boolean;
  /** A long title may take two lines instead of being cut on one (a job's name in a time list); "plan –1" stays together. */
  twoLines?: boolean;
  /** The small line may take two lines instead of being cut on one (a job's customer, place and day in Jobb, resa 2026-11-06). */
  subtitleTwoLines?: boolean;
};

/** One row: icon, title and one line, then pill or value and the chevron. A link, a button or a plain row. */
export function ListRow({ title, subtitle, subtitleTone, type, icon, iconClassName, dot, pill, value, href, onClick, chevron, accessory, testId, ariaLabel, className, wrap = false, twoLines = false, subtitleTwoLines = false }: ListRowProps) {
  const interactive = Boolean(href || onClick);
  const showChevron = chevron ?? interactive;
  const plain = !type && !dot;
  const alignPills = useContext(AlignPills);
  const body = <>
    {type ? <TypeIcon type={type} icon={icon} className={iconClassName} /> : dot ? <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--type-${dot === "checkin" ? "round" : dot === "new" ? "risk" : dot === "notice" ? "project" : dot})` }} /> : null}
    <span className="min-w-0 flex-1">
      <span className={cn("block text-[0.9375rem] font-medium leading-5", wrap ? "whitespace-pre-line font-normal" : twoLines ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate")}>{twoLines && typeof title === "string" ? glueDashes(title) : title}</span>
      {/* A line cut short keeps its whole text as the title (text in cards, 2026-10-14). */}
      {subtitle ? <span title={typeof subtitle === "string" ? subtitle : undefined} className={cn("block text-[0.8125rem] leading-[1.125rem]", subtitleTwoLines ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate", subtitleTone === "primary" ? "font-medium text-primary" : subtitleTone === "danger" ? "font-medium text-destructive" : "text-muted-foreground")}>{subtitle}</span> : null}
    </span>
    {pill ? <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold", alignPills && PILL_FIXED_WIDTH_SM, pill.className ?? indicatorBadge(pill.tone))}>{pill.label}</span> : null}
    {value !== undefined && value !== null && value !== "" ? <span className="max-w-[40%] shrink-0 truncate text-[0.9375rem] text-muted-foreground">{value}</span> : null}
  </>;
  const tail = showChevron ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" /> : null;
  const common = { role: "listitem", "data-plain": plain || undefined, "data-dot": dot ? "" : undefined, "data-testid": testId, className: cn("native-row", className) } as const;
  if (accessory) {
    // A row with buttons of its own: the title is the link and covers the row; the buttons sit above it.
    return <div {...common}>
      {href ? <Link href={href} onClick={onClick} aria-label={ariaLabel} className="stretched-link absolute inset-0 z-[1] rounded-[inherit]"><span className="sr-only">{ariaLabel ?? (typeof title === "string" ? title : "Öppna")}</span></Link>
        : onClick ? <button type="button" onClick={onClick} aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)} className="absolute inset-0 z-[1]" /> : null}
      {body}<span className="tap-above flex shrink-0 items-center gap-0.5">{accessory}</span>{tail}
    </div>;
  }
  // A link may also have onClick (Mer closes its sheet, also when the row is the page already open).
  if (href) return <Link href={href} onClick={onClick} aria-label={ariaLabel} {...common}>{body}{tail}</Link>;
  if (onClick) return <button type="button" onClick={onClick} aria-label={ariaLabel} {...common}>{body}{tail}</button>;
  return <div {...common}>{body}{tail}</div>;
}

/**
 * A row that chooses with the phone's own picker (a select, a date): the label, the chosen value and a small up-down mark;
 * the control lies invisibly over the whole row, so a tap opens the phone's list or calendar with the full names. Stacked
 * puts the label above a value that may wrap (a long task name is never cut).
 */
export function NativePickerRow({ label, display, stacked = false, testId, children }: { label: string; display: ReactNode; stacked?: boolean; testId?: string; children: ReactNode }) {
  return <div role="listitem" className="native-row native-picker-row" data-plain data-testid={testId}>
    {stacked ? <span className="min-w-0 flex-1 py-0.5">
      <span className="block text-[0.8125rem] leading-[1.125rem] text-muted-foreground">{label}</span>
      <span className="block text-[0.9375rem] leading-5 [overflow-wrap:anywhere]">{display}</span>
    </span> : <>
      <span className="min-w-0 flex-1 truncate text-[0.9375rem] leading-5">{label}</span>
      <span className="max-w-[60%] shrink-0 truncate text-[0.9375rem] text-muted-foreground">{display}</span>
    </>}
    <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
    {children}
  </div>;
}

/** The phone's segmented control (Mina | Alla, Alla | Behöver åtgärd, Dag | Vecka | Månad): one choice of two or three, full
 * width, 44 px tall like every touch control (2026-10-10); used for every such choice at level 1. */
export function NativeSegmented<T extends string>({ value, options, onChange, label, testId }: { value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; label: string; testId?: string }) {
  return <div role="radiogroup" aria-label={label} data-testid={testId} className="native-segmented mb-2 grid gap-1 rounded-[10px] p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(([option, text]) => <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onChange(option)}
      className={cn("h-11 min-w-0 truncate rounded-[8px] px-2 text-sm font-medium", value === option ? "bg-card text-foreground shadow-xs" : "text-muted-foreground")}>{text}</button>)}
  </div>;
}

/**
 * A fact as a row (Nivå 1 på mobil): its label small above, the value under it, wrapping – a job's description, the
 * place, the customer's special requirements. Read only. `tone` "warning" marks what must be heeded.
 */
export function ListFact({ label, children, tone, testId }: { label: ReactNode; children: ReactNode; tone?: "warning"; testId?: string }) {
  return <div role="listitem" className="native-row" data-plain data-testid={testId}>
    <span className="min-w-0 flex-1 py-1">
      <span className={cn("block text-[0.8125rem] leading-[1.125rem]", tone === "warning" ? "font-semibold text-amber-800 dark:text-amber-200" : "text-muted-foreground")}>{label}</span>
      <span className="mt-0.5 block whitespace-pre-line text-[0.9375rem] leading-5 [overflow-wrap:anywhere]">{children}</span>
    </span>
  </div>;
}

/**
 * A page's own buttons as the rows of one group (Nivå 1 på mobil): Exportera, Skicka med e-post, Utgår … each a full-width
 * row with its icon, instead of a desktop row of buttons. The buttons are the page's own (their menus, dialogs, reasons and
 * locks are unchanged); only their look follows the list (app/globals.css, .native-actions). A reason under a button
 * (DisabledReason) reads as the row's note.
 */
export function NativeActions({ title, footer, children, testId }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; testId?: string }) {
  return <section className="native-actions-group" data-testid={testId}>
    {title ? <h2 className="native-group-title">{title}</h2> : <div className="h-3" aria-hidden="true" />}
    <div className="native-group native-actions">{children}</div>
    {footer ? <p className="px-4 pt-1.5 text-xs leading-5 text-muted-foreground">{footer}</p> : null}
  </section>;
}

/**
 * A list on its way (2026-10-15, "kontrollera hur innehållet laddas"): grey rows of the real rows' height in the
 * group's frame, so the page keeps its shape and nothing jumps when the rows arrive. The words are for screen readers.
 */
export function ListSkeleton({ rows = 5, title = true, label = "Hämtar…", testId }: { rows?: number; title?: boolean; label?: string; testId?: string }) {
  return <section aria-busy="true" data-testid={testId}>
    <span role="status" className="sr-only">{label}</span>
    {title ? <div className="native-group-title" aria-hidden="true"><span className="native-skeleton inline-block h-3 w-24 rounded" /></div> : <div className="h-3" aria-hidden="true" />}
    <div className="native-group" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <div key={index} className="native-row" data-plain>
      <span className="native-skeleton size-8 shrink-0 rounded-lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5"><span className="native-skeleton h-3.5 rounded" style={{ width: `${70 - (index % 3) * 12}%` }} /><span className="native-skeleton h-3 w-2/5 rounded" /></span>
    </div>)}</div>
  </section>;
}

/** An empty group: one quiet line in the list's own frame. */
export function ListEmpty({ children }: { children: ReactNode }) {
  return <div className="native-row text-sm text-muted-foreground" data-plain role="listitem">{children}</div>;
}
