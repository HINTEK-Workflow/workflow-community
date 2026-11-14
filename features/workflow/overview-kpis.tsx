"use client";

import { useState } from "react";
import Link from "next/link";
import { AlarmClock, CalendarClock, CheckCircle2, ChevronRight, CircleAlert, Clock3, FolderKanban, Gauge, ClipboardCheck, type LucideIcon } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import type { PanelArea } from "@/lib/workflow/panel-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { overdueDetail, overviewKpiHref, projectDetail, type OverviewKpis } from "@/lib/workflow/overview-kpis";
import { indicatorBar, indicatorText, type IndicatorTone } from "./indicator-tone";

const hours = (minutes: number) => `${(Math.round((minutes / 60) * 10) / 10).toLocaleString("sv-SE")} h`;

type Tile = { label: string; value: string; detail: string; tone: IndicatorTone; detailTone?: IndicatorTone | null; icon: LucideIcon;
  /** The icon standard (2026-10-24): the tile's function colour (soft, an overview) – unless it shows a status, which keeps its own status colour. */
  area: PanelArea; status?: string; href?: string; meter?: { percent: number; tone: IndicatorTone } };

function tiles(kpis: OverviewKpis, scope: "team" | "mine"): Tile[] {
  const reportedPercent = kpis.weeklyTargetMinutes ? Math.round((kpis.reportedMinutes / kpis.weeklyTargetMinutes) * 100) : 0;
  // Planned time against the one capacity count (2026-11-02); reported time keeps the plain weekly time.
  const plannedPercent = kpis.availableMinutes ? Math.round((kpis.plannedMinutes / kpis.availableMinutes) * 100) : kpis.plannedMinutes ? 100 : 0;
  const free = kpis.availableMinutes - kpis.plannedMinutes;
  return [
    { label: "Öppna uppgifter", value: String(kpis.openTasks), detail: `${kpis.inProgressTasks} pågår`, tone: "info", icon: ClipboardCheck, area: "control", href: overviewKpiHref("openTasks", scope) },
    { label: "Behöver åtgärdas", value: String(kpis.needsActionTasks), detail: kpis.needsActionTasks ? "Kräver uppföljning" : "Inget blockerat", tone: kpis.needsActionTasks ? "danger" : "success", icon: CircleAlert, area: "control", status: kpis.needsActionTasks ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300" : undefined, href: overviewKpiHref("needsActionTasks", scope) },
    { label: "Förfallna", value: String(kpis.overdueTasks), detail: overdueDetail(kpis).text, detailTone: overdueDetail(kpis).tone, tone: kpis.overdueTasks ? "danger" : kpis.dueSoonTasks ? "warning" : "success", icon: AlarmClock, area: "control", status: kpis.overdueTasks || kpis.dueSoonTasks ? "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300" : undefined, href: overviewKpiHref("overdueTasks", scope) },
    { label: "Klara, 30 dagar", value: String(kpis.completedLast30Days), detail: "Uppgifter och kontroller", tone: "success", icon: CheckCircle2, area: "control", status: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300", href: overviewKpiHref("completedLast30Days", scope) },
    { label: "Rapporterad tid", value: hours(kpis.reportedMinutes), detail: `av ${hours(kpis.weeklyTargetMinutes)} veckomål`, tone: reportedPercent >= 100 ? "success" : "info", icon: Clock3, area: "time", href: "/?view=time", meter: { percent: reportedPercent, tone: reportedPercent >= 100 ? "success" : "info" } },
    { label: "Planerad tid", value: hours(kpis.plannedMinutes), detail: free >= 0 ? `${hours(free)} ledig kapacitet` : `${hours(-free)} överbokat`, tone: free < 0 ? "warning" : "info", icon: CalendarClock, area: "calendar", href: "/?view=planning", meter: { percent: plannedPercent, tone: free < 0 ? "warning" : "info" } },
    { label: "Pågående projekt", value: String(kpis.ongoingProjects), detail: projectDetail(kpis).text, detailTone: projectDetail(kpis).tone, tone: kpis.overdueProjects || kpis.overBudgetProjects ? "danger" : "success", icon: FolderKanban, area: "project", href: overviewKpiHref("ongoingProjects", scope) },
    { label: "Beläggning", value: `${plannedPercent}%`, detail: scope === "team" ? `${kpis.people} ${kpis.people === 1 ? "person" : "personer"} i teamet` : "Planerat av din tillgängliga tid", tone: plannedPercent > 100 ? "warning" : plannedPercent >= 70 ? "success" : "info", icon: Gauge, area: "calendar", href: "/?view=planning" },
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
          <p className="text-xs text-muted-foreground">{current === "team" ? "Hela teamet" : "Bara ditt eget: tilldelat eller skapat av dig"} · tid och planering gäller innevarande vecka</p>
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
          // A zero never alarms: a tile may say its line does not warn (detailTone null). The line may take two lines on a
          // narrow tile ("Uppgifter och kontroller" at 390 px; D3, UX punkt 8).
          const warn = tile.detailTone === undefined ? tile.tone : tile.detailTone;
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-xs font-medium text-muted-foreground" title={tile.label} data-card-title="">{tile.label}</p>
                {tile.status ? <span aria-hidden="true" className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tile.status)}><tile.icon className="size-4" /></span> : <AreaIcon area={tile.area} icon={tile.icon} />}
              </div>
              <p className="-mt-1 text-2xl font-semibold tabular-nums">{loading && !active ? "—" : tile.value}</p>
              {tile.meter ? <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", indicatorBar(tile.meter.tone))} style={{ width: `${Math.min(100, tile.meter.percent)}%` }} /></div> : null}
              <p className="mt-1 flex items-center justify-between gap-1 text-xs"><span title={tile.detail} className={cn("line-clamp-2 min-w-0", warn === "danger" || warn === "warning" ? cn("font-medium", indicatorText(warn)) : "text-muted-foreground")}>{tile.detail}</span>{tile.href ? <ChevronRight className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}</p>
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
