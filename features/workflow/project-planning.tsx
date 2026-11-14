"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, FolderKanban, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, ListToolbar } from "@/components/page-shell";
import { ListEmpty, ListFact, ListGroup, ListRow, NativePage, NativePickerRow, ShowMoreMarker } from "@/components/native";
import { useEntryState } from "@/components/history-nav";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { indicatorBadge, indicatorText, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { PortfolioGantt, PortfolioIssues, PortfolioTable, projectHref, usePortfolio } from "@/features/workflow/project-portfolio";
import { ProjectEffortCells } from "@/features/workflow/project-effort-row";
import { ProjectSchedule } from "@/features/workflow/project-schedule";
import { useNativeMode, useNativeReduced, useShowMoreNote } from "@/features/workflow/use-detail-level";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { effortHours, unbookedText } from "@/lib/workflow/project-effort";
import type { PortfolioRow } from "@/lib/workflow/project-portfolio";
import { shortDay } from "@/lib/workflow/schedule";

/**
 * Planering (plan 1M, 2026-10-11): the project's parts on one page – the project picked at the top (the last choice
 * is remembered per person on this device; Alla projekt is a choice too), its figures (Budget · Offererat · Uppskattat ·
 * Bokat · Rapporterat), its Tidplan, its bookings and its obstacles and delays. For Alla projekt: the plan over the
 * projects and the portfolio table. Since 2026-10-30 this is Planering's view Tidplan; the team's calendar is its other
 * view, Kalender (view=planning), and the tab row above the page leads between them. Read first: every change is made
 * where it already is made (the job, the Tidplan's own dialog, Kalender); this page only brings the parts together. The
 * server decides every read (Projekt – läsa, the jobs and bookings the person may read).
 */
const ALL = "all";
const storageKey = (personId: string) => `hintek:planning-project:${personId || "anon"}`;
const KIND: Record<string, string> = { TASK: "Arbete", MEETING: "Möte", DEADLINE: "Milstolpe", OTHER: "Övrigt" };

type Booking = { id: string; title: string; kind: string; status: string; startsAt: string; endsAt: string; assignedToName: string; projectId: string | null; workflowTask?: { projectId: string | null } | null };
const calendarHref = (projectId?: string) => `/?view=planning${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`;
export const planningHref = (projectId?: string) => `/?view=project_planning${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`;

const statusTone = (row: PortfolioRow): IndicatorTone => row.overdue ? "danger" : row.state === "READY_TO_CLOSE" ? "success" : row.state === "IN_PROGRESS" ? "info" : "neutral";
const frameTone = (row: PortfolioRow): IndicatorTone => row.frame.state === "ON_TRACK" || row.frame.state === "DONE" ? "success" : row.frame.state === "BEHIND" ? "warning" : row.frame.state === "OVERDUE" ? "danger" : "neutral";

/** The person's last choice, kept on this device (the browser may refuse storage; then the choice lasts the visit). */
function useRememberedProject(personId: string) {
  const key = storageKey(personId);
  // Read once when the page opens (it is drawn in the browser only, after the workspace has loaded).
  const [value, setValue] = useState<string>(() => {
    try { return typeof window === "undefined" ? "" : localStorage.getItem(key) ?? ""; } catch { return ""; }
  });
  const remember = (next: string) => {
    setValue(next);
    try { localStorage.setItem(key, next); } catch { /* optional */ }
  };
  return [value, remember] as const;
}

/** The project's coming bookings, read from the same endpoint as the project page; a link leads to the Kalender for the project. */
function useBookings(projectId: string | null) {
  const [state, setState] = useState<{ projectId: string; items: Booking[]; error: string } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api<{ activities: Booking[] }>(`/api/planned-activities?forProject=${encodeURIComponent(projectId)}`, { cache: "no-store" }).then(
      (result) => { if (alive) setState({ projectId, items: result.activities, error: "" }); },
      (cause) => { if (alive) setState({ projectId, items: [], error: cause instanceof Error ? cause.message : "Bokningarna kunde inte läsas." }); },
    );
    return () => { alive = false; };
  }, [projectId]);
  return projectId && state?.projectId === projectId ? state : null;
}

const when = (booking: Booking) => {
  const start = formatSwedish(booking.startsAt, { weekday: "short", day: "numeric", month: "short" });
  const time = (iso: string) => formatSwedish(iso, { hour: "2-digit", minute: "2-digit" });
  return `${start} ${time(booking.startsAt)}–${time(booking.endsAt)}`;
};

function BookingsPanel({ projectId, bookings }: { projectId: string; bookings: ReturnType<typeof useBookings> }) {
  const native = useNativeMode();
  const today = swedishDayKey(new Date());
  const own = (bookings?.items ?? []).filter((booking) => (booking.projectId === projectId || booking.workflowTask?.projectId === projectId) && booking.status !== "CANCELED" && swedishDayKey(booking.endsAt) >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const shown = own.slice(0, 8);
  const subtitle = (booking: Booking) => [KIND[booking.kind] ?? "", booking.assignedToName].filter(Boolean).join(" · ");
  if (native) return <ListGroup title="Bokningar" testId="planning-bookings" footer={own.length > shown.length ? `${own.length - shown.length} till finns i Kalendern.` : undefined}>
    {!bookings ? <ListEmpty>Hämtar bokningarna…</ListEmpty> : shown.length ? shown.map((booking) => <ListRow key={booking.id} type="time" icon={CalendarClock} title={booking.title || "Utan rubrik"} subtitle={`${when(booking)}${subtitle(booking) ? ` · ${subtitle(booking)}` : ""}`} href={calendarHref(projectId)} testId="planning-booking" />) : <ListEmpty>Inga kommande bokningar.</ListEmpty>}
    <ListRow type="time" icon={CalendarClock} title="Visa i Kalendern" href={calendarHref(projectId)} testId="planning-calendar-link" />
  </ListGroup>;
  return <Panel icon={CalendarCheck} title="Bokningar" description="Personalens kommande bokningar på projektet. De ändras i Kalendern." actions={<Button asChild variant="outline" size="sm"><Link href={calendarHref(projectId)} data-testid="planning-calendar-link"><CalendarClock />Visa i Kalendern</Link></Button>}>
    <div data-testid="planning-bookings">
      {bookings?.error ? <p role="alert" className="text-sm text-destructive">{bookings.error}</p> : null}
      {!bookings ? <p role="status" className="text-sm text-muted-foreground">Hämtar bokningarna…</p> : null}
      {bookings && !bookings.error && !shown.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Inga kommande bokningar. Boka personal i Kalendern.</p> : null}
      {shown.length ? <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {shown.map((booking) => <li key={booking.id} data-testid="planning-booking">
          <Link href={calendarHref(projectId)} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3.5 py-2.5 hover:bg-secondary/40">
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{booking.title || "Utan rubrik"}</span><span className="block truncate text-xs text-muted-foreground">{subtitle(booking) || "Ingen ansvarig"}</span></span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when(booking)}</span>
          </Link>
        </li>)}
      </ul> : null}
      {own.length > shown.length ? <p className="mt-2 text-xs text-muted-foreground">{own.length - shown.length} bokningar till i Kalendern.</p> : null}
    </div>
  </Panel>;
}

/** The project's facts in one place: status, whether the frame is followed, completion, dates, customer and responsible. */
function ProjectFacts({ row }: { row: PortfolioRow }) {
  const dates = row.startDate || row.endDate ? `${row.startDate ? shortDay(row.startDate) : "–"} – ${row.endDate ? shortDay(row.endDate) : "–"}` : "Ingen tidsram";
  return <Panel icon={FolderKanban} title="Projektet" description="Uppskattat är jobbens tid, Bokat personalens bokningar och Rapporterat faktisk tid.">
    <div className="space-y-3" data-testid="planning-project">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", indicatorBadge(statusTone(row)))} data-testid="planning-status">{row.overdue ? "Förfallet" : row.statusLabel}</span>
        <span className={cn("text-xs font-medium", indicatorText(frameTone(row)))}>{row.frame.label}</span>
        <span className="text-xs text-muted-foreground">{row.completion} % klart · {row.jobsDone} av {row.jobsTotal} jobb</span>
        <span className="text-xs text-muted-foreground">{dates}</span>
        {row.customer ? <span className="text-xs text-muted-foreground">{row.customer}</span> : null}
        {row.responsible ? <span className="text-xs text-muted-foreground">Ansvarig: {row.responsible}</span> : null}
        {row.obstacles ? <span className={cn("text-xs font-semibold", indicatorText("warning"))}>{row.obstacles} hinder</span> : null}
      </div>
      <ProjectEffortCells effort={row.effort} budgetMinutes={row.budgetMinutes} quotedMinutes={row.quotedMinutes} />
    </div>
  </Panel>;
}

export function ProjectPlanningPage({ personId = "", projectId, expectedProjects = 0, statistics = false }: { personId?: string; projectId?: string;
  /** May open Projektstatistik (N9, 2026-11-01): the portfolio table and the issues over all projects then live only there. */
  statistics?: boolean;
  /** Ongoing projects in the workspace's overview: the size of the plan's grey shape while the portfolio is read. */
  expectedProjects?: number }) {
  const router = useRouter();
  // The app's slimmer page (A2): on a phone Visa mer draws the ordinary one, with the schedule over every project and the hours.
  const native = useNativeReduced();
  const overviewNote = useShowMoreNote("Tidplanen över alla projekt och tabellen med timmar finns i visning 2 (Lagom).");
  const { data: portfolio, error } = usePortfolio();
  const [remembered, remember] = useRememberedProject(personId);
  const [filter, setFilter] = useEntryState<"ongoing" | "closed">("project-planning.portfolio", "ongoing");
  // The address wins (a link from the project page), then the last choice, else Alla projekt.
  const wanted = projectId || remembered || ALL;
  useEffect(() => { if (projectId && remembered !== projectId) remember(projectId); }, [projectId, remembered]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = useMemo(() => (portfolio?.rows ?? []).slice().sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || a.name.localeCompare(b.name, "sv-SE")), [portfolio]);
  const row = wanted === ALL ? null : options.find((item) => item.id === wanted) ?? null;
  // A remembered project that is gone (archived, no longer readable) falls back to Alla projekt.
  const selectedId = row?.id ?? null;
  const loadingProject = wanted !== ALL && !portfolio && !error;
  const bookings = useBookings(selectedId);
  const choose = (next: string) => {
    remember(next);
    router.replace(next === ALL ? planningHref() : planningHref(next));
  };
  const picker = <select id="planning-project-picker" aria-label="Projekt" data-testid="planning-project-picker" className="form-select" value={row ? row.id : ALL} onChange={(event) => choose(event.target.value)} disabled={!portfolio}>
    <option value={ALL}>Alla projekt</option>
    {options.map((item) => <option key={item.id} value={item.id}>{item.name}{item.ongoing ? "" : " (avslutat)"}</option>)}
  </select>;

  if (native) {
    return <NativePage testId="project-planning">
      {error ? <p role="alert" className="notice text-sm text-destructive">{error}</p> : null}
      <ListGroup>
        <NativePickerRow label="Projekt" display={row ? row.name : "Alla projekt"} testId="planning-project-picker-row">
          <select aria-label="Projekt" value={row ? row.id : ALL} onChange={(event) => choose(event.target.value)} disabled={!portfolio} data-testid="planning-project-picker">
            <option value={ALL}>Alla projekt</option>
            {options.map((item) => <option key={item.id} value={item.id}>{item.name}{item.ongoing ? "" : " (avslutat)"}</option>)}
          </select>
        </NativePickerRow>
      </ListGroup>
      {row ? <>
        <ListGroup title="Projektet" testId="planning-project">
          <ListFact label="Status">{row.overdue ? "Förfallet" : row.statusLabel}</ListFact>
          <ListFact label="Tidsram" tone={row.frame.state === "BEHIND" || row.frame.state === "OVERDUE" ? "warning" : undefined}>{`${row.frame.label}${row.endDate ? ` · slut ${shortDay(row.endDate)}` : ""}`}</ListFact>
          <ListFact label="Färdigt">{`${row.completion} % · ${row.jobsDone} av ${row.jobsTotal} jobb`}</ListFact>
          <ListFact label="Timmar">{`Budget ${row.budgetMinutes ? effortHours(row.budgetMinutes) : "–"} · Offererat ${row.quotedMinutes !== null ? effortHours(row.quotedMinutes) : "–"} · Uppskattat ${row.effort.estimatedJobs ? effortHours(row.effort.estimatedMinutes) : "–"} · Bokat ${effortHours(row.effort.bookedMinutes)} · Rapporterat ${effortHours(row.effort.reportedMinutes)}`}</ListFact>
          {unbookedText(row.effort) ? <ListFact label="Obokad tid" tone="warning">{unbookedText(row.effort)}</ListFact> : null}
        </ListGroup>
        <ProjectSchedule key={`schedule-${row.id}`} projectId={row.id} />
        {portfolio ? <PortfolioIssues issues={portfolio.issues} projectId={row.id} title="Hinder och förfallet" showProject={false} /> : null}
        <BookingsPanel projectId={row.id} bookings={bookings} />
        <ListGroup>
          <ListRow type="project" icon={FolderKanban} title="Öppna projektet" href={projectHref(row.id)} testId="planning-project-link" />
        </ListGroup>
      </> : <>
        {loadingProject ? <ListGroup><ListEmpty>Hämtar projektet…</ListEmpty></ListGroup> : <>
          <PortfolioTable portfolio={portfolio} error="" filter={filter} onFilter={setFilter} />
          {portfolio ? <PortfolioIssues issues={portfolio.issues} /> : null}
          <ShowMoreMarker />
          {/* Level 1 has no tab row (Tidplan · Kalender), so Planering's other view is a row here. */}
          <ListGroup footer={overviewNote}><ListRow type="time" icon={CalendarClock} title="Kalender" href={calendarHref()} testId="planning-calendar-link" /></ListGroup>
        </>}
      </>}
    </NativePage>;
  }

  return <div data-testid="project-planning">
    {/* Planering's view Tidplan (2026-10-30): Kalender is the tab beside it, so no button leads there. */}
    <PageHeader title="Planering" description="Projektens tidplaner, hinder och timmar."
      actions={row ? <Button asChild variant="outline"><Link href={projectHref(row.id)} data-testid="planning-project-link"><FolderKanban />Öppna projektet</Link></Button>
        : statistics ? <Button asChild variant="outline"><Link href="/?view=project_summary" data-testid="planning-statistics-link"><BarChart3 />Projektstatistik</Link></Button> : undefined} />
    <div className="space-y-6">
      <ListToolbar label="Välj projekt">
        <div className="max-w-md space-y-1"><label htmlFor="planning-project-picker" className="block text-xs font-medium text-muted-foreground">Projekt</label>{picker}</div>
      </ListToolbar>
      {error ? <p role="alert" className="notice text-sm text-destructive">{error}</p> : null}
      {loadingProject ? <p role="status" className="text-sm text-muted-foreground">Hämtar projektet…</p> : null}
      {!loadingProject && row ? <>
        <ProjectFacts row={row} />
        <ProjectSchedule key={`schedule-${row.id}`} projectId={row.id} />
        {portfolio ? <PortfolioIssues issues={portfolio.issues} projectId={row.id} title="Hinder och förfallet" showProject={false} /> : null}
        <BookingsPanel projectId={row.id} bookings={bookings} />
      </> : null}
      {!loadingProject && !row ? <>
        <PortfolioGantt portfolio={portfolio} error="" expectedRows={expectedProjects} />
        {statistics ? null : <>
          <PortfolioTable portfolio={portfolio} error="" filter={filter} onFilter={setFilter} />
          {portfolio ? <PortfolioIssues issues={portfolio.issues} /> : null}
        </>}
      </> : null}
    </div>
  </div>;
}
