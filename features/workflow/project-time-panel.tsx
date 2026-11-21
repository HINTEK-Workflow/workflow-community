"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock3, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunningTimers } from "@/components/workspace-actions";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { announce } from "@/lib/workflow/toast";
import { formatTimerDuration, type StoppedTimer } from "@/lib/workflow/running-timer";
import { projectTimeTotals } from "@/lib/workflow/time-owner";
import { announceTimerChange, stopMessage, useShortStopGuard, useStartTimerGuard } from "./running-timer";

/**
 * Projekttid (2026-10-26, svar 5a): time on the project itself, without a work order – project management, meetings
 * – with the same timer and written time as on a work order. One running timer per person (starting here stops the one on
 * a work order, after the same question). The project's work orders' time is summed beside it and never counted twice:
 * every entry has exactly one owner. Cloud and the demo through Tid's route; Local through the open file (`local`).
 */
export function ProjectTimePanel({ project, workOrderSeconds, locked, local, onChanged }: {
  project: { id: string; name: string; projectTimeSec?: number };
  /** The project's work orders' reported time. */
  workOrderSeconds: number;
  /** Archived or closed: no new time. */
  locked: boolean;
  local?: { timer: (projectId: string, command: "START" | "PAUSE", options?: { keepShort?: boolean }) => Promise<StoppedTimer[]> };
  onChanged?: () => void;
}) {
  const source = useRunningTimers();
  const running = source?.timers.find((timer) => timer.kind === "PROJECT" && timer.taskId === project.id) ?? null;
  const { allowStart, element: startGuard } = useStartTimerGuard();
  const { allowStop, element: stopGuard } = useShortStopGuard();
  const [busy, setBusy] = useState(false);
  const totals = projectTimeTotals({ workOrderSeconds, projectSeconds: project.projectTimeSec ?? 0 });
  async function toggle() {
    const start = !running;
    const choice = start ? await allowStart({ taskId: project.id, title: `projekttid för ${project.name}` }) : await allowStop(running!.startedAt, source?.clockOffsetMs ?? 0);
    if (!choice) return;
    setBusy(true);
    try {
      const command = start ? "START" : "PAUSE";
      const stopped = local ? await local.timer(project.id, command, { keepShort: choice.keepShort })
        : (await api<{ stopped?: StoppedTimer[] }>("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "project_timer", projectId: project.id, command, keepShort: choice.keepShort }) })).stopped ?? [];
      announceTimerChange(stopped);
      announce(start ? "Projekttiden går." : stopMessage(choice));
      onChanged?.();
    } catch (issue) { announce((issue as Error).message, true); }
    finally { setBusy(false); }
  }
  return <div data-testid="project-time"><Panel icon={Clock3} title="Projekttid" description="Tid på projektet utan arbetsorder, till exempel projektledning och möten."
    actions={<>
      <Button type="button" variant="outline" disabled={busy || (locked && !running)} disabledReason={locked && !running ? "Projektet är avslutat eller arkiverat." : ""} aria-pressed={Boolean(running)} onClick={() => void toggle()} data-testid="project-time-toggle">
        {running ? <Pause /> : <Play />}{running ? "Pausa projekttid" : "Starta projekttid"}
      </Button>
      <Button asChild variant="outline"><Link href={`/?view=time&timeProjectId=${encodeURIComponent(project.id)}`} data-testid="project-time-report">Skriv tid</Link></Button>
    </>}>
    <dl className="grid gap-3 text-sm sm:grid-cols-3" data-testid="project-time-totals">
      <div><dt className="text-xs text-muted-foreground">Projekttid</dt><dd className="mt-0.5 font-semibold tabular-nums" data-testid="project-time-own">{formatTimerDuration(totals.project)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Arbetsordrarnas tid</dt><dd className="mt-0.5 font-semibold tabular-nums">{formatTimerDuration(totals.workOrders)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Totalt i projektet</dt><dd className="mt-0.5 font-semibold tabular-nums" data-testid="project-time-total">{formatTimerDuration(totals.total)}</dd></div>
    </dl>
    {startGuard}{stopGuard}
  </Panel></div>;
}
