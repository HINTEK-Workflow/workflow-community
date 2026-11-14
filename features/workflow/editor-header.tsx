import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Clock3, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageHeading } from "@/components/page-shell";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { EditorMoreMenu, type EditorMenuItem } from "@/components/editor-ribbon";
import { cn } from "@/lib/utils";
import { headerOverflow } from "@/lib/workflow/editor-header-actions";
import { formatTimerDuration } from "@/lib/workflow/running-timer";
import { indicatorBadge, indicatorText, statusTone, type IndicatorTone } from "./indicator-tone";

/** A fact in the header; with `href` it is a link (the project, the protocol a work order came from). */
/** `keep`: job or safety information (risk class, priority, due date) that every display level shows (2026-10-08). */
export type EditorFact = { icon: LucideIcon; label: string; tone?: IndicatorTone; iconClassName?: string; href?: string; keep?: boolean; /** A short explanation as a tooltip. */ title?: string };
export type EditorTimer = {
  running: boolean;
  totalDurationSec: number;
  onToggle: () => void;
  disabled?: boolean;
  /** Why the timer cannot start: visible under the buttons and as a toast on click (2026-10-08). */
  hint?: string;
  /** Disabled only for a moment (saving): a real disabled button, no reason shown. */
  busy?: boolean;
  /** Arbetsordern styr (2026-10-26): a task's timer runs on its work order and says so ("Starta tid på arbetsordern"). */
  onWorkOrder?: boolean;
};

/**
 * One button of the header (Lika är rätt, 2026-11-14). With `menu` it may move under "Mer ⋯" when more than four buttons
 * would stand there (lib/workflow/editor-header-actions.ts); `keep` moves it last. Without `menu` it always stays visible.
 */
export type EditorHeaderAction = { key: string; node: ReactNode; menu?: EditorMenuItem; keep?: boolean };
export type MaybeHeaderAction = EditorHeaderAction | null | false | undefined;
const isAction = (item: MaybeHeaderAction): item is EditorHeaderAction => Boolean(item);
const isHeaderAction = (value: unknown): value is EditorHeaderAction => Boolean(value) && typeof value === "object" && "key" in (value as object) && "node" in (value as object);

/** The buttons of a list, all of them, where no rule of four applies (the native page’s Hantering). */
export function HeaderActionNodes({ items, wrap }: { items: MaybeHeaderAction[]; /** Around the buttons; nothing is drawn when there are none. */ wrap?: (nodes: ReactNode) => ReactNode }) {
  const shown = items.filter(isAction);
  if (!shown.length) return null;
  const nodes = <>{shown.map((item) => <Fragment key={item.key}>{item.node}</Fragment>)}</>;
  return wrap ? wrap(nodes) : nodes;
}

/** The id of the visible line under the header's buttons that says why the primary action (Spara) is blocked. */
export const EDITOR_PRIMARY_REASON_ID = "editor-primary-reason";
const TIMER_REASON_ID = "editor-timer-reason";

// Shared page header for every task editor (2026-09-25, unified 2026-09-27 with the control as the original):
// title, the kind of task with status and progress below, a row of facts with icons and the reported time,
// then secondary actions, the timer and the primary action at the far right. No separate banner surface.
// The same top as every page (PageHeader/StandardPage, plan 1Q, 2026-10-11): title left, status and facts
// under, all buttons top right – destructive (red) furthest left, secondary ones, Avbryt, the primary action furthest right.
export function EditorHeader({
  kind,
  title,
  status,
  statusLabel,
  progress,
  detail,
  facts,
  timer,
  actions,
  destructiveAction,
  primaryAction,
  className,
  actionsClassName,
  flow,
  primaryReason,
  cancelAction,
  moreActions,
  moreTestId = "editor-more",
  pageHeading = true,
}: {
  /**
   * The exact kind when the title does not say it (the form's name, ÄTA): first in the line under the title. Fasta platser
   * (2026-10-30): never an eyebrow over the title, so the title starts at the same height as on every other page.
   */
  kind?: string;
  title: string;
  status?: string;
  statusLabel?: string;
  progress?: number;
  detail?: React.ReactNode;
  facts?: EditorFact[];
  timer?: EditorTimer;
  /** The secondary buttons, left to right. As a list they follow the rule of at most four buttons (the rest under Mer). */
  actions?: React.ReactNode | MaybeHeaderAction[];
  /** The destructive action (Ta bort …, red), furthest left in the group (plan 1Q); the first to move under Mer. */
  destructiveAction?: React.ReactNode | EditorHeaderAction;
  /** Rows that always live under Mer (seldom used). */
  moreActions?: EditorMenuItem[];
  moreTestId?: string;
  /** false over another page (the fakturaunderlag over its list): the page under keeps its own heading in the trail. */
  pageHeading?: boolean;
  /** Rendered after the timer, at the far right. */
  primaryAction?: React.ReactNode;
  className?: string;
  /** Classes for the action buttons (not the timer, which is always reachable, also on mobile). */
  actionsClassName?: string;
  /** The progress line with its tip (2026-10-01), between the icon row and the first panel. */
  flow?: React.ReactNode;
  /** Why the primary action (Spara) cannot be used now, shown as text under the buttons (2026-10-08). */
  primaryReason?: string;
  /** Avbryt or "Tillbaka till …" (samband, 2026-10-26): just left of the primary action, as on every form page. */
  cancelAction?: React.ReactNode;
}) {
  // The trail of a task that is not saved yet says what the heading says ("Ny kontroll", simulation 0.6.3).
  usePageHeading(pageHeading ? title : undefined);
  const timerReason = timer?.disabled && !timer.busy ? timer.hint || "Tiden kan inte startas just nu." : "";
  // One line per reason; when Spara and Starta tid are blocked for the same reason it is said once.
  const timerReasonId = timerReason && timerReason === primaryReason ? EDITOR_PRIMARY_REASON_ID : TIMER_REASON_ID;
  const reasons = [...(timerReason && timerReasonId === TIMER_REASON_ID ? [{ id: TIMER_REASON_ID, text: timerReason }] : []), ...(primaryReason ? [{ id: EDITOR_PRIMARY_REASON_ID, text: primaryReason }] : [])];
  // Högst fyra knappar (2026-11-14): what does not fit moves under Mer; Avbryt and Spara are never counted.
  const listed = Array.isArray(actions) ? (actions as MaybeHeaderAction[]).filter(isAction) : null;
  const destructive = isHeaderAction(destructiveAction) ? destructiveAction : null;
  const buttons = [...(destructive ? [{ key: destructive.key, movable: Boolean(destructive.menu), destructive: true }] : []), ...(listed ?? []).map((item) => ({ key: item.key, movable: Boolean(item.menu), keep: item.keep }))];
  const moved = new Set(listed || destructive || moreActions?.length ? headerOverflow(buttons, { fixed: timer ? 1 : 0, more: Boolean(moreActions?.length) }) : []);
  const menuItems: EditorMenuItem[] = [
    ...(listed ?? []).filter((item) => moved.has(item.key)).map((item) => item.menu!),
    ...(moreActions ?? []),
    ...(destructive && moved.has(destructive.key) ? [{ ...destructive.menu!, danger: true }] : []),
  ];
  const destructiveNode: ReactNode = destructive ? (moved.has(destructive.key) ? null : destructive.node) : destructiveAction as ReactNode;
  const actionsNode: ReactNode = listed || menuItems.length ? <>
    {listed ? listed.filter((item) => !moved.has(item.key)).map((item) => <Fragment key={item.key}>{item.node}</Fragment>) : actions as ReactNode}
    {menuItems.length ? <EditorMoreMenu items={menuItems} label="Mer" testId={moreTestId} triggerClassName="size-[var(--control-h)] max-lg:size-11" /> : null}
  </> : actions as ReactNode;
  const allFacts: EditorFact[] = [...(facts ?? []), ...(timer ? [{ icon: Clock3, label: `${formatTimerDuration(timer.totalDurationSec)} rapporterad${timer.onWorkOrder ? " på arbetsordern" : ""}`, iconClassName: "text-muted-foreground" }] : [])];
  return (
    <div className={cn("editor-header space-y-4", className)} data-standard-header="">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* The title gives way (truncates) before the buttons leave the top right: a work order with Ta bort, Rapportera hinder,
            Utgår, Starta tid and Spara kept the row at 1366 px only when the title may shrink (2026-10-27). */}
        <div className="editor-header-title min-w-0 flex-1 basis-48">
          <h1 className="page-title truncate">{title}</h1>
          <div className="editor-workflow-progress mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {kind ? <span className="editor-workflow-kind font-medium text-foreground" data-testid="editor-kind">{kind}</span> : null}
            {status && statusLabel ? <span className={cn("inline-flex rounded-full border px-2 py-0.5 font-semibold", indicatorBadge(statusTone(status)))}>{statusLabel}</span> : null}
            {progress !== undefined ? <span className="font-medium text-foreground">{progress}% klart</span> : null}
            {detail}
          </div>
        </div>
        {actionsNode || destructiveNode || timer || primaryAction || cancelAction ? (
          <div className="editor-actions flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:ml-auto max-sm:shrink max-sm:justify-start" data-standard-actions="">
            {destructiveNode ? <div className={cn("contents", actionsClassName)}>{destructiveNode}</div> : null}
            {actionsNode ? <div className={cn("contents", actionsClassName)}>{actionsNode}</div> : null}
            {timer ? (
              <Button type="button" variant="outline" disabled={timer.disabled && timer.busy} disabledReason={timerReason} aria-describedby={timerReason ? timerReasonId : undefined} aria-pressed={timer.running} className={timer.running ? "border-emerald-300 text-emerald-800 dark:text-emerald-200" : undefined} onClick={timer.onToggle}>
                {timer.running ? <Pause /> : <Play />}{timer.running ? "Pausa tid" : timer.onWorkOrder ? "Starta tid på arbetsordern" : "Starta tid"}
              </Button>
            ) : null}
            {cancelAction ? <div className={cn("contents", actionsClassName)}>{cancelAction}</div> : null}
            {primaryAction ? <div className={cn("contents", actionsClassName)}>{primaryAction}</div> : null}
          </div>
        ) : null}
      </div>
      {reasons.length ? <div className="editor-reasons -mt-2 flex flex-col items-end gap-0.5 text-right max-sm:items-start max-sm:text-left">
        {reasons.map((reason) => <DisabledReason key={reason.id} id={reason.id} reason={reason.text} />)}
      </div> : null}
      {allFacts.length ? (
        <div className="editor-facts flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" data-testid="editor-facts">
          {allFacts.map((fact) => (
            // A link with `keep` stays at level 1 like any kept fact ("Från …", the log entries; 2026-10-11).
            fact.href ? <Link key={fact.label} href={fact.href} data-fact-keep={fact.keep ? "" : undefined} className="flex items-center gap-2 text-primary underline-offset-4 hover:underline" data-testid="editor-fact-link">
              <fact.icon className="size-4" aria-hidden="true" />{fact.label}
            </Link> : <span key={fact.label} title={fact.title} data-fact-keep={fact.keep ? "" : undefined} className={cn("flex items-center gap-2", fact.tone && indicatorText(fact.tone))}>
              <fact.icon className={cn("size-4", fact.iconClassName ?? "text-primary")} aria-hidden="true" />{fact.label}
            </span>
          ))}
        </div>
      ) : null}
      {flow}
    </div>
  );
}
