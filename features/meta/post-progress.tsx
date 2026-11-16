"use client";

import { Ban, Check, Circle, Loader2, X } from "lucide-react";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { STEP_LABEL, type PublishProgress, type StepStatus } from "@/lib/meta/progress";

/**
 * Publiceringens förlopp (2026-11-15, built 2026-11-16): the steps of Testpublicering or Publicera as they happen – the
 * picture, then each channel – with a status per step, and the summary once finished (also what an Avbryt left published).
 * The run goes on on the server; this only shows what the post says.
 */
export function PublishProgressPanel({ progress }: { progress: PublishProgress }) {
  const title = progress.running
    ? (progress.cancelRequested ? "Avbryter…" : progress.mode === "test" ? "Testpublicerar…" : "Publicerar…")
    : progress.message ?? (progress.mode === "test" ? "Testpubliceringen är klar." : "Publiceringen är klar.");
  return <div className="notice space-y-2" role="status" aria-live="polite" data-testid="post-result" data-running={progress.running ? "true" : "false"}>
    <p className="font-medium" data-testid="post-result-message">{title}</p>
    <ol className="space-y-1" aria-label="Steg">
      {progress.steps.map((step) => <li key={step.key} className="flex items-start gap-2 text-sm" data-testid={`post-step-${step.key}`} data-status={step.status}>
        <StepIcon status={step.status} />
        <span className="min-w-0">
          <span className="font-medium">{STEP_LABEL[step.key]}</span>
          <span className={cn(step.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{step.detail ? `: ${step.detail}` : step.status === "waiting" ? ": Väntar" : ""}</span>
        </span>
      </li>)}
    </ol>
    {!progress.running && progress.finishedAt ? <p className="text-xs text-muted-foreground">{progress.mode === "test" ? "Testpublicering" : "Publicering"} {formatSwedish(progress.finishedAt, { dateStyle: "medium", timeStyle: "short" })}.</p> : null}
  </div>;
}

const ICON_LABEL: Record<StepStatus, string> = { waiting: "Väntar", running: "Pågår", done: "Klart", failed: "Misslyckades", cancelled: "Avbrutet" };

function StepIcon({ status }: { status: StepStatus }) {
  const className = "mt-0.5 size-4 shrink-0";
  const icon = status === "running" ? <Loader2 className={cn(className, "animate-spin")} aria-hidden="true" />
    : status === "done" ? <Check className={cn(className, "text-emerald-700 dark:text-emerald-300")} aria-hidden="true" />
      : status === "failed" ? <X className={cn(className, "text-destructive")} aria-hidden="true" />
        : status === "cancelled" ? <Ban className={cn(className, "text-muted-foreground")} aria-hidden="true" />
          : <Circle className={cn(className, "text-muted-foreground")} aria-hidden="true" />;
  return <span className="contents" title={ICON_LABEL[status]}>{icon}<span className="sr-only">{ICON_LABEL[status]}:</span></span>;
}
