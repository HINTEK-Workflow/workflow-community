"use client";

import { useState } from "react";
import Link from "next/link";
import { AlarmClock, CalendarClock, CheckCircle2, ChevronRight, CircleAlert, Clock3, FolderKanban, Gauge, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OverviewKpis } from "@/lib/workflow/overview-kpis";
import { indicatorBar, indicatorText, type IndicatorTone } from "./indicator-tone";

const hours = (minutes: number) => `${(Math.round((minutes / 60) * 10) / 10).toLocaleString("sv-SE")} h`;

type Tile = { label: string; value: string; detail: string; tone: IndicatorTone; icon: React.ElementType; surface: string; href?: string; meter?: { percent: number; tone: IndicatorTone } };

function tiles(kpis: OverviewKpis, scope: "team" | "mine"): Tile[] {
  const reportedPercent = kpis.weeklyTargetMinutes ? Math.round((kpis.reportedMinutes / kpis.weeklyTargetMinutes) * 100) : 0;
  const plannedPercent = kpis.weeklyTargetMinutes ? Math.round((kpis.plannedMinutes / kpis.weeklyTargetMinutes) * 100) : 0;
  const free = kpis.weeklyTargetMinutes - kpis.plannedMinutes;
  return [
    { label: "Öppna uppgifter", value: String(kpis.openTasks), detail: `${kpis.inProgressTasks} pågår`, tone: "info", icon: ListTodo, surface: "bg-secondary text-primary", href: "/?view=tasks" },
    { label: "Behöver åtgärdas", value: String(kpis.needsActionTasks), detail: kpis.needsActionTasks ? "Kräver uppföljning" : "Inget blockerat", tone: kpis.needsActionTasks ? "danger" : "success", icon: CircleAlert, surface: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300", href: "/?view=notifications" },
    { label: "Förfallna", value: String(kpis.overdueTasks), detail: `${kpis.dueSoonTasks} förfaller inom 7 dagar`, tone: kpis.overdueTasks ? "danger" : kpis.dueSoonTasks ? "warning" : "success", icon: AlarmClock, surface: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300", href: "/?view=notifications" },
    { label: "Slutförda, 30 dagar", value: String(kpis.completedLast30Days), detail: "Uppgifter och kontroller", tone: "success", icon: CheckCircle2, surface: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300", href: "/?view=tasks" },
    { label: "Rapporterad tid denna vecka", value: hours(kpis.reportedMinutes), detail: `av ${hours(kpis.weeklyTargetMinutes)} veckomål`, tone: reportedPercent >= 100 ? "success" : "info", icon: Clock3, surface: "bg-secondary text-primary", href: "/?view=time", meter: { percent: reportedPercent, tone: reportedPercent >= 100 ? "success" : "info" } },
    { label: "Planerad tid denna vecka", value: hours(kpis.plannedMinutes), detail: free >= 0 ? `${hours(free)} ledig kapacitet` : `${hours(-free)} överbokat`, tone: free < 0 ? "warning" : "info", icon: CalendarClock, surface: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300", href: "/?view=planning", meter: { percent: plannedPercent, tone: free < 0 ? "warning" : "info" } },
    { label: "Pågående projekt", value: String(kpis.ongoingProjects), detail: `${kpis.readyToCloseProjects ? `${kpis.readyToCloseProjects} klara att avsluta · ` : ""}${kpis.overdueProjects} försenade · ${kpis.overBudgetProjects} över budget`, tone: kpis.overdueProjects || kpis.overBudgetProjects ? "danger" : "success", icon: FolderKanban, surface: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300", href: "/?view=projects" },
    { label: "Beläggning", value: `${plannedPercent}%`, detail: scope === "team" ? `${kpis.people} ${kpis.people === 1 ? "person" : "personer"} i teamet` : "Planerat av ditt veckomål", tone: plannedPercent > 100 ? "warning" : plannedPercent >= 70 ? "success" : "info", icon: Gauge, surface: "bg-secondary text-primary", href: "/?view=planning" },
  ];
}

/** Team and personal key figures at the top of the overview (2026-09-26). Details follow further down. */
export function OverviewKpiDashboard({ team, mine, loading = false, error = "" }: { team: OverviewKpis | null; mine: OverviewKpis | null; loading?: boolean; error?: string }) {
  const [scope, setScope] = useState<"team" | "mine">(team ? "team" : "mine");
  const active = scope === "team" && team ? team : mine;
  const current = scope === "team" && team ? "team" : "mine";
  return (
    <section aria-labelledby="overview-kpi-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="overview-kpi-heading" className="section-title">Nyckeltal</h2>
          <p className="text-xs text-muted-foreground">{current === "team" ? "Hela teamet" : "Ditt eget arbete"} · tid och planering gäller innevarande vecka</p>
        </div>
        {team ? (
          <div className="flex gap-1 rounded-full border bg-card p-1" role="group" aria-label="Visa nyckeltal för">
            {([["team", "Teamet"], ["mine", "Jag"]] as const).map(([value, label]) => (
              <Button key={value} type="button" size="sm" className="h-7 rounded-full" variant={current === value ? "default" : "ghost"} aria-pressed={current === value} onClick={() => setScope(value)}>{label}</Button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="overview-kpis">
        {(active ? tiles(active, current) : Array.from({ length: 8 }, () => null)).map((tile, index) => {
          if (!tile) return <div key={index} className="h-[6.5rem] animate-pulse rounded-xl border bg-card" aria-hidden="true" />;
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tile.surface)}><tile.icon className="size-4" /></span>
              </div>
              <p className="-mt-1 text-2xl font-semibold tabular-nums">{loading && !active ? "—" : tile.value}</p>
              {tile.meter ? <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", indicatorBar(tile.meter.tone))} style={{ width: `${Math.min(100, tile.meter.percent)}%` }} /></div> : null}
              <p className="mt-1 flex items-center justify-between gap-1 text-xs"><span className={cn("truncate", tile.tone === "danger" || tile.tone === "warning" ? cn("font-medium", indicatorText(tile.tone)) : "text-muted-foreground")}>{tile.detail}</span>{tile.href ? <ChevronRight className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}</p>
            </>
          );
          return tile.href
            ? <Link key={tile.label} href={tile.href} className="workflow-card tap-card block p-3.5">{body}</Link>
            : <div key={tile.label} className="rounded-xl border bg-card p-3.5 shadow-xs">{body}</div>;
        })}
      </div>
    </section>
  );
}
