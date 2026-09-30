import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Clock3, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTimerDuration } from "@/lib/workflow/running-timer";
import { indicatorBadge, indicatorText, statusTone, type IndicatorTone } from "./indicator-tone";

/** A fact in the header; with `href` it is a link (the project, the protocol a work order came from). */
export type EditorFact = { icon: LucideIcon; label: string; tone?: IndicatorTone; iconClassName?: string; href?: string };
export type EditorTimer = {
  running: boolean;
  totalDurationSec: number;
  onToggle: () => void;
  disabled?: boolean;
  /** Why the timer cannot start, shown as the button's tooltip. */
  hint?: string;
};

// Shared page header for every task editor (2026-09-25, unified 2026-09-27 with the control as the original):
// eyebrow with the task type, title, status and progress below, a row of facts with icons and the reported time,
// then secondary actions, the timer and the primary action at the far right. No separate banner surface.
export function EditorHeader({
  eyebrow,
  title,
  status,
  statusLabel,
  progress,
  detail,
  facts,
  timer,
  actions,
  primaryAction,
  className,
  actionsClassName,
}: {
  eyebrow: string;
  title: string;
  status?: string;
  statusLabel?: string;
  progress?: number;
  detail?: React.ReactNode;
  facts?: EditorFact[];
  timer?: EditorTimer;
  actions?: React.ReactNode;
  /** Rendered after the timer, at the far right. */
  primaryAction?: React.ReactNode;
  className?: string;
  /** Classes for the action buttons (not the timer, which is always reachable, also on mobile). */
  actionsClassName?: string;
}) {
  const allFacts: EditorFact[] = [...(facts ?? []), ...(timer ? [{ icon: Clock3, label: `${formatTimerDuration(timer.totalDurationSec)} rapporterad`, iconClassName: "text-muted-foreground" }] : [])];
  return (
    <div className={cn("editor-header space-y-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="editor-header-title min-w-0">
          <p className="editor-workflow-eyebrow text-xs font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
          <h1 className="page-title mt-1 truncate">{title}</h1>
          <div className="editor-workflow-progress mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {status && statusLabel ? <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 font-medium", indicatorBadge(statusTone(status)))}>{statusLabel}</span> : null}
            {progress !== undefined ? <span className="font-medium text-foreground">{progress}% klart</span> : null}
            {detail}
          </div>
        </div>
        {actions || timer || primaryAction ? (
          <div className="editor-actions flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 max-sm:shrink max-sm:justify-start">
            {actions ? <div className={cn("contents", actionsClassName)}>{actions}</div> : null}
            {timer ? (
              <Button type="button" variant="outline" disabled={timer.disabled} title={timer.disabled ? timer.hint : undefined} aria-pressed={timer.running} className={timer.running ? "border-emerald-300 text-emerald-800 dark:text-emerald-200" : undefined} onClick={timer.onToggle}>
                {timer.running ? <Pause /> : <Play />}{timer.running ? "Pausa tid" : "Starta tid"}
              </Button>
            ) : null}
            {primaryAction ? <div className={cn("contents", actionsClassName)}>{primaryAction}</div> : null}
          </div>
        ) : null}
      </div>
      {allFacts.length ? (
        <div className="editor-facts flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" data-testid="editor-facts">
          {allFacts.map((fact) => (
            fact.href ? <Link key={fact.label} href={fact.href} className="flex items-center gap-2 text-primary underline-offset-4 hover:underline" data-testid="editor-fact-link">
              <fact.icon className="size-4" aria-hidden="true" />{fact.label}
            </Link> : <span key={fact.label} className={cn("flex items-center gap-2", fact.tone && indicatorText(fact.tone))}>
              <fact.icon className={cn("size-4", fact.iconClassName ?? "text-primary")} aria-hidden="true" />{fact.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
