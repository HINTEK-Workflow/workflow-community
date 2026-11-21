"use client";

import { AlertTriangle, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { indicatorText } from "@/features/workflow/indicator-tone";
import { effortHours, projectEffort, unbookedText, type EffortJob, type ProjectEffort } from "@/lib/workflow/project-effort";

/**
 * Projektets tre tal (projektförslaget 2026-10-09, steg 2) inside the panel Projektprogression: Uppskattat · Bokat ·
 * Rapporterat in hours, the soft "x h är inte bokade", and "x av y jobb färdigställda" with a note when the percentage is
 * weighted by Uppskattad tid. Reads what the project page already has (Cloud, Local and the demo); nothing is fetched.
 */
export function ProjectEffortRow({ tasks, plannedMinutes, budgetMinutes, quotedMinutes }: { tasks: readonly EffortJob[]; plannedMinutes: ReadonlyMap<string, number>;
  /** Budget (plan 1L, 2026-10-11): the project's time budget in minutes; 0 or missing shows "–". */
  budgetMinutes?: number | null;
  /** Offererat: the agreed quote versions' Arbete hours in minutes, from the project's quote summary; null shows "–". */
  quotedMinutes?: number | null }) {
  return <ProjectEffortCells effort={projectEffort(tasks, plannedMinutes)} budgetMinutes={budgetMinutes} quotedMinutes={quotedMinutes} />;
}

/**
 * The same row from figures already counted (plan 1M, Planering: the server sends each project's ProjectEffort), so the
 * project page and Planering show one row, not two looks.
 */
export function ProjectEffortCells({ effort, budgetMinutes, quotedMinutes }: { effort: ProjectEffort; budgetMinutes?: number | null; quotedMinutes?: number | null }) {
  // A project without jobs still shows its Budget (simulation 0.6.4); with neither jobs nor a budget there is nothing to say.
  if (!effort.jobs && !budgetMinutes) return null;
  const unbooked = unbookedText(effort);
  const cells = [
    { label: "Budget", value: budgetMinutes ? effortHours(budgetMinutes) : "–", hint: budgetMinutes ? "Projektets tidsbudget" : "Projektet har ingen tidsbudget", testId: "project-effort-budget" },
    { label: "Offererat", value: typeof quotedMinutes === "number" ? effortHours(quotedMinutes) : "–", hint: typeof quotedMinutes === "number" ? "Arbetstimmar i de godkända offertversionerna" : "Inga godkända offerter med arbetstimmar", testId: "project-effort-quoted" },
    { label: "Uppskattat", value: effort.estimatedJobs ? effortHours(effort.estimatedMinutes) : "–", hint: effort.estimatedJobs ? `${effort.estimatedJobs} av ${effort.jobs} jobb har uppskattad tid` : "Inga jobb har uppskattad tid", testId: "project-effort-estimated" },
    { label: "Bokat", value: effortHours(effort.bookedMinutes), hint: "Personalens bokningar på jobben", testId: "project-effort-booked" },
    { label: "Rapporterat", value: effortHours(effort.reportedMinutes), hint: "Faktisk tid", testId: "project-effort-reported" },
  ];
  return <section aria-label="Budget, offererat, uppskattat, bokat och rapporterat" data-testid="project-effort" className="mt-4 space-y-2">
    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
      {/* Two columns on a phone (the fifth box takes the whole last row), five in a row from tablet width. */}
      {cells.map((cell, index) => <div key={cell.label} className={cn("rounded-lg border bg-card p-2.5", index === cells.length - 1 && "max-sm:col-span-2")} title={cell.hint}>
        <dt className="text-muted-foreground">{cell.label}</dt>
        <dd data-testid={cell.testId} className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{cell.value}</dd>
      </div>)}
    </dl>
    {effort.jobs ? <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span data-testid="project-effort-done">{effort.completedJobs} av {effort.jobs} jobb färdigställda</span>
      {effort.weighted ? <span data-testid="project-effort-weighted" className="inline-flex items-center gap-1"><Scale aria-hidden="true" className="size-3.5" />Procenten viktas efter uppskattad tid</span> : null}
      {unbooked ? <span data-testid="project-effort-unbooked" className={cn("inline-flex items-center gap-1 font-medium", indicatorText("warning"))}><AlertTriangle aria-hidden="true" className="size-3.5" />{unbooked}</span> : null}
    </p> : null}
  </section>;
}
