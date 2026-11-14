"use client";

import Link from "next/link";
import { RowChevron } from "@/components/row-chevron";
import type { ReactNode } from "react";
import { CheckCircle2, Repeat, OctagonAlert, type LucideIcon } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { Button } from "@/components/ui/button";
import { indicatorText, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { JOB_STATUS_LABELS } from "@/lib/workflow/job-state";
import { typeOfTaskKind } from "@/lib/workflow/native-mode";
import type { PanelArea } from "@/lib/workflow/panel-area";
import { cn } from "@/lib/utils";
import type { MeRow } from "@/lib/overview/me";
import { EmptyNote, GrowBar, Pill } from "./viz";

/**
 * The overview's rows (2026-10-29): Jag's and Teamet's lists share one row – the title, a line under it, the
 * progression (status, line, figure), and the pill and the button in fixed columns where the card is wide enough – so every
 * list reads the same. Also the status names and tones, a row's icon by what it is, the empty line and the day card on top.
 */

/** One row of a list box: the title opens it, the fact at the end (a day in red when late), an optional pill and action. */
export function Row({ row, area, icon, pill, action, highlight = false, meta, columns = false, pillColumn = true }: { row: MeRow; area: PanelArea; icon?: LucideIcon; pill?: ReactNode; action?: ReactNode; highlight?: boolean;
  /** A third line under the detail (Gör detta nu: the status and the progress line). */
  meta?: ReactNode;
  /**
   * Fixed columns for the pill and the action (2026-09-29 and 2026-10-29: "en bestämd plats och bredd … så man inte
   * upplever att det ligger huller om buller"): the shared work list's widths, kept also when a row has none, so every
   * row's pill starts and every button ends at the same place. A phone keeps them inline.
   */
  columns?: boolean;
  /** The pill's column; left out in the half-wide cards, whose red line already says what is late. */
  pillColumn?: boolean }) {
  if (columns) return <li className={cn("tap-card relative flex items-center gap-3 p-3", highlight && "bg-[color-mix(in_srgb,var(--destructive)_6%,transparent)]")} data-highlight={highlight || undefined}>
    <AreaIcon area={area} icon={icon} className="mt-0.5 self-start" />
    <div className="min-w-0 flex-1">
      <Link href={row.href} className="stretched-link block truncate text-sm font-semibold hover:text-primary">{row.title}</Link>
      <p className={cn("truncate text-xs tabular-nums", row.late ? cn("font-medium", indicatorText("danger")) : "text-muted-foreground")} title={row.detail}>{row.detail}</p>
      {/* At least one line high, so a row is as high with or without a pill and the cards' lines meet (2026-10-29); where the row is too narrow for the line the bar goes (the status and the figure stay), and on a phone the pill may wrap. */}
      {/* In a narrow card (under 36 rem) the pill goes into this line, after the progression, so the title keeps its room. */}
      {meta || (pillColumn && pill) ? <div className="@container/meta mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden">{meta}{pillColumn && pill ? <span className="flex shrink-0 @xl/rows:hidden">{pill}</span> : null}</div> : null}
    </div>
    {/* The fixed columns only where the card is wide enough (a container query on the list, 2026-10-29: "fungerar inte
        så bra i denna bredden"); an empty one is kept only there, so a narrow row never gives its room to nothing. */}
    {pillColumn ? <div className="hidden shrink-0 justify-start @xl/rows:flex @xl/rows:w-[8.5rem]" data-column="pill">{pill}</div> : null}
    <div className={cn("tap-above relative shrink-0 justify-end @xl/rows:flex @xl/rows:w-[6.5rem] @xl/rows:[&_a]:w-full @xl/rows:[&_button]:w-full", action ? "flex" : "hidden")} data-column="action">{action}</div>
    {row.href ? <RowChevron /> : null}
  </li>;
  return <li className={cn("tap-card relative flex items-center gap-3 p-3", highlight && "bg-[color-mix(in_srgb,var(--destructive)_6%,transparent)]")} data-highlight={highlight || undefined}>
    {/* At the title's height, so the icon stays put when a row has two or three lines. */}
    <AreaIcon area={area} icon={icon} className="mt-0.5 self-start" />
    <div className="min-w-0 flex-1">
      <Link href={row.href} className="stretched-link block truncate text-sm font-semibold hover:text-primary">{row.title}</Link>
      <p className={cn("truncate text-xs tabular-nums", row.late ? cn("font-medium", indicatorText("danger")) : "text-muted-foreground")} title={row.detail}>{row.detail}</p>
      {/* A fixed height, so a row is as high with or without a pill and the cards' lines meet (2026-10-29). */}
      {meta ? <div className="mt-1.5 flex h-5 items-center gap-2 overflow-hidden">{meta}</div> : null}
    </div>
    {pill}
    {action ? <div className="tap-above relative shrink-0">{action}</div> : null}
    {row.href ? <RowChevron /> : null}
  </li>;
}

export function RowList({ children, testId }: { children: ReactNode; testId?: string }) {
  return <ul className="@container/rows divide-y rounded-lg border" data-testid={testId}>{children}</ul>;
}

/** The empty line of a box: one short sentence, the box keeps its frame. */
export const Calm = ({ text }: { text: string }) => <EmptyNote compact icon={CheckCircle2} title={text} />;

/** A job's status (the shared names) or a deviation's, with its tone; none for a round. */
export const STATUS_TONE: Record<string, IndicatorTone> = { PLANNED: "neutral", IN_PROGRESS: "info", PAUSED: "warning", NEEDS_ACTION: "danger", OPEN: "neutral", ROUND_NOT_STARTED: "warning", ROUND_STARTED: "info", READY_TO_CLOSE: "success" };
// A project's own states (Projektläge, 2026-10-29) beside the jobs' and the deviations'.
export const OWN_STATUS: Record<string, string> = { OPEN: "Öppen", ROUND_NOT_STARTED: "Ej påbörjad", ROUND_STARTED: "Påbörjad", READY_TO_CLOSE: "Klar att avsluta" };
export function statusOf(status: string | undefined): { label: string; tone: IndicatorTone } | null {
  if (!status) return null;
  const label = OWN_STATUS[status] ?? JOB_STATUS_LABELS[status];
  return label ? { label, tone: STATUS_TONE[status] ?? "neutral" } : null;
}

/**
 * A row's progression (2026-10-29, Gör detta nu, Förfallet and Mina avvikelser alike): the status in a pill of a fixed
 * width, then a job's completion as a line with "N % klart", or a deviation's steps Öppen → Pågår → Åtgärdad (its real
 * status; a deviation has no percentage). Nothing for a round, which has neither.
 */
export const DEVIATION_STEPS = ["OPEN", "IN_PROGRESS", "DONE"] as const;
export function Progression({ kind, status, progress }: { kind?: string; status?: string; progress?: number | null }) {
  const shown = statusOf(status);
  const deviation = kind === "DEVIATION";
  if (!shown && typeof progress !== "number") return null;
  const step = deviation ? Math.max(0, DEVIATION_STEPS.indexOf((status ?? "OPEN") as (typeof DEVIATION_STEPS)[number])) + 1 : 0;
  return <>
    {/* A fixed start for the line, so the rows' progress lines align. */}
    {shown ? <Pill tone={shown.tone} className="min-w-[5.5rem] shrink-0 justify-center">{shown.label}</Pill> : null}
    {deviation ? <>
      <span className="hidden h-1.5 min-w-8 max-w-28 grow basis-8 gap-0.5 @[13rem]/meta:flex" aria-hidden="true">
        {DEVIATION_STEPS.map((item, index) => <span key={item} className={cn("h-full flex-1 rounded-full", index < step ? "bg-primary" : "bg-muted")} />)}
      </span>
      <span className="shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums text-muted-foreground">steg {step} av {DEVIATION_STEPS.length}</span>
    </> : typeof progress === "number" ? <>
      <GrowBar value={progress} max={100} className="hidden h-1.5 min-w-8 max-w-28 grow basis-8 @[13rem]/meta:block" fill={progress >= 100 ? "bg-[var(--type-round)]" : "bg-primary"} />
      <span className="shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums text-muted-foreground">{progress} % klart</span>
    </> : null}
  </>;
}

/** The row's own action in the action column: a round is done, a deviation handled; a job opens from its title. */
export function RowAction({ kind, href, title }: { kind?: string; href: string; title: string }) {
  if (kind === "ROUND") return <Button asChild size="sm" variant="outline"><Link href={href} aria-label={`Gör ronden ${title}`}>Gör ronden</Link></Button>;
  if (kind === "DEVIATION") return <Button asChild size="sm" variant="outline"><Link href={href} aria-label={`Åtgärda ${title}`}>Åtgärda</Link></Button>;
  return null;
}

/** A row's icon by what it is: a round, a deviation, a work order or another task (Översiktens lyft, 2026-10-29). */
export function rowLook(kind: string | undefined, id: string): { area: PanelArea; icon?: LucideIcon } {
  const what = kind ?? (id.startsWith("round:") ? "ROUND" : id.startsWith("deviation:") ? "DEVIATION" : "WORK_ORDER");
  if (what === "ROUND") return { area: "round", icon: Repeat };
  if (what === "DEVIATION") return { area: "tools", icon: OctagonAlert };
  // A job by the shared rule: a work order red, a risk assessment orange, a protocol violet.
  return { area: typeOfTaskKind(what) };
}

/**
 * The card on top of a tab (Jag's greeting, Teamet's situation; 2026-10-29): a small line (the day and the week), a
 * title, one sentence and figures, each opening its card. A figure of 0 is left out.
 */
export type HeadlineChip = { count: number; label: string; href: string; icon: LucideIcon; tone: IndicatorTone; testId: string };
export function HeadlineCard({ kicker, title, sentence, chips, label, testId, footer }: { kicker: ReactNode; title: string; sentence: string; chips: readonly HeadlineChip[]; label: string; testId: string;
  /** A line under the card's text (Jag: my absence and its quick choices, 2026-10-29). */
  footer?: ReactNode }) {
  return <section aria-label={label} className="app-panel flex flex-col gap-x-6 gap-y-3 rounded-lg md:flex-row md:items-end md:justify-between border bg-[linear-gradient(110deg,color-mix(in_srgb,var(--primary)_9%,var(--card))_0%,var(--card)_55%)] px-5 py-4" data-testid={testId}>
    <div className="min-w-0 max-w-2xl md:flex-1">
      <p className="text-xs text-muted-foreground">{kicker}</p>
      <h2 className="mt-1 text-2xl font-bold tracking-tight">{title}</h2>
      {/* The same height on every tab (2026-10-30): the sentence keeps room for its lines and the footer row is kept even
          when a tab has none, so the banner does not change height between Jag, Teamet, Ekonomi and Kunder. */}
      <p className="mt-1 min-h-[3lh] text-sm text-muted-foreground xl:min-h-[2lh]">{sentence}</p>
      <div className="mt-3 flex min-h-8 items-center">{footer}</div>
    </div>
    {/* From md the chips keep a column of their own and wrap inside it, so they never push the banner taller. */}
    <div className="flex flex-wrap gap-2 md:max-w-[45%] md:shrink-0 md:justify-end">
      {chips.filter((chip) => chip.count > 0).map(({ count, label: text, href, icon: Icon, tone, testId: chipId }) => <Link key={chipId} href={href} className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/40" data-testid={chipId}>
        <Pill tone={tone} className="gap-1.5 whitespace-nowrap px-2.5 py-1 hover:brightness-95"><Icon className="size-3.5" aria-hidden="true" />{count} {text}</Pill>
      </Link>)}
    </div>
  </section>;
}

/** A number that opens its list: the figure in tabular digits, the words after it. */
/** A part of a figure that has no list of its own: the same look as CountLink, without a link, so the parts add up to the figure. */
export function CountText({ count, children, testId }: { count: number; children: ReactNode; testId?: string }) {
  return <span data-testid={testId} className="inline-flex items-baseline gap-1 text-xs font-medium text-muted-foreground"><span className="font-semibold tabular-nums">{count}</span>{children}</span>;
}

export function CountLink({ href, count, children, tone, testId }: { href: string; count: number; children: ReactNode; tone?: "danger"; testId?: string }) {
  return <Link href={href} data-testid={testId} className={cn("inline-flex items-baseline gap-1 rounded-sm text-xs font-medium hover:underline", tone === "danger" && count ? indicatorText("danger") : "text-muted-foreground hover:text-primary")}>
    <span className="font-semibold tabular-nums">{count}</span>{children}
  </Link>;
}
