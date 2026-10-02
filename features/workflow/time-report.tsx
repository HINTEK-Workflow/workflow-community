"use client";

import { announce } from "@/lib/workflow/toast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, FileSpreadsheet, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Empty, Modal, Panel } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { personInitials, personSolidTone } from "@/features/workflow/person-tone";
import { summarizeReportedWeek } from "@/lib/workflow/time-summary";
import { ADJUST_TIME_ENTRY_KEY } from "@/features/workflow/running-timer";
import { ExportMenu } from "@/features/workflow/export-menu";
import { timeCorrectionRequiresReason, TIME_CORRECTION_REASON_MAX, type TimeEntryEvent } from "@/lib/workflow/time-correction";
import { effectiveWeeklyWorkMinutes, weeklyWorkRemainingMinutes } from "@/lib/workflow/work-schedule";
import { addSwedishDays, formatSwedish, formatSwedishTime, fromSwedishDateTimeInput, startOfSwedishDay, startOfSwedishMonth, swedishDayKey, swedishMonday, swedishParts, toSwedishDateTimeInput } from "@/lib/swedish-time";

export type TimeEntry = { id: string; userId: string; startedAt: string; endedAt: string | null; durationSec: number; note: string; createdAt: string; updatedAt: string; corrected?: boolean };
export type TimeTask = { id: string; title: string; kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "COMMISSIONING_CONTROL"; status: string; projectId: string | null; project?: { name: string } | null; archived?: boolean; timeEntries: TimeEntry[] };
export type TimeEntryInput = { id?: string; taskId: string; userId?: string; startedAt: string; endedAt: string; note: string };
export type TimeSchedule = { organizationWeeklyWorkMinutes: number; memberWeeklyWorkMinutes: number | null; canEditOrganization: boolean; events: { id: string; scope: string; previousMinutes: number | null; nextMinutes: number | null; actorName: string; createdAt: string }[] };
type TimeTeam = { members: { id: string; name: string }[]; entries: (TimeEntry & { taskId: string })[]; from?: string; to?: string };

type LocalTimeAdapter = { tasks: TimeTask[]; schedule?: TimeSchedule; save: (entry: TimeEntryInput, reason: string) => Promise<void>; remove: (id: string, reason: string) => Promise<void>; history: (entryId: string) => TimeEntryEvent[]; saveSchedule: (input: { scope: "ORGANIZATION" | "MEMBER"; minutes: number | null }) => Promise<void> };
type CalendarMode = "day" | "week" | "month";
type ReportRow = TimeEntry & { taskId: string; taskTitle: string; projectName: string };

// All days, weeks, form values and labels are Swedish time (Europe/Stockholm), independent of the browser.
const localInput = (value: Date) => toSwedishDateTimeInput(value);
const dateKey = (value: Date | string) => swedishDayKey(value);
const minutes = (seconds: number) => `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
const hoursLabel = (seconds: number) => seconds ? `${(seconds / 3600).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h` : "–";
const monday = (value: Date) => swedishMonday(value);
const addDays = (value: Date, amount: number) => addSwedishDays(value, amount);
const dayOfMonth = (value: Date) => swedishParts(value).day;
const weekdayShort = (value: Date) => formatSwedish(value, { weekday: "short" });
const longDay = (value: Date) => formatSwedish(value, { weekday: "long", day: "numeric", month: "long" });
const dateTime = (value: string | Date) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
const entryCount = (count: number) => `${count} ${count === 1 ? "tidpost" : "tidposter"}`;
const projectName = (task: TimeTask) => task.project?.name ?? "Fristående";
const taskState = (task: TimeTask | undefined) => task ? { status: task.status, archived: Boolean(task.archived) } : undefined;
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
const csvRow = (entry: ReportRow, person?: string) => { return [...(person === undefined ? [] : [person]), dateKey(entry.startedAt), formatSwedishTime(entry.startedAt), entry.endedAt ? formatSwedishTime(entry.endedAt) : "Pågår", String(Math.round(entry.durationSec / 60)), (Math.round(entry.durationSec / 36) / 100).toFixed(2).replace(".", ","), entry.projectName, entry.taskTitle, entry.note]; };

function MemberInitials({ id, name }: { id: string; name: string }) {
  return <span aria-hidden="true" title={name} className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white", personSolidTone(id))}>{personInitials(name)}</span>;
}

export function TimeReport({ local, focusTaskId }: { local?: LocalTimeAdapter; focusTaskId?: string }) {
  const [cloudTasks, setCloudTasks] = useState<TimeTask[]>([]);
  const [cloudSchedule, setCloudSchedule] = useState<TimeSchedule | null>(null);
  const [team, setTeam] = useState<TimeTeam | null>(null);
  // Cloud sends the team's entries for a date range only; the team filter's Från/Till choose the range.
  const [teamRange, setTeamRange] = useState({ from: "", to: "" });
  const [currentUserId, setCurrentUserId] = useState("");
  const [mode, setMode] = useState<CalendarMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editing, setEditing] = useState<ReportRow | null>(null);
  const [deleting, setDeleting] = useState<ReportRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reportScope, setReportScope] = useState<"all" | "visible">("all");
  const [reportProject, setReportProject] = useState("");
  const [reportTask, setReportTask] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportLimit, setReportLimit] = useState(50);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [newEntryKey, setNewEntryKey] = useState(0);
  const appliedFocusTaskId = useRef<string | null>(null);
  const tasks = local?.tasks ?? cloudTasks;
  const schedule = local?.schedule ?? cloudSchedule;
  // The Local file owner is the local administrator; in Cloud only organization admins receive the team payload.
  const isAdmin = Boolean(local) || Boolean(team);
  const load = useCallback(async () => {
    if (local) return;
    try {
      const response = await api<{ currentUserId: string; tasks: TimeTask[]; team: TimeTeam | null; schedule: TimeSchedule }>(`/api/workflow-time?${new URLSearchParams({ teamFrom: teamRange.from, teamTo: teamRange.to })}`);
      setCloudTasks(response.tasks); setCloudSchedule(response.schedule); setTeam(response.team); setCurrentUserId(response.currentUserId); setError("");
    } catch (issue) { setError((issue as Error).message); }
  }, [local, teamRange]);
  useEffect(() => { void load(); }, [load]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const focusedTask = focusTaskId ? taskById.get(focusTaskId) : undefined;
  useEffect(() => {
    if (!focusedTask || appliedFocusTaskId.current === focusedTask.id) return;
    setReportScope("all");
    setReportProject("");
    setReportTask(focusedTask.id);
    appliedFocusTaskId.current = focusedTask.id;
  }, [focusedTask]);
  const entries = useMemo<ReportRow[]>(() => tasks.flatMap((task) => task.timeEntries.map((entry) => ({ ...entry, taskId: task.id, taskTitle: task.title, projectName: projectName(task) }))).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [tasks]);
  // "Justera tiden" after a long timer (2026-09-26) opens that entry for editing once it has loaded.
  useEffect(() => {
    let entryId: string | null = null;
    try { entryId = window.sessionStorage.getItem(ADJUST_TIME_ENTRY_KEY); } catch { return; }
    const entry = entryId ? entries.find((item) => item.id === entryId) : undefined;
    if (!entry) return;
    try { window.sessionStorage.removeItem(ADJUST_TIME_ENTRY_KEY); } catch { /* ignore */ }
    setError(""); setEditing(entry); setOpen(true);
  }, [entries]);
  const reportProjects = useMemo(() => [...new Set(tasks.map(projectName))].sort(), [tasks]);
  const reportTasks = useMemo(() => tasks.filter((task) => !reportProject || projectName(task) === reportProject), [reportProject, tasks]);
  const days = useMemo(() => {
    if (mode === "day") return [startOfSwedishDay(anchor)];
    if (mode === "week") { const first = monday(anchor); return Array.from({ length: 7 }, (_, index) => addDays(first, index)); }
    const first = monday(startOfSwedishMonth(anchor));
    return Array.from({ length: 42 }, (_, index) => addDays(first, index));
  }, [anchor, mode]);
  const visibleEntries = useMemo(() => { const keys = new Set(days.map(dateKey)); return entries.filter((entry) => keys.has(dateKey(new Date(entry.startedAt)))); }, [days, entries]);
  const selectedDayKey = selectedDay ? dateKey(selectedDay) : null;
  const reportEntries = useMemo(() => entries.filter((entry) => {
    if (selectedDayKey && dateKey(new Date(entry.startedAt)) !== selectedDayKey) return false;
    if (reportScope === "visible" && !visibleEntries.some((visible) => visible.id === entry.id)) return false;
    if (reportProject && entry.projectName !== reportProject) return false;
    if (reportTask && entry.taskId !== reportTask) return false;
    const needle = reportSearch.trim().toLocaleLowerCase("sv-SE");
    return !needle || [entry.taskTitle, entry.projectName, entry.note].some((value) => value.toLocaleLowerCase("sv-SE").includes(needle));
  }), [entries, reportProject, reportScope, reportSearch, reportTask, selectedDayKey, visibleEntries]);
  const reportSeconds = reportEntries.reduce((sum, entry) => sum + entry.durationSec, 0);
  const total = visibleEntries.reduce((sum, entry) => sum + entry.durationSec, 0);
  const reportedWeek = useMemo(() => summarizeReportedWeek(entries, anchor), [anchor, entries]);
  const reportedWeekMinutes = Math.round(reportedWeek.totalSeconds / 60);
  const weekLabel = dateKey(monday(anchor)) === dateKey(monday(new Date())) ? "denna vecka" : `vecka ${formatSwedish(reportedWeek.days[0].date, { day: "numeric", month: "short" })}–${formatSwedish(reportedWeek.days[6].date, { day: "numeric", month: "short" })}`;
  const weeklyTarget = schedule ? effectiveWeeklyWorkMinutes(schedule.organizationWeeklyWorkMinutes, schedule.memberWeeklyWorkMinutes) : null;
  const weeklyRemaining = schedule ? weeklyWorkRemainingMinutes(reportedWeekMinutes, schedule.organizationWeeklyWorkMinutes, schedule.memberWeeklyWorkMinutes) : null;
  const weeklyPercent = weeklyTarget ? Math.min(100, Math.round((reportedWeekMinutes / weeklyTarget) * 100)) : 0;
  const dailyTargetSeconds = weeklyTarget ? (weeklyTarget * 60) / 5 : 0;
  const ownsEntry = (entry: TimeEntry) => Boolean(local) || entry.userId === currentUserId;
  // Mirrors the server rule so blocked actions are explained instead of failing after a click.
  const lockedReason = (entry: ReportRow) => {
    const task = taskById.get(entry.taskId);
    if (task?.archived) return "Projektet är arkiverat. Återställ det för att ändra tiden.";
    if (task?.status === "COMPLETED" && !isAdmin) return "Uppgiften är slutförd. Be en administratör korrigera tiden.";
    return "";
  };

  async function save(input: TimeEntryInput, reason: string) {
    setBusy(true); setError("");
    try {
      if (local) await local.save(input, reason);
      else { const saved = await api<{ warning?: string }>("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "save", entry: input, reason }) }); if (saved.warning) announce(saved.warning); }
      await load(); setOpen(false); setEditing(null);
      if (!input.id) setNewEntryKey((value) => value + 1);
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(id: string, reason: string) {
    setBusy(true); setError("");
    try { if (local) await local.remove(id, reason); else await api("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "delete", id, reason }) }); await load(); setDeleting(null); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  async function saveSchedule(input: { scope: "ORGANIZATION" | "MEMBER"; minutes: number | null }) {
    setBusy(true); setError("");
    try {
      if (local) await local.saveSchedule(input);
      else await api("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "schedule_save", ...input }) });
      await load(); setScheduleOpen(false);
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  const loadHistory = useCallback(async (entryId: string) => local ? local.history(entryId) : (await api<{ events: TimeEntryEvent[] }>(`/api/workflow-time?history=${encodeURIComponent(entryId)}`)).events, [local]);
  function move(amount: number) { setAnchor((current) => mode === "month" ? startOfSwedishMonth(current, amount) : addDays(current, amount * (mode === "week" ? 7 : 1))); }
  function toggleDay(day: Date) { setSelectedDay((current) => current && dateKey(current) === dateKey(day) ? null : day); }
  const openEditor = (entry: ReportRow) => { setError(""); setEditing(entry); setOpen(true); };
  const openDelete = (entry: ReportRow) => { setError(""); setDeleting(entry); };
  const title = mode === "day" ? longDay(anchor) : mode === "week" ? `${formatSwedish(days[0], { day: "numeric", month: "short" })}–${formatSwedish(days[6], { day: "numeric", month: "short", year: "numeric" })}` : formatSwedish(anchor, { month: "long", year: "numeric" });
  const rowActions = (entry: ReportRow) => { const locked = lockedReason(entry); return <>
    <Button size="icon" variant="ghost" aria-label="Redigera tidpost" title={locked || undefined} disabled={Boolean(locked)} onClick={() => openEditor(entry)}><Pencil /></Button>
    <Button size="icon" variant="ghost" aria-label="Ta bort tidpost" title={locked || undefined} disabled={busy || Boolean(locked)} onClick={() => openDelete(entry)}><Trash2 /></Button>
  </>; };
  const editingOwner = editing ? team?.members.find((member) => member.id === editing.userId)?.name : undefined;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-title">Tidrapport</h1><p className="page-description mt-2">Registrera, flytta och följ din rapporterade tid per uppgift och projekt.</p></div><ExportMenu title="Exportera tidrapport" description={`Dina ${visibleEntries.length} visade poster ${dateKey(days[0])} – ${dateKey(days.at(-1)!)}. Filen öppnas i Excel.`} disabled={!visibleEntries.length}
      formats={[{ id: "csv", label: "CSV", icon: FileSpreadsheet, primary: true, run: () => downloadCsv(`tidrapport-${dateKey(days[0])}-${dateKey(days.at(-1)!)}.csv`, [["Datum", "Start", "Slut", "Tid (min)", "Timmar", "Projekt", "Uppgift", "Anteckning"], ...visibleEntries.map((entry) => csvRow(entry))]) }]} /></div>
    <div className="notice flex items-start gap-3"><Clock3 className="mt-0.5 size-4 shrink-0 text-primary" /><p>Tid registreras på en uppgift. När du flyttar posten till en annan uppgift följer tiden automatiskt den uppgiftens projekt. Ändringar sparas i tidpostens historik.</p></div>
    {focusedTask && reportTask === focusedTask.id ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm" role="status"><p><span className="font-medium">Tidrapport för:</span> {focusedTask.title}</p><Button type="button" size="sm" variant="outline" onClick={() => setReportTask("")}>Visa alla uppgifter</Button></div> : null}

    <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <Panel title="Ny tidrapport" description="Fyll i dagens arbete." leadingActions={<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"><Clock3 className="size-5" /></span>}>
        <TimeEntryForm key={`new-${newEntryKey}-${currentUserId}-${focusedTask?.id ?? ""}`} tasks={tasks} entry={null} preferredTaskId={focusedTask?.id} members={team ? team.members : undefined} currentUserId={currentUserId} isAdmin={isAdmin} ownsEntry={(userId) => Boolean(local) || userId === currentUserId} busy={busy} error={!open && !deleting && !scheduleOpen ? error : ""} onSave={save} />
      </Panel>
      <Panel title="Min vecka" description={`Din rapporterade tid ${weekLabel}.`} actions={<div className="flex items-center gap-1.5"><Button size="icon" variant="outline" aria-label="Föregående vecka" onClick={() => setAnchor((current) => addDays(current, -7))}><ChevronLeft /></Button><Button size="icon" variant="outline" aria-label="Nästa vecka" onClick={() => setAnchor((current) => addDays(current, 7))}><ChevronRight /></Button></div>}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-3xl font-semibold tabular-nums">{(reportedWeekMinutes / 60).toLocaleString("sv-SE", { maximumFractionDigits: 1 })}<span className="ml-1 text-base font-normal text-muted-foreground">/ {weeklyTarget !== null ? (weeklyTarget / 60).toLocaleString("sv-SE", { maximumFractionDigits: 1 }) : "–"} h</span></p>
          {weeklyTarget !== null ? (weeklyRemaining ?? 0) > 0
            ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">{hoursLabel((weeklyRemaining ?? 0) * 60)} kvar</span>
            : <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Veckomålet nått</span> : null}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${weeklyPercent}%` }} /></div>
        <div className="mt-4 grid grid-cols-5 gap-1">
          {reportedWeek.days.slice(0, 5).map(({ date: day, seconds }) => { const selected = selectedDayKey === dateKey(day); const scale = Math.max(reportedWeek.weekdayPeakSeconds, dailyTargetSeconds); const pct = scale ? Math.round((seconds / scale) * 100) : 0; return <button key={dateKey(day)} type="button" aria-pressed={selected} aria-label={`Visa ${longDay(day)}`} onClick={() => toggleDay(day)} className={cn("flex flex-col items-center gap-1.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected && "bg-secondary")}>
            <span className="text-[11px] font-medium capitalize text-muted-foreground">{weekdayShort(day)}</span>
            {/* Green once the day reaches its share of the weekly target, blue while below it. */}
            <span className="flex h-16 w-full max-w-10 items-end overflow-hidden rounded-lg bg-muted"><span className={cn("w-full rounded-lg", dailyTargetSeconds && seconds >= dailyTargetSeconds ? "bg-emerald-500" : "bg-primary")} style={{ height: `${seconds ? Math.max(pct, 10) : 0}%` }} /></span>
            <span className="text-[11px] font-semibold tabular-nums">{hoursLabel(seconds)}</span>
          </button>; })}
        </div>
        {/* Weekend time counts toward the week total and appears only when reported, keeping the weekday layout compact. */}
        {reportedWeek.days.slice(5).some((day) => day.seconds > 0) ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" data-testid="weekend-time"><span className="text-muted-foreground">Helg:</span>{reportedWeek.days.slice(5).map(({ date: day, seconds }) => <button key={dateKey(day)} type="button" aria-pressed={selectedDayKey === dateKey(day)} aria-label={`Visa ${longDay(day)}`} onClick={() => toggleDay(day)} className={cn("rounded-lg border px-2.5 py-1 capitalize hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selectedDayKey === dateKey(day) ? "border-primary/50 bg-secondary" : "bg-card")}>{weekdayShort(day)} {dayOfMonth(day)} · <span className="font-semibold normal-case">{hoursLabel(seconds)}</span></button>)}</div> : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          {weeklyTarget === null ? <span>Ordinarie veckoarbetstid läses in.</span> : <span>Veckomål: {minutes(weeklyTarget * 60)}{schedule?.memberWeeklyWorkMinutes !== null ? " · personligt undantag" : " · organisationsstandard"}</span>}
          <Button type="button" size="sm" variant="ghost" className="h-auto p-0 font-medium text-primary hover:bg-transparent hover:underline" disabled={!schedule} onClick={() => setScheduleOpen(true)}><Clock3 />Arbetstid</Button>
        </div>
      </Panel>
    </div>

    {selectedDay ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm" role="status"><p><span className="font-medium">Visar:</span> <span className="capitalize">{longDay(selectedDay)}</span></p><Button type="button" size="sm" variant="outline" onClick={() => setSelectedDay(null)}>Visa alla dagar</Button></div> : null}

    <Panel title="Kalenderöversikt" description="Bläddra bland dagar, veckor och månader för att se var tid är rapporterad." collapsible defaultCollapsed>
      {/* Rendered in the content block, not the header's actions slot, so it wraps freely on narrow viewports instead of forcing the header row wider than the card. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" aria-label="Föregående period" onClick={() => move(-1)}><ChevronLeft /></Button>
          <Button variant="outline" onClick={() => setAnchor(new Date())}>Idag</Button>
          <Button size="icon" variant="outline" aria-label="Nästa period" onClick={() => move(1)}><ChevronRight /></Button>
        </div>
        <div className="flex w-full rounded-lg border bg-muted/40 p-1 sm:w-auto">{(["day", "week", "month"] as const).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium sm:flex-none ${mode === item ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"}`}>{item === "day" ? "Dag" : item === "week" ? "Vecka" : "Månad"}</button>)}</div>
      </div>
      <p className="mb-3 text-center text-sm font-semibold capitalize">{title}<span className="ml-2 text-xs font-normal text-muted-foreground">{minutes(total)} rapporterat</span></p>
      <div className={`-mx-5 -mb-5 grid border-t ${mode === "day" ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7"}`}>
        {days.map((day) => { const dayEntries = entries.filter((entry) => dateKey(new Date(entry.startedAt)) === dateKey(day)); const outside = mode === "month" && swedishParts(day).month !== swedishParts(anchor).month; return <div key={day.toISOString()} className={`min-h-28 border-b border-r p-2 ${outside ? "bg-muted/25 text-muted-foreground" : ""}`}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium capitalize">{weekdayShort(day)}</span><span className={dateKey(day) === dateKey(new Date()) ? "flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground" : ""}>{dayOfMonth(day)}</span></div><div className="space-y-1.5">{dayEntries.map((entry) => <button key={entry.id} type="button" disabled={Boolean(lockedReason(entry))} title={lockedReason(entry) || undefined} onClick={() => openEditor(entry)} className="w-full rounded-md border border-primary/15 bg-secondary px-2 py-1.5 text-left text-[11px] leading-4 text-secondary-foreground hover:border-primary/40 disabled:cursor-default disabled:hover:border-primary/15"><span className="block truncate font-semibold">{entry.taskTitle}</span><span>{minutes(entry.durationSec)}</span></button>)}</div></div>; })}
      </div>
    </Panel>

    {entries.length || focusedTask ? <Panel title="Rapporterad tid" description="Filtrera, redigera eller flytta rapporterad tid mellan dina uppgifter.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-muted-foreground">Sök<Input aria-label="Sök i rapporterad tid" className="mt-1" type="search" value={reportSearch} onChange={(event) => { setReportSearch(event.target.value); setReportLimit(50); }} placeholder="Uppgift, projekt eller anteckning" /></label>
        <label className="text-xs font-medium text-muted-foreground">Tidsperiod<select aria-label="Tidsperiod" className="form-select mt-1" value={reportScope} onChange={(event) => setReportScope(event.target.value as "all" | "visible")}><option value="all">Alla datum</option><option value="visible">Visad kalenderperiod</option></select></label>
        <label className="text-xs font-medium text-muted-foreground">Projekt<select aria-label="Projekt" className="form-select mt-1" value={reportProject} onChange={(event) => { setReportProject(event.target.value); setReportTask(""); }}><option value="">Alla projekt</option>{reportProjects.map((project) => <option key={project} value={project}>{project}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">Uppgift<select aria-label="Uppgift" className="form-select mt-1" value={reportTask} onChange={(event) => setReportTask(event.target.value)}><option value="">Alla uppgifter</option>{reportTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      </div>
      <p className="mt-4 text-xs text-muted-foreground" role="status">{entryCount(reportEntries.length)} · totalt <span className="font-medium text-foreground">{minutes(reportSeconds)}</span></p>
      {reportEntries.length ? <div className="-mx-5 mt-2 max-h-[32rem] divide-y overflow-y-auto border-t">{reportEntries.slice(0, reportLimit).map((entry) => <div key={entry.id} data-testid="own-time-entry" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 transition-colors hover:bg-secondary/40"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{entry.taskTitle}{entry.corrected ? <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">Korrigerad av administratör</span> : null}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.projectName}{entry.note ? ` · ${entry.note}` : ""}</p>{lockedReason(entry) ? <p className="mt-1 text-xs text-muted-foreground">{lockedReason(entry)}</p> : null}</div><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden="true" />{dateTime(entry.startedAt)}</span><span className="min-w-20 text-right text-sm font-semibold tabular-nums">{minutes(entry.durationSec)}</span><div className="flex">{rowActions(entry)}</div></div>)}</div> : <p className="mt-2 border-t pt-4 text-sm text-muted-foreground">Inga tidposter matchar dina filter.</p>}
      {reportEntries.length > reportLimit ? <div className="mt-3 border-t pt-3"><Button variant="outline" size="sm" onClick={() => setReportLimit((value) => value + 50)}>Visa fler tidposter</Button></div> : null}
    </Panel> : <Empty title="Ingen rapporterad tid" description="Starta tidtagningen i en arbetsorder eller riskbedömning, eller registrera tiden manuellt här – även på kontroller före idrifttagning." />}

    {team ? <TeamTime team={team} tasks={tasks} taskById={taskById} busy={busy} onEdit={openEditor} onDelete={openDelete} lockedReason={lockedReason} onRange={(from, to) => setTeamRange((current) => current.from === from && current.to === to ? current : { from, to })} /> : null}

    <Modal open={open} onOpenChange={(value) => { setOpen(value); if (!value) setEditing(null); }} title="Redigera tid">
      {editing ? <TimeEntryForm key={editing.id} tasks={tasks} entry={editing} ownerName={!ownsEntry(editing) ? editingOwner ?? "annan medarbetare" : undefined} currentUserId={currentUserId} isAdmin={isAdmin} ownsEntry={(userId) => Boolean(local) || userId === currentUserId} busy={busy} error={error} onSave={save} loadHistory={loadHistory} /> : null}
    </Modal>
    <Modal open={Boolean(deleting)} onOpenChange={(value) => { if (!value) setDeleting(null); }} title="Ta bort tidpost">
      {deleting ? <DeleteTimeEntry entry={deleting} reasonRequired={timeCorrectionRequiresReason({ actorIsAdmin: isAdmin, actorOwnsEntry: ownsEntry(deleting), source: taskState(taskById.get(deleting.taskId)) })} busy={busy} error={error} onCancel={() => setDeleting(null)} onConfirm={(reason) => remove(deleting.id, reason)} /> : null}
    </Modal>
    <Modal open={scheduleOpen} onOpenChange={setScheduleOpen} title="Ordinarie veckoarbetstid">{schedule && <WorkScheduleForm schedule={schedule} busy={busy} error={error} onSave={saveSchedule} />}</Modal>
  </div>;
}

function TeamTime({ team, tasks, taskById, busy, onEdit, onDelete, lockedReason, onRange }: { team: TimeTeam; tasks: TimeTask[]; taskById: Map<string, TimeTask>; busy: boolean; onEdit: (entry: ReportRow) => void; onDelete: (entry: ReportRow) => void; lockedReason: (entry: ReportRow) => string; onRange?: (from: string, to: string) => void }) {
  const [person, setPerson] = useState("");
  const [project, setProject] = useState("");
  const [task, setTask] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(50);
  // Ask the server for the chosen period once the dates settle; without Från it sends the last 90 days.
  useEffect(() => { if (!onRange) return; const timer = setTimeout(() => onRange(from, to), 300); return () => clearTimeout(timer); }, [from, to, onRange]);
  const names = useMemo(() => new Map(team.members.map((member) => [member.id, member.name])), [team.members]);
  const rows = useMemo(() => team.entries.flatMap((entry): ReportRow[] => { const owner = taskById.get(entry.taskId); return owner ? [{ ...entry, taskTitle: owner.title, projectName: projectName(owner) }] : []; }).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [taskById, team.entries]);
  const projects = useMemo(() => [...new Set(tasks.map(projectName))].sort(), [tasks]);
  const filtered = useMemo(() => rows.filter((entry) => {
    const day = dateKey(new Date(entry.startedAt));
    return (!person || entry.userId === person) && (!project || entry.projectName === project) && (!task || entry.taskId === task) && (!from || day >= from) && (!to || day <= to);
  }), [from, person, project, rows, task, to]);
  const totalSeconds = filtered.reduce((sum, entry) => sum + entry.durationSec, 0);
  const personName = (userId: string) => names.get(userId) ?? "Tidigare medlem";
  return <Panel title="Teamets rapporterade tid" description="Alla medarbetares tid i organisationen. Som administratör kan du korrigera poster; ändringar av andras tid kräver en kommentar och sparas i historiken." leadingActions={<Users className="size-4 text-primary" aria-hidden="true" />} actions={<ExportMenu title="Exportera teamets tid" description={`${filtered.length} poster med dagens filter. Filen öppnas i Excel.`} disabled={!filtered.length} testId="team-export-menu"
    formats={[{ id: "csv", label: "CSV", icon: FileSpreadsheet, primary: true, run: () => downloadCsv("teamets-tidrapport.csv", [["Medarbetare", "Datum", "Start", "Slut", "Tid (min)", "Timmar", "Projekt", "Uppgift", "Anteckning"], ...filtered.map((entry) => csvRow(entry, personName(entry.userId)))]) }]} />}>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {/* Distinct accessible names: the personal list on the same page has its own Projekt/Uppgift filters. */}
      <label className="text-xs font-medium text-muted-foreground">Medarbetare<select aria-label="Teamets medarbetare" className="form-select mt-1" value={person} onChange={(event) => setPerson(event.target.value)}><option value="">Alla medarbetare</option>{team.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Projekt<select aria-label="Teamets projekt" className="form-select mt-1" value={project} onChange={(event) => { setProject(event.target.value); setTask(""); }}><option value="">Alla projekt</option>{projects.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Uppgift<select aria-label="Teamets uppgift" className="form-select mt-1" value={task} onChange={(event) => setTask(event.target.value)}><option value="">Alla uppgifter</option>{tasks.filter((item) => !project || projectName(item) === project).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Från<Input aria-label="Teamets tid från" className="mt-1" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="text-xs font-medium text-muted-foreground">Till<Input aria-label="Teamets tid till" className="mt-1" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    <p className="mt-4 text-xs text-muted-foreground" role="status">{entryCount(filtered.length)} · totalt <span className="font-medium text-foreground">{minutes(totalSeconds)}</span>{team.from && !from ? ` · visar tid från ${team.from}; välj ett tidigare Från-datum för äldre tid` : ""}</p>
    {filtered.length ? <div className="-mx-5 mt-2 max-h-[32rem] divide-y overflow-y-auto border-t">{filtered.slice(0, limit).map((entry) => <div key={entry.id} data-testid="team-time-entry" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 transition-colors hover:bg-secondary/40">
      <MemberInitials id={entry.userId} name={personName(entry.userId)} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{entry.taskTitle}{entry.corrected ? <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">Korrigerad</span> : null}</p><p className="mt-0.5 truncate text-xs text-muted-foreground"><span className="font-medium text-foreground">{personName(entry.userId)}</span> · {entry.projectName}</p></div>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden="true" />{dateTime(entry.startedAt)}</span>
      <span className="min-w-20 text-right text-sm font-semibold tabular-nums">{minutes(entry.durationSec)}</span>
      <Button size="icon" variant="ghost" aria-label={`Redigera tidpost för ${personName(entry.userId)}`} title={lockedReason(entry) || undefined} disabled={Boolean(lockedReason(entry))} onClick={() => onEdit(entry)}><Pencil /></Button>
      <Button size="icon" variant="ghost" aria-label={`Ta bort tidpost för ${personName(entry.userId)}`} title={lockedReason(entry) || undefined} disabled={busy || Boolean(lockedReason(entry))} onClick={() => onDelete(entry)}><Trash2 /></Button>
    </div>)}</div> : <p className="mt-2 border-t pt-4 text-sm text-muted-foreground">Inga tidposter matchar filtren.</p>}
    {filtered.length > limit ? <div className="mt-3 border-t pt-3"><Button variant="outline" size="sm" onClick={() => setLimit((value) => value + 50)}>Visa fler tidposter</Button></div> : null}
  </Panel>;
}

function ReasonField({ required, value, onChange }: { required: boolean; value: string; onChange: (value: string) => void }) {
  return <label className="field-label block space-y-2 text-xs font-medium">Kommentar till korrigering{required ? " (krävs)" : " (valfri)"}
    <textarea className="form-textarea min-h-20" value={value} onChange={(event) => onChange(event.target.value)} maxLength={TIME_CORRECTION_REASON_MAX} required={required} placeholder="Till exempel: flyttad från fel arbetsorder" />
    {required ? <span className="block font-normal text-muted-foreground">Krävs när du ändrar en annan medarbetares tid eller tid på en slutförd uppgift. Kommentaren sparas i historiken.</span> : null}
  </label>;
}

function DeleteTimeEntry({ entry, reasonRequired, busy, error, onCancel, onConfirm }: { entry: ReportRow; reasonRequired: boolean; busy: boolean; error: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onConfirm(reason); }}>
    <p className="text-sm">Vill du ta bort <span className="font-semibold">{minutes(entry.durationSec)}</span> på <span className="font-semibold">{entry.taskTitle}</span> ({dateTime(entry.startedAt)})? Borttagningen sparas i historiken.</p>
    <ReasonField required={reasonRequired} value={reason} onChange={setReason} />
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Avbryt</Button><Button type="submit" variant="destructive" disabled={busy || (reasonRequired && !reason.trim())}>Ta bort tidpost</Button></div>
  </form>;
}

const actionLabel = { CREATED: "Registrerad", UPDATED: "Ändrad", DELETED: "Borttagen" };
function TimeEntryHistory({ entryId, loadHistory }: { entryId: string; loadHistory: (entryId: string) => Promise<TimeEntryEvent[]> | TimeEntryEvent[] }) {
  const [events, setEvents] = useState<TimeEntryEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; void Promise.resolve(loadHistory(entryId)).then((items) => { if (active) setEvents(items); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [entryId, loadHistory]);
  const describe = (snapshot: TimeEntryEvent["next"]) => snapshot ? `${snapshot.taskTitle} · ${dateTime(snapshot.startedAt)} · ${minutes(snapshot.durationSec)}` : "";
  return <details className="rounded-xl border bg-muted/20 p-3" data-testid="time-entry-history"><summary className="cursor-pointer text-sm font-semibold">Historik</summary>
    {failed ? <p className="mt-2 text-xs text-destructive">Historiken kunde inte läsas in.</p> : !events ? <p className="mt-2 text-xs text-muted-foreground">Läser in…</p> : events.length ? <ol className="mt-3 space-y-2">{events.map((event) => <li key={event.id} className="border-l-2 border-primary/30 pl-3 text-xs">
      <p className="font-medium text-foreground">{actionLabel[event.action]}{event.action === "UPDATED" ? `: ${describe(event.previous)} → ${describe(event.next)}` : `: ${describe(event.next ?? event.previous)}`}</p>
      {event.reason ? <p className="mt-1">Kommentar: {event.reason}</p> : null}
      <p className="mt-1 text-muted-foreground">{event.actorName || "Okänd aktör"} · {dateTime(event.createdAt)}</p>
    </li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">Ingen historik finns för posten. Äldre poster och tidtagning via start/paus får historik vid första ändringen.</p>}
  </details>;
}

// The form starts on the task the person last wrote time on, not on the first task of the whole company (2026-10-02).
function mostRecentOwn(tasks: TimeTask[]) {
  const latest = (task: TimeTask) => task.timeEntries.reduce((max, entry) => Math.max(max, new Date(entry.startedAt).getTime()), 0);
  return tasks.filter((task) => task.timeEntries.length).sort((left, right) => latest(right) - latest(left))[0] ?? tasks[0];
}
function TimeEntryForm({ tasks, entry, preferredTaskId, ownerName, members, currentUserId, isAdmin, ownsEntry, busy, error, onSave, loadHistory }: { tasks: TimeTask[]; entry: ReportRow | null; /** The task a link came from ("Se tiden"), chosen when time can be written on it. */ preferredTaskId?: string; ownerName?: string; members?: { id: string; name: string }[]; currentUserId: string; isAdmin: boolean; ownsEntry: (userId: string) => boolean; busy: boolean; error: string; onSave: (input: TimeEntryInput, reason: string) => Promise<void>; loadHistory?: (entryId: string) => Promise<TimeEntryEvent[]> | TimeEntryEvent[] }) {
  const now = new Date(); const before = new Date(now.getTime() - 60 * 60 * 1000);
  const selectable = (task: TimeTask) => !task.archived && (isAdmin || task.status !== "COMPLETED");
  const preferred = preferredTaskId ? tasks.find((task) => task.id === preferredTaskId && selectable(task)) : undefined;
  const [taskId, setTaskId] = useState(entry?.taskId ?? preferred?.id ?? mostRecentOwn(tasks.filter(selectable))?.id ?? "");
  const [userId, setUserId] = useState(entry?.userId ?? currentUserId);
  const [startedAt, setStartedAt] = useState(localInput(entry ? new Date(entry.startedAt) : before));
  const [endedAt, setEndedAt] = useState(localInput(entry?.endedAt ? new Date(entry.endedAt) : now));
  const [note, setNote] = useState(entry?.note ?? "");
  const [reason, setReason] = useState("");
  const projects = [...new Set(tasks.map(projectName))];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const reasonRequired = timeCorrectionRequiresReason({ actorIsAdmin: isAdmin, actorOwnsEntry: ownsEntry(entry?.userId ?? userId), source: entry ? taskState(byId.get(entry.taskId)) : undefined, target: taskState(byId.get(taskId)) });
  const startInstant = fromSwedishDateTimeInput(startedAt); const endInstant = fromSwedishDateTimeInput(endedAt);
  const currentHours = startInstant && endInstant ? (endInstant.getTime() - startInstant.getTime()) / 3_600_000 : null;
  const setQuickDuration = (hours: number) => {
    const start = fromSwedishDateTimeInput(startedAt);
    if (!start) return;
    setEndedAt(localInput(new Date(start.getTime() + hours * 60 * 60 * 1_000)));
  };
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault();
    // The inputs show Swedish time, so they are read back as Swedish time whatever the browser's zone.
    const start = fromSwedishDateTimeInput(startedAt); const end = fromSwedishDateTimeInput(endedAt);
    if (!start || !end) return;
    if (entry && !entry.endedAt) announce("Tidtagningen är stoppad av ändringen.");
    void onSave({ id: entry?.id, taskId, ...(members && userId !== currentUserId ? { userId } : {}), startedAt: start.toISOString(), endedAt: end.toISOString(), note }, reason);
  }}>
    {entry && !entry.endedAt ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="time-running-notice">Tidtagningen pågår. Sparar du med en sluttid stoppas klockan; vill du bara byta uppgift eller anteckning, stäng rutan och använd Pausa eller Starta på uppgiften.</p> : null}
    {ownerName ? <p className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm">Du korrigerar tid som tillhör <span className="font-semibold">{ownerName}</span>.</p> : null}
    {members && members.length > 1 ? <label className="field-label block space-y-2 text-xs font-medium">Medarbetare
      <select className="form-select" value={userId} onChange={(event) => setUserId(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.id === currentUserId ? " (du)" : ""}</option>)}</select>
    </label> : null}
    <label className="field-label block space-y-2 text-xs font-medium">Projekt och uppgift
      <select className="form-select" value={taskId} onChange={(event) => setTaskId(event.target.value)} required>
        {projects.map((project) => <optgroup key={project} label={project}>{tasks.filter((task) => projectName(task) === project).map((task) => <option key={task.id} value={task.id} disabled={!selectable(task) && task.id !== entry?.taskId}>{task.kind === "COMMISSIONING_CONTROL" ? "Kontroll: " : ""}{task.title}{task.status === "COMPLETED" ? " (slutförd)" : ""}{task.archived ? " (arkiverat projekt)" : ""}</option>)}</optgroup>)}
      </select>
    </label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="field-label block space-y-2 text-xs font-medium">Start<Input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} required /></label>
      <label className="field-label block space-y-2 text-xs font-medium">Slut<Input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} required /></label>
    </div>
    <fieldset><legend className="field-label text-xs font-medium">Snabbval timmar</legend><div className="mt-2 flex flex-wrap gap-2">{[4, 6, 7.5, 8].map((hours) => { const active = currentHours === hours; return <Button key={hours} type="button" variant={active ? "default" : "outline"} size="sm" aria-pressed={active} onClick={() => setQuickDuration(hours)}>{String(hours).replace(".", ",")} h</Button>; })}</div><p className="mt-2 text-xs text-muted-foreground">Sätter sluttiden från den valda starttiden. Du kan alltid ange tiden manuellt.</p></fieldset>
    <label className="field-label block space-y-2 text-xs font-medium">Anteckning<textarea className="form-textarea min-h-24" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} /></label>
    {reasonRequired || entry ? <ReasonField required={reasonRequired} value={reason} onChange={setReason} /> : null}
    {entry && loadHistory ? <TimeEntryHistory entryId={entry.id} loadHistory={loadHistory} /> : null}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex justify-end"><Button type="submit" disabled={busy || !taskId || (reasonRequired && !reason.trim())}>Spara tid</Button></div>
  </form>;
}

function WorkScheduleForm({ schedule, busy, error, onSave }: { schedule: TimeSchedule; busy: boolean; error: string; onSave: (input: { scope: "ORGANIZATION" | "MEMBER"; minutes: number | null }) => Promise<void> }) {
  const [organizationHours, setOrganizationHours] = useState(String(schedule.organizationWeeklyWorkMinutes / 60));
  const [memberHours, setMemberHours] = useState(schedule.memberWeeklyWorkMinutes === null ? "" : String(schedule.memberWeeklyWorkMinutes / 60));
  const toMinutes = (value: string) => Math.round(Number(value.replace(",", ".")) * 60);
  const formatHours = (value: number | null) => value === null ? "använder standard" : `${String(value / 60).replace(".", ",")} h/vecka`;
  return <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); const minutes = memberHours.trim() ? toMinutes(memberHours) : null; void onSave({ scope: "MEMBER", minutes }); }}>
    <div className="rounded-xl border bg-muted/30 p-4"><p className="text-sm font-semibold">Din arbetstid</p><p className="mt-1 text-xs text-muted-foreground">Lämna tomt för att använda organisationens standard. Din ändring sparas i historiken.</p><label className="mt-3 block text-xs font-medium text-muted-foreground">Timmar per vecka<Input type="text" inputMode="decimal" value={memberHours} onChange={(event) => setMemberHours(event.target.value)} placeholder={`${schedule.organizationWeeklyWorkMinutes / 60}`} /></label></div>
    {schedule.canEditOrganization && <div className="rounded-xl border bg-muted/30 p-4"><p className="text-sm font-semibold">Organisationens standard</p><p className="mt-1 text-xs text-muted-foreground">Gäller medlemmar utan eget undantag.</p><div className="mt-3 flex flex-wrap items-end gap-2"><label className="flex-1 text-xs font-medium text-muted-foreground">Timmar per vecka<Input type="text" inputMode="decimal" value={organizationHours} onChange={(event) => setOrganizationHours(event.target.value)} /></label><Button type="button" variant="outline" disabled={busy || !organizationHours.trim()} onClick={() => void onSave({ scope: "ORGANIZATION", minutes: toMinutes(organizationHours) })}>Spara standard</Button></div></div>}
    <section className="rounded-xl border bg-muted/20 p-4" aria-labelledby="schedule-history-heading"><h3 id="schedule-history-heading" className="text-sm font-semibold">Historik</h3><p className="mt-1 text-xs text-muted-foreground">Senaste ändringarna av standard och ditt eget undantag.</p>{schedule.events.length ? <ol className="mt-3 space-y-2">{schedule.events.map((event) => <li key={event.id} className="border-l-2 border-primary/30 pl-3 text-xs"><p className="font-medium text-foreground">{event.scope === "ORGANIZATION" ? "Organisationsstandard" : "Personligt undantag"}: {formatHours(event.previousMinutes)} → {formatHours(event.nextMinutes)}</p><p className="mt-1 text-muted-foreground">{event.actorName || "Okänd aktör"} · {dateTime(event.createdAt)}</p></li>)}</ol> : <p className="mt-3 text-xs text-muted-foreground">Inga ändringar är sparade ännu.</p>}</section>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex justify-end"><Button type="submit" disabled={busy}>Spara min arbetstid</Button></div>
  </form>;
}
