"use client";

import { ReturnButton } from "@/features/kfid/use-return-to";
import { announce } from "@/lib/workflow/toast";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { timeTabHref, type TimeTab } from "@/lib/workflow/time-tabs";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsUpDown, Clock3, Download, FileSpreadsheet, ListChecks, Pencil, Play, Plus, SlidersHorizontal, Trash2, Users, History, CalendarRange } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { DialogActions, Empty, Modal, Panel } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { cn } from "@/lib/utils";
import { glueDashes } from "@/lib/workflow/glue-dashes";
import { personInitials, personSolidTone } from "@/features/workflow/person-tone";
import { summarizeReportedWeek } from "@/lib/workflow/time-summary";
import { NativeTimerCard } from "@/components/native/timer-card";
import { ADJUST_TIME_ENTRY_KEY, announceTimerChange, stopMessage, useShortStopGuard, useStartTimerGuard } from "@/features/workflow/running-timer";
import { ExportMenu } from "@/features/workflow/export-menu";
import { TimeTypesSection } from "@/features/payroll/time-types-panel";
import { TimePeriodPanel } from "@/features/workflow/time-period-panel";
import { timeCorrectionRequiresReason, TIME_CORRECTION_REASON_MAX, type TimeEntryEvent } from "@/lib/workflow/time-correction";
import { DEFAULT_WORKDAY, effectiveWeeklyWorkMinutes, weeklyWorkRemainingMinutes, type Workday } from "@/lib/workflow/work-schedule";
import { NoFixedHoursField, WorkdayFields } from "@/features/workflow/work-schedule-fields";
import { addSwedishDays, formatSwedish, formatSwedishTime, fromSwedishDateInput, fromSwedishDateTimeInput, fromSwedishDateTimeInputKeeping, NONEXISTENT_TIME_ERROR, startOfSwedishDay, startOfSwedishMonth, swedishDayKey, swedishMonday, swedishParts, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";
import { ListEmpty, ListGroup, ListRow, ListSkeleton, NativeActions, NativeMenuPage, NativeMonthGrid, NativePage, NativePickerRow, NativeSearch, NativeSegmented, ShowMoreMarker, useNativeTopBar } from "@/components/native";
import { DISCARD_QUESTION, useConfirm } from "@/features/kfid/confirm";
import { leaveWithoutAsking } from "@/lib/workflow/leave-guard";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { useRunningTimers } from "@/components/workspace-actions";
import { previousEntryUrl, returnToWork } from "@/components/history-nav";
import { useNativeMode, useNativeReduced } from "@/features/workflow/use-detail-level";
import { entriesByDay, parseTimeScreen, TIME_SCREEN_TITLE, timeDayGroups, typeOfTaskKind, type TimeScreen } from "@/lib/workflow/native-mode";
import { formatTimerClock, timerElapsedSeconds, type StoppedTimer } from "@/lib/workflow/running-timer";
import { PageHeader } from "@/components/page-shell";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { saveBlob } from "@/lib/download";
import { groupTimeChoices, searchTimeChoices } from "@/lib/workflow/time-choices";
import { invalidateWorkspaceCache } from "@/lib/workflow/workspace-cache";
import { otherDayInputs, rangeAtSave, rangeForLength, resolveTimeType, selectableTimeTypes, type RangeAnchor, type TimeTypeView } from "@/lib/workflow/time-types";

/** `timeTypeId` (Tidstyper, 2026-10-29): the company's type; null/missing = the standard type. Local has no types. */
export type TimeEntry = { id: string; userId: string; startedAt: string; endedAt: string | null; durationSec: number; note: string; createdAt: string; updatedAt: string; corrected?: boolean; timeTypeId?: string | null };
/**
 * What time is reported on (Arbetsordern styr, 2026-10-26): a work order, or a project itself (kind PROJECT, id = the
 * project's) for project time without a work order. RISK_ASSESSMENT and FORM only appear in an older Local file.
 */
export type TimeTask = { id: string; title: string; kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "PROJECT"; status: string; projectId: string | null; updatedAt?: string; project?: { name: string } | null; archived?: boolean; timeEntries: TimeEntry[];
  /** The person is responsible for the work order or booked on it (Cloud; användartest 2026-10-31, F4): listed first in Välj jobb. */
  mine?: boolean;
  /** Tid på jobbet (Fas 2): the work order the task belongs to; time written on the task is recorded there. */
  workOrder?: { id: string; title: string } | null };
/** `taskId` is the chosen source's id; the save sends `projectId` instead when it is a project (one owner per entry). */
export type TimeEntryInput = { id?: string; taskId: string; userId?: string; startedAt: string; endedAt: string; note: string; timeTypeId?: string | null };
export type TimeSchedule = { organizationWeeklyWorkMinutes: number; memberWeeklyWorkMinutes: number | null; canEditOrganization: boolean; events: { id: string; scope: string; previousMinutes: number | null; nextMinutes: number | null; actorName: string; createdAt: string }[];
  /** Arbetstid (2026-10-30): the company's workday (minutes after midnight; left out = 07:00–16:00) and the person's Ingen fast arbetstid. */
  workdayStartMinutes?: number; workdayEndMinutes?: number; noFixedHours?: boolean };
/** Ingen fast arbetstid goes with the person's own hours (Cloud and the demo; Local has one person and leaves it out). */
type ScheduleInput = { scope: "ORGANIZATION" | "MEMBER"; minutes: number | null; noFixedHours?: boolean };
/** canEdit: the person may correct others' time (admins); Teamet alone only reads (2026-10-28). */
type TimeTeam = { canEdit?: boolean; members: { id: string; name: string }[]; entries: (TimeEntry & { taskId: string })[]; from?: string; to?: string };

type LocalTimeAdapter = { tasks: TimeTask[]; schedule?: TimeSchedule; save: (entry: TimeEntryInput, reason: string) => Promise<void>; remove: (id: string, reason: string) => Promise<void>; history: (entryId: string) => TimeEntryEvent[]; saveSchedule: (input: ScheduleInput) => Promise<void> };
type CalendarMode = "day" | "week" | "month";
type ReportRow = TimeEntry & { taskId: string; taskTitle: string; projectName: string; /** The type's name, "" without a list (Local). */ typeName: string };

// All days, weeks, form values and labels are Swedish time (Europe/Stockholm), independent of the browser.
const localInput = (value: Date) => toSwedishDateTimeInput(value);
const dateKey = (value: Date | string) => swedishDayKey(value);
const minutes = (seconds: number) => `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
// Under an hour in minutes (a 2-minute entry is "2 min", never "0 h"); from an hour in hours with one decimal.
const hoursLabel = (seconds: number) => !seconds ? "–" : seconds < 3600 ? `${Math.max(1, Math.round(seconds / 60))} min` : `${(seconds / 3600).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;
const monday = (value: Date) => swedishMonday(value);
const addDays = (value: Date, amount: number) => addSwedishDays(value, amount);
const dayOfMonth = (value: Date) => swedishParts(value).day;
const weekdayShort = (value: Date) => formatSwedish(value, { weekday: "short" });
const longDay = (value: Date) => formatSwedish(value, { weekday: "long", day: "numeric", month: "long" });
const dateTime = (value: string | Date) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
/** "Måndag 5 oktober": only the first letter is raised (CSS capitalize raises every word). */
const firstUpper = (text: string) => text.charAt(0).toLocaleUpperCase("sv-SE") + text.slice(1);
/** Time entries are shown 25 at a time with Visa fler (bounded lists, one page scroll). */
const TIME_PAGE = 25;
/** Rapporterad tid on Min tid (2026-11-02): five rows at a time, with its filters and Visa fler tidposter; the phone's own screen keeps TIME_PAGE. */
const REPORTED_PAGE = 5;
type TimeAnswer = { currentUserId: string; ownFrom?: string; tasks: TimeTask[]; team: TimeTeam | null; schedule: TimeSchedule; /** The work order (or project) a focused task's time is on. */ focusTaskId?: string | null;
  /** Tidstyper (2026-10-29): the company's list, inactive ones too (old entries keep their name). */ timeTypes?: TimeTypeView[] };
const NO_TASKS: TimeTask[] = [];
const NO_TYPES: TimeTypeView[] = [];
/** The name of an entry's type ("" without a list, as in Local). */
const typeNameOf = (types: readonly TimeTypeView[], entry: Pick<TimeEntry, "timeTypeId">) => types.length ? resolveTimeType(types, entry.timeTypeId)?.name ?? "" : "";
const entryCount = (count: number) => `${count} ${count === 1 ? "tidpost" : "tidposter"}`;
const projectName = (task: TimeTask) => task.kind === "PROJECT" ? `Projekttid: ${task.title}` : task.project?.name ?? "Utan projekt";
/** The source as the pickers name it: a work order by its title, a project as "Projekttid: X". */
export const timeSourceLabel = (task: Pick<TimeTask, "kind" | "title">) => task.kind === "PROJECT" ? `Projekttid: ${task.title}` : task.title;
const taskState = (task: TimeTask | undefined) => task ? { status: task.status, archived: Boolean(task.archived) } : undefined;
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  saveBlob(["﻿", csv], filename, "text/csv;charset=utf-8");
}
const csvRow = (entry: ReportRow, types: readonly TimeTypeView[], person?: string) => { return [...(person === undefined ? [] : [person]), dateKey(entry.startedAt), formatSwedishTime(entry.startedAt), entry.endedAt ? formatSwedishTime(entry.endedAt) : "Pågår", String(Math.round(entry.durationSec / 60)), (Math.round(entry.durationSec / 36) / 100).toFixed(2).replace(".", ","), ...(types.length ? [typeNameOf(types, entry)] : []), entry.projectName, entry.taskTitle, entry.note]; };
const csvHeader = (types: readonly TimeTypeView[], person: boolean) => [...(person ? ["Medarbetare"] : []), "Datum", "Start", "Slut", "Tid (min)", "Timmar", ...(types.length ? ["Tidstyp"] : []), "Projekt", "Uppgift", "Anteckning"];

function MemberInitials({ id, name }: { id: string; name: string }) {
  return <span aria-hidden="true" title={name} className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white", personSolidTone(id))}>{personInitials(name)}</span>;
}

/** `tab` (beslut 13, 2026-11-01): Min tid, or Teamet with the month's table and the team's time; Lön och export is features/payroll/time-payroll-tab.tsx. */
export function TimeReport({ local, focusTaskId, tab = "mine" }: { local?: LocalTimeAdapter; focusTaskId?: string; tab?: Exclude<TimeTab, "payroll"> }) {
  // Cloud sends the team's entries for a date range only; the team filter's Från/Till choose the range.
  const [teamRange, setTeamRange] = useState({ from: "", to: "" });
  const [mode, setMode] = useState<CalendarMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editing, setEditing] = useState<ReportRow | null>(null);
  const [deleting, setDeleting] = useState<ReportRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  const [reportScope, setReportScope] = useState<"all" | "visible">("all");
  const [reportProject, setReportProject] = useState("");
  const [reportTask, setReportTask] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportLimit, setReportLimit] = useState(REPORTED_PAGE);
  const [nativeReportLimit, setNativeReportLimit] = useState(TIME_PAGE);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [newEntryKey, setNewEntryKey] = useState(0);
  const appliedFocusTaskId = useRef<string | null>(null);
  // Nivå 1 på mobil (2026-10-09): Tid as a list – today and the timer, the week per day, Lägg till tid and Mer –
  // whose rows open the page's own form and panels as screens (`&step=`). The same calls and rules as the page.
  const native = useNativeMode();
  // Teamets tid, Arbetstid and Exportera are office work: on a phone rows of Tid with Visa mer (A2).
  const reduced = useNativeReduced();
  const searchParams = useSearchParams();
  const router = useRouter();
  // On a phone Teamet is the screen of its own it always was; its address is the tab's.
  const screen = native ? parseTimeScreen(searchParams.get("step")) ?? (tab === "team" ? "team" : null) : null;
  const entryParam = native ? searchParams.get("entry") : null;
  const screenUrl = (next: TimeScreen | null, entry?: string, date?: string) => {
    const params = new URLSearchParams(searchParams.toString()); params.set("view", "time"); params.delete("tab");
    if (next) params.set("step", next); else params.delete("step");
    if (entry) params.set("entry", entry); else params.delete("entry");
    // An empty day of the calendar opens Rapportera tid on that day (2026-10-12).
    if (date) params.set("date", date); else params.delete("date");
    return `/?${params.toString()}`;
  };
  const closeScreen = () => returnToWork(screenUrl(null), (href) => router.push(href));
  // Back from a screen opened inside Tid (an entry from Rapporterad tid, the calendar or Teamets tid): the browser's own
  // step back when the person came from Tid, so the list keeps its search and scroll; otherwise the list itself.
  const backInTime = (fallback: TimeScreen | null) => { if (previousEntryUrl()?.includes("view=time")) window.history.back(); else router.push(screenUrl(fallback)); };
  // The entry and Lägg till tid screens set their own bar (Avbryt/Spara) from the form.
  // Lägg till tid, a time entry and Arbetstid are forms with Avbryt/Spara of their own in the bar.
  // The calendar opens on the month (a real calendar, 2026-10-12); set once when the screen is first shown.
  const [calendarShown, setCalendarShown] = useState(false);
  if (screen === "calendar" && !calendarShown) { setCalendarShown(true); setMode("month"); }
  useNativeTopBar(screen && screen !== "add" && screen !== "entry" && screen !== "schedule" ? { title: TIME_SCREEN_TITLE[screen], back: { label: "Tid" } } : null);
  // Cloud sends the person's own time from a date (quality check 2026-10-05, F6: everything was 5.3 MB); going further
  // back in the calendar or "Visa äldre tid" moves the date. Local has the whole file.
  const [ownFrom, setOwnFrom] = useState("");
  // Steg 7 (stabil sidladdning): the person's time through the workspace's memory cache – Tid opened again shows the week and
  // the entries at once and reads them again; a new period or team range keeps what is shown until its answer comes.
  const timeKey = local ? null : `/api/workflow-time?${new URLSearchParams({ teamFrom: teamRange.from, teamTo: teamRange.to, ownFrom, ...(focusTaskId ? { taskId: focusTaskId } : {}) })}`;
  const read = useWorkspaceData<TimeAnswer>(timeKey, (signal) => api<TimeAnswer>(timeKey!, { signal }), { keepPrevious: true });
  const load = read.reload;
  const cloudTasks = read.data?.tasks ?? NO_TASKS;
  const cloudSchedule = read.data?.schedule ?? null;
  const team = read.data?.team ?? null;
  const currentUserId = read.data?.currentUserId ?? "";
  const loadedFrom = read.data?.ownFrom ?? "";
  const loaded = Boolean(local) || read.data !== undefined;
  const error = actionError || read.error;
  const tasks = local?.tasks ?? cloudTasks;
  const timeTypes = local ? NO_TYPES : read.data?.timeTypes ?? NO_TYPES;
  const schedule = local?.schedule ?? cloudSchedule;
  // The Local file owner is the local administrator; in Cloud admins and team:read receive the team payload, and only
  // admins may correct it (2026-10-28).
  const isAdmin = Boolean(local) || team?.canEdit === true;
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  // A task given in the address is its work order's time (the server says which); a project is its own.
  const focusedTask = (focusTaskId ? taskById.get(focusTaskId) : undefined) ?? (read.data?.focusTaskId ? taskById.get(read.data.focusTaskId) : undefined);
  useEffect(() => {
    if (!focusedTask || appliedFocusTaskId.current === focusedTask.id) return;
    setReportScope("all");
    setReportProject("");
    setReportTask(focusedTask.id);
    appliedFocusTaskId.current = focusedTask.id;
  }, [focusedTask]);
  const entries = useMemo<ReportRow[]>(() => tasks.flatMap((task) => task.timeEntries.map((entry) => ({ ...entry, taskId: task.id, taskTitle: task.title, projectName: projectName(task), typeName: typeNameOf(timeTypes, entry) }))).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [tasks, timeTypes]);
  // "Justera tiden" after a long timer (2026-09-26) opens that entry for editing once it has loaded.
  // Read one microtask after the effect, so the editor is not opened inside the effect body.
  useEffect(() => {
    queueMicrotask(() => {
      let entryId: string | null = null;
      try { entryId = window.sessionStorage.getItem(ADJUST_TIME_ENTRY_KEY); } catch { return; }
      const entry = entryId ? entries.find((item) => item.id === entryId) : undefined;
      if (!entry) return;
      try { window.sessionStorage.removeItem(ADJUST_TIME_ENTRY_KEY); } catch { /* ignore */ }
      setError("");
      // Level 1 on a phone: the entry's own screen instead of a dialog.
      if (native) router.push(`/?view=time&step=entry&entry=${encodeURIComponent(entry.id)}`);
      else { setEditing(entry); setOpen(true); }
    });
  }, [entries, native, router]);
  const reportProjects = useMemo(() => [...new Set(tasks.map(projectName))].sort(), [tasks]);
  const reportTasks = useMemo(() => tasks.filter((task) => !reportProject || projectName(task) === reportProject), [reportProject, tasks]);
  const days = useMemo(() => {
    if (mode === "day") return [startOfSwedishDay(anchor)];
    if (mode === "week") { const first = monday(anchor); return Array.from({ length: 7 }, (_, index) => addDays(first, index)); }
    const first = monday(startOfSwedishMonth(anchor));
    return Array.from({ length: 42 }, (_, index) => addDays(first, index));
  }, [anchor, mode]);
  // A calendar period before the loaded time asks the server for the earlier entries too; checked while rendering when
  // the period or the loaded time changes (React's "adjust state when a value changes").
  const [periodSeen, setPeriodSeen] = useState({ days, loadedFrom, local });
  if (periodSeen.days !== days || periodSeen.loadedFrom !== loadedFrom || periodSeen.local !== local) {
    setPeriodSeen({ days, loadedFrom, local });
    const first = local || !loadedFrom ? "" : dateKey(addDays(days[0], -7));
    if (first && first < loadedFrom) setOwnFrom((current) => current && current <= first ? current : first);
  }
  const showOlder = () => { if (loadedFrom) setOwnFrom(dateKey(addDays(fromSwedishDateInput(loadedFrom)!, -365))); };
  const visibleEntries = useMemo(() => { const keys = new Set(days.map(dateKey)); return entries.filter((entry) => keys.has(dateKey(new Date(entry.startedAt)))); }, [days, entries]);
  const selectedDayKey = selectedDay ? dateKey(selectedDay) : null;
  const reportEntries = useMemo(() => entries.filter((entry) => {
    if (selectedDayKey && dateKey(new Date(entry.startedAt)) !== selectedDayKey) return false;
    if (reportScope === "visible" && !visibleEntries.some((visible) => visible.id === entry.id)) return false;
    if (reportProject && entry.projectName !== reportProject) return false;
    if (reportTask && entry.taskId !== reportTask) return false;
    const needle = reportSearch.trim().toLocaleLowerCase("sv-SE");
    return !needle || [entry.taskTitle, entry.projectName, entry.note, entry.typeName].some((value) => value.toLocaleLowerCase("sv-SE").includes(needle));
  }), [entries, reportProject, reportScope, reportSearch, reportTask, selectedDayKey, visibleEntries]);
  const reportSeconds = reportEntries.reduce((sum, entry) => sum + entry.durationSec, 0);
  const total = visibleEntries.reduce((sum, entry) => sum + entry.durationSec, 0);
  const reportedWeek = useMemo(() => summarizeReportedWeek(entries, anchor), [anchor, entries]);
  const reportedWeekMinutes = Math.round(reportedWeek.totalSeconds / 60);
  const weekLabel = dateKey(monday(anchor)) === dateKey(monday(new Date())) ? "denna vecka" : `vecka ${formatSwedish(reportedWeek.days[0].date, { day: "numeric", month: "short" })}–${formatSwedish(reportedWeek.days[6].date, { day: "numeric", month: "short" })}`;
  // Ingen fast arbetstid (2026-10-30): no weekly target at all, only the reported hours.
  const noFixedHours = Boolean(schedule?.noFixedHours);
  const weeklyTarget = schedule && !noFixedHours ? effectiveWeeklyWorkMinutes(schedule.organizationWeeklyWorkMinutes, schedule.memberWeeklyWorkMinutes) : null;
  const weeklyRemaining = schedule ? weeklyWorkRemainingMinutes(reportedWeekMinutes, schedule.organizationWeeklyWorkMinutes, schedule.memberWeeklyWorkMinutes) : null;
  const weeklyPercent = weeklyTarget ? Math.min(100, Math.round((reportedWeekMinutes / weeklyTarget) * 100)) : 0;
  const dailyTargetSeconds = weeklyTarget ? (weeklyTarget * 60) / 5 : 0;
  const ownsEntry = (entry: TimeEntry) => Boolean(local) || entry.userId === currentUserId;
  // Mirrors the server rule so blocked actions are explained instead of failing after a click.
  const lockedReason = (entry: ReportRow) => {
    const task = taskById.get(entry.taskId);
    if (task?.archived) return "Projektet är arkiverat. Återställ det för att ändra tiden.";
    if (task?.status === "COMPLETED" && !isAdmin) return "Uppgiften är färdigställd. Be en administratör korrigera tiden.";
    if (task?.status === "CANCELLED" && !isAdmin) return "Jobbet har utgått. Be en administratör korrigera tiden.";
    return "";
  };

  async function save(input: TimeEntryInput, reason: string) {
    setBusy(true); setError("");
    try {
      let warning = "";
      // Projekttid: a project source is sent as projectId, so the entry has the project as its one owner.
      const source = taskById.get(input.taskId);
      const entry = source?.kind === "PROJECT" ? { ...input, taskId: undefined, projectId: input.taskId } : input;
      if (local) await local.save(input, reason);
      else warning = (await api<{ warning?: string }>("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "save", entry, reason }) })).warning ?? "";
      // One message per event (2026-10-18): the overlap warning, else a short confirmation – the form empties after a save.
      announce(warning || "Tid sparad");
      await load(); invalidateWorkspaceCache("/api/time-periods"); setOpen(false); setEditing(null);
      if (!input.id) setNewEntryKey((value) => value + 1);
      return true;
    } catch (issue) { setError((issue as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function remove(id: string, reason: string) {
    setBusy(true); setError("");
    try { if (local) await local.remove(id, reason); else await api("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "delete", id, reason }) }); await load(); invalidateWorkspaceCache("/api/time-periods"); setDeleting(null); return true; }
    catch (issue) { setError((issue as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function saveSchedule(input: ScheduleInput) {
    setBusy(true); setError("");
    try {
      if (local) await local.saveSchedule(input);
      else await api("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "schedule_save", ...input }) });
      await load(); setScheduleOpen(false);
      return true;
    } catch (issue) { setError((issue as Error).message); return false; }
    finally { setBusy(false); }
  }
  // Företagets arbetsdag (admins; Cloud and the demo): saved on its own, the page stays open.
  async function saveWorkday(workday: Workday) {
    setBusy(true); setError("");
    try { await api("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "workday_save", ...workday }) }); announce("Arbetsdagen är sparad"); await load(); return true; }
    catch (issue) { setError((issue as Error).message); return false; }
    finally { setBusy(false); }
  }
  const workday = local ? undefined : { startMinutes: schedule?.workdayStartMinutes ?? DEFAULT_WORKDAY.startMinutes, endMinutes: schedule?.workdayEndMinutes ?? DEFAULT_WORKDAY.endMinutes, save: saveWorkday };
  const loadHistory = useCallback(async (entryId: string) => local ? local.history(entryId) : (await api<{ events: TimeEntryEvent[] }>(`/api/workflow-time?history=${encodeURIComponent(entryId)}`)).events, [local]);
  function move(amount: number) { setAnchor((current) => mode === "month" ? startOfSwedishMonth(current, amount) : addDays(current, amount * (mode === "week" ? 7 : 1))); }
  function toggleDay(day: Date) { setSelectedDay((current) => current && dateKey(current) === dateKey(day) ? null : day); }
  // Level 1 on a phone (2026-10-09): an entry is changed and removed on its own screen, never in a dialog.
  const openEditor = (entry: ReportRow) => { setError(""); if (native) router.push(screenUrl("entry", entry.id)); else { setEditing(entry); setOpen(true); } };
  const openDelete = (entry: ReportRow) => { setError(""); if (native) router.push(screenUrl("entry", entry.id)); else setDeleting(entry); };
  const title = mode === "day" ? longDay(anchor) : mode === "week" ? `${formatSwedish(days[0], { day: "numeric", month: "short" })}–${formatSwedish(days[6], { day: "numeric", month: "short", year: "numeric" })}` : formatSwedish(anchor, { month: "long", year: "numeric" });
  const rowActions = (entry: ReportRow) => { const locked = lockedReason(entry); return <>
    <IconButton label="Redigera tidpost" disabledReason={locked} aria-describedby={locked ? `time-locked-${entry.id}` : undefined} onClick={() => openEditor(entry)}><Pencil /></IconButton>
    <RemoveButton label="Ta bort tidpost" disabled={busy} disabledReason={locked} aria-describedby={locked ? `time-locked-${entry.id}` : undefined} onClick={() => openDelete(entry)} />
  </>; };
  const editingOwner = editing ? team?.members.find((member) => member.id === editing.userId)?.name : undefined;
  // PL13: the button is always live (it looked switched off in a week without time); the window says why there is no file.
  const exportMenu = <ExportMenu title="Exportera tidrapport" description={`Dina ${visibleEntries.length} visade poster ${dateKey(days[0])} – ${dateKey(days.at(-1)!)}. Filen öppnas i Excel.`}
      formats={[{ id: "csv", label: "CSV", icon: FileSpreadsheet, primary: true, disabled: !visibleEntries.length, hint: visibleEntries.length ? undefined : "Ingen tid i perioden.", run: () => downloadCsv(`tidrapport-${dateKey(days[0])}-${dateKey(days.at(-1)!)}.csv`, [csvHeader(timeTypes, false), ...visibleEntries.map((entry) => csvRow(entry, timeTypes))]) }]} />;
  const calendarPanel = (
    <Panel icon={CalendarDays} title="Kalenderöversikt" foldKey="time-calendar" description="Bläddra bland dagar, veckor och månader för att se var tid är rapporterad." collapsible={!native} defaultCollapsed={!native}>
      {/* Rendered in the content block, not the header's actions slot, so it wraps freely on narrow viewports instead of forcing the header row wider than the card. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconButton label="Föregående period" variant="outline" onClick={() => move(-1)}><ChevronLeft /></IconButton>
          <Button variant="outline" onClick={() => setAnchor(new Date())}>I dag</Button>
          <IconButton label="Nästa period" variant="outline" onClick={() => move(1)}><ChevronRight /></IconButton>
        </div>
        <div className="flex w-full rounded-lg border bg-muted/40 p-1 sm:w-auto">{(["day", "week", "month"] as const).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium sm:flex-none ${mode === item ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"}`}>{item === "day" ? "Dag" : item === "week" ? "Vecka" : "Månad"}</button>)}</div>
      </div>
      <p className="mb-3 text-center text-sm font-semibold capitalize">{title}<span className="ml-2 text-xs font-normal text-muted-foreground">{minutes(total)} rapporterat</span></p>
      <div className={`-mx-4 -mb-4 grid border-t ${mode === "day" ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7"}`}>
        {days.map((day) => { const dayEntries = entries.filter((entry) => dateKey(new Date(entry.startedAt)) === dateKey(day)); const outside = mode === "month" && swedishParts(day).month !== swedishParts(anchor).month; return <div key={day.toISOString()} className={`min-h-28 border-b border-r p-2 ${outside ? "bg-muted/25 text-muted-foreground" : ""}`}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium capitalize">{weekdayShort(day)}</span><span className={dateKey(day) === dateKey(new Date()) ? "flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground" : ""}>{dayOfMonth(day)}</span></div><div className="space-y-1.5">{dayEntries.map((entry) => <button key={entry.id} type="button" disabled={Boolean(lockedReason(entry))} title={lockedReason(entry) || undefined} onClick={() => openEditor(entry)} className="w-full rounded-md border border-primary/15 bg-secondary px-2 py-1.5 text-left text-[11px] leading-4 text-secondary-foreground hover:border-primary/40 disabled:cursor-default disabled:hover:border-primary/15"><span className="block truncate font-semibold">{entry.taskTitle}</span><span>{minutes(entry.durationSec)}</span></button>)}</div></div>; })}
      </div>
    </Panel>
  );
  const reportedPanel = (
    // Before the first answer: the panel with grey rows where the entries will be (steg 6), not "Ingen rapporterad tid".
    !loaded ? <Panel icon={History} title="Rapporterad tid" description="Filtrera, redigera eller flytta rapporterad tid mellan arbetsordrar och projekt.">
      <DelayedSkeleton testId="time-loading"><RowsSkeleton rows={5} label="Hämtar tid…" /></DelayedSkeleton>
    </Panel>
    : entries.length || focusedTask ? <Panel className="@container" icon={History} title="Rapporterad tid" description="Filtrera, redigera eller flytta rapporterad tid mellan arbetsordrar och projekt.">
      <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
        <label className="text-xs font-medium text-muted-foreground">Sök<Input aria-label="Sök i rapporterad tid" className="mt-1" type="search" value={reportSearch} onChange={(event) => { setReportSearch(event.target.value); setReportLimit(REPORTED_PAGE); }} placeholder="Arbetsorder, projekt eller anteckning" /></label>
        <label className="text-xs font-medium text-muted-foreground">Tidsperiod<select aria-label="Tidsperiod" className="form-select mt-1" value={reportScope} onChange={(event) => setReportScope(event.target.value as "all" | "visible")}><option value="all">Alla datum</option><option value="visible">Visad kalenderperiod</option></select></label>
        <label className="text-xs font-medium text-muted-foreground">Projekt<select aria-label="Projekt" className="form-select mt-1" value={reportProject} onChange={(event) => { setReportProject(event.target.value); setReportTask(""); }}><option value="">Alla projekt</option>{reportProjects.map((project) => <option key={project} value={project}>{project}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">Arbetsorder<select aria-label="Arbetsorder" className="form-select mt-1" value={reportTask} onChange={(event) => setReportTask(event.target.value)}><option value="">Alla arbetsordrar och projekt</option>{reportTasks.map((task) => <option key={task.id} value={task.id}>{timeSourceLabel(task)}</option>)}</select></label>
      </div>
      <p className="mt-4 text-xs text-muted-foreground" role="status">Dina: {entryCount(reportEntries.length)} · totalt <span className="font-medium text-foreground">{minutes(reportSeconds)}</span></p>
      {/* One page scroll (no box with its own scroll), bounded by Visa fler. */}
      {reportEntries.length ? <div className="-mx-4 mt-2 divide-y border-t">{reportEntries.slice(0, reportLimit).map((entry) => <TimeEntryLine key={entry.id} testId="own-time-entry" entry={entry}
        badge={entry.corrected ? "Korrigerad av administratör" : null} meta={<>{entry.projectName}{entry.typeName ? ` · ${entry.typeName}` : ""}{entry.note ? ` · ${entry.note}` : ""}</>}
        reason={<DisabledReason id={`time-locked-${entry.id}`} reason={lockedReason(entry)} className="mt-1" />} actions={rowActions(entry)} />)}</div> : <p className="mt-2 border-t pt-4 text-sm text-muted-foreground">Inga tidposter matchar dina filter.</p>}
      {reportEntries.length > reportLimit ? <div className="mt-3 border-t pt-3"><Button variant="outline" size="sm" onClick={() => setReportLimit((value) => value + REPORTED_PAGE)} data-testid="own-time-more">Visa fler tidposter</Button></div>
        : !local && loadedFrom && reportScope === "all" ? <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3"><p className="text-xs text-muted-foreground">Visar tid från {loadedFrom}.</p><Button variant="outline" size="sm" onClick={showOlder}>Visa äldre tid</Button></div> : null}
    </Panel> : <Empty title="Ingen rapporterad tid" description="Starta tiden på en arbetsorder eller ett projekt, eller registrera tiden här.">
      {!local && loadedFrom ? <Button variant="outline" size="sm" onClick={showOlder}>Visa äldre tid än {loadedFrom}</Button> : null}
    </Empty>
  );
  const teamPanel = team ? <TeamTime team={team} tasks={tasks} timeTypes={timeTypes} taskById={taskById} busy={busy} onEdit={openEditor} onDelete={openDelete} lockedReason={lockedReason} onRange={(from, to) => setTeamRange((current) => current.from === from && current.to === to ? current : { from, to })} /> : null;
  const dialogs = <>
    <DialogPage pageKey="redigera-tid" size="form" panelTitle="Tidposten" open={open} onOpenChange={(value) => { setOpen(value); if (!value) setEditing(null); }} title="Redigera tid">
      {editing ? <TimeEntryForm key={editing.id} onCancel={() => { setOpen(false); setEditing(null); }} tasks={tasks} timeTypes={timeTypes} entry={editing} ownerName={!ownsEntry(editing) ? editingOwner ?? "annan medarbetare" : undefined} currentUserId={currentUserId} isAdmin={isAdmin} ownsEntry={(userId) => Boolean(local) || userId === currentUserId} busy={busy} error={error} onSave={save} loadHistory={loadHistory} /> : null}
    </DialogPage>
    <Modal open={Boolean(deleting)} onOpenChange={(value) => { if (!value) setDeleting(null); }} title="Ta bort tidpost" size="compact">
      {deleting ? <DeleteTimeEntry entry={deleting} reasonRequired={timeCorrectionRequiresReason({ actorIsAdmin: isAdmin, actorOwnsEntry: ownsEntry(deleting), source: taskState(taskById.get(deleting.taskId)) })} busy={busy} error={error} onCancel={() => setDeleting(null)} onConfirm={(reason) => remove(deleting.id, reason)} /> : null}
    </Modal>
    {/* Larger than the popup ceiling (Popupstorlek, 2026-10-13): a page on displays 2 and 3 (level 1 has its own Arbetstid screen). */}
    <DialogPage pageKey="arbetstid" size="page" panelTitle="Arbetstid" open={scheduleOpen} onOpenChange={setScheduleOpen} title="Ordinarie veckoarbetstid">{schedule && <WorkScheduleForm schedule={schedule} busy={busy} error={error} onCancel={() => setScheduleOpen(false)} onSave={async (input) => { await saveSchedule(input); }} workday={workday} />}</DialogPage>
  </>;
  // Lägg till tid opened from the calendar (`date` in the address) leads back to the calendar on that day after Spara
  // (2026-10-12), not to the Tid start page; Avbryt goes back the same way.
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const returnToCalendar = (day: string) => { const date = fromSwedishDateInput(day); if (date) setAnchor(date); setCalendarDay(day); backInTime("calendar"); };
  const addFromDay = native ? searchParams.get("date") : null;
  const closeAdd = () => { if (addFromDay) returnToCalendar(addFromDay); else closeScreen(); };
  const newEntryForm = (nativeBar?: { title: string; onCancel: () => void }) => <TimeEntryForm key={`new-${newEntryKey}-${currentUserId}-${focusedTask?.id ?? ""}-${timeTypes.length}-${workday?.startMinutes ?? ""}`} tasks={tasks} timeTypes={timeTypes} entry={null} preferredTaskId={focusedTask?.id} initialDay={addFromDay ?? undefined} workdayStartMinutes={workday?.startMinutes} members={team?.canEdit ? team.members : undefined} currentUserId={currentUserId} isAdmin={isAdmin} ownsEntry={(userId) => Boolean(local) || userId === currentUserId} busy={busy} error={!open && !deleting && !scheduleOpen ? error : ""} onSave={nativeBar ? async (input, reason) => { if (await save(input, reason)) closeAdd(); } : save} nativeBar={nativeBar} />;
  if (native) {
    // Nivå 1 på mobil (2026-10-09): every part of Tid is a screen of its own – lists of rows, an entry on its own
    // screen with Avbryt/Spara in the top bar and Ta bort inside it; no dialogs, tables or scroll boxes inside the page.
    // native-form-screen: the fields in one white group, as on the app's other form screens (mobil 2026-11-18, app/globals.css).
    if (screen === "add") return <div className="native-form-screen space-y-4 pb-4" data-testid="native-time-add-screen">{newEntryForm({ title: TIME_SCREEN_TITLE.add, onCancel: closeAdd })}</div>;
    if (screen === "entry") {
      const teamRows = (team?.entries ?? []).flatMap((entry): ReportRow[] => { const owner = taskById.get(entry.taskId); return owner ? [{ ...entry, taskTitle: owner.title, projectName: projectName(owner), typeName: typeNameOf(timeTypes, entry) }] : []; });
      const entry = entryParam ? entries.find((item) => item.id === entryParam) ?? teamRows.find((item) => item.id === entryParam) ?? null : null;
      const owner = entry && !ownsEntry(entry) ? team?.members.find((member) => member.id === entry.userId)?.name ?? "annan medarbetare" : undefined;
      return <div className="native-form-screen space-y-4 pb-4" data-testid="native-time-entry-screen">
        {entry ? <TimeEntryForm key={entry.id} tasks={tasks} timeTypes={timeTypes} entry={entry} ownerName={owner} currentUserId={currentUserId} isAdmin={isAdmin} ownsEntry={(userId) => Boolean(local) || userId === currentUserId} busy={busy} error={error}
          onSave={async (input, reason) => { if (await save(input, reason)) backInTime("reported"); }} loadHistory={loadHistory} locked={lockedReason(entry)}
          onDelete={async (reason) => { if (await remove(entry.id, reason)) backInTime("reported"); }}
          nativeBar={{ title: TIME_SCREEN_TITLE.entry, onCancel: () => backInTime("reported") }} />
          : loaded ? <ListGroup><ListEmpty>Tidposten finns inte längre.</ListEmpty></ListGroup> : <DelayedSkeleton><ListSkeleton rows={4} title={false} label="Hämtar tidposten…" /></DelayedSkeleton>}
      </div>;
    }
    if (screen === "reported") return <NativeReported entries={reportEntries} taskById={taskById} total={reportSeconds} limit={nativeReportLimit} onMore={() => setNativeReportLimit((value) => value + TIME_PAGE)}
      older={!local && loadedFrom && reportScope === "all" ? { from: loadedFrom, show: showOlder } : null} screenUrl={screenUrl}
      search={reportSearch} onSearch={(value) => { setReportSearch(value); setNativeReportLimit(TIME_PAGE); }}
      filter={{ scope: reportScope, project: reportProject, task: reportTask, projects: reportProjects, tasks: reportTasks,
        onScope: setReportScope, onProject: (value) => { setReportProject(value); setReportTask(""); }, onTask: setReportTask }} />;
    if (screen === "calendar") return <NativeCalendar mode={mode} onMode={setMode} anchor={anchor} onAnchor={setAnchor} onMove={move} days={days} entries={entries} title={title} total={total} taskById={taskById} screenUrl={screenUrl} initialDay={calendarDay} />;
    if (screen === "team") return team ? <>
      <TeamTime native team={team} tasks={tasks} timeTypes={timeTypes} taskById={taskById} busy={busy} onEdit={openEditor} onDelete={openDelete} lockedReason={lockedReason} screenUrl={screenUrl} onRange={(from, to) => setTeamRange((current) => current.from === from && current.to === to ? current : { from, to })} />
      {/* Månadens tid (2026-10-30): the approver's list for the month, with Godkänn and Påminn. */}
      <TimePeriodPanel native part="team" />
    </>
      : <NativePage><ListGroup><ListEmpty>Du har inte tillgång till teamets tid.</ListEmpty></ListGroup></NativePage>;
    if (screen === "schedule") return <div className="space-y-4 pb-4" data-testid="native-time-schedule-screen">
      {schedule ? <NativeWorkSchedule schedule={schedule} busy={busy} error={error} onSave={saveSchedule} onClose={() => backInTime(null)} timeTypes={!local} workday={workday} onTypesChanged={() => void load()} /> : <ListGroup><ListEmpty>Arbetstiden läses in…</ListEmpty></ListGroup>}
    </div>;
    return <NativeTimeList loaded={loaded} entries={entries} taskById={taskById} anchor={anchor} onWeek={(amount) => setAnchor((current) => addDays(current, amount * 7))} weekTargetMinutes={weeklyTarget} weekRemainingMinutes={weeklyRemaining} weekMinutes={reportedWeekMinutes}
      choices={tasks.filter((task) => !task.archived && task.status !== "COMPLETED" && task.status !== "CANCELLED")} local={Boolean(local)} onChanged={() => { void load(); invalidateWorkspaceCache("/api/time-periods"); }}
      screenUrl={screenUrl} office={reduced ? null : { team: Boolean(team), schedule: Boolean(schedule), exportMenu }}
      period={local ? null : <TimePeriodPanel native part="mine" onChanged={() => void load()} />} />;
  }

  // Teamet (beslut 13, 2026-11-01): the month per person with Godkänn and Påminn, and the team's reported time under it. Without
  // the right the workspace never gets here (lib/workflow/time-tabs.ts); the server checks each read anyway.
  if (tab === "team") return <div className="space-y-6">
    <PageHeader title="Tid" description="Godkänn månaden och följ teamets tid." />
    <TimePeriodPanel part="team" />
    {teamPanel}
    {dialogs}
  </div>;

  return <div className="space-y-6">
    {/* Opened from a job (Se tiden) the page leads back to it (samband, 2026-10-26). */}
    <PageHeader title="Tid" description="Registrera, flytta och följ din rapporterade tid per arbetsorder och projekt." actions={<>{exportMenu}<ReturnButton /></>} />
    <div className="notice flex items-start gap-3"><Clock3 className="mt-0.5 size-4 shrink-0 text-primary" /><p>Tid registreras på en arbetsorder eller på ett projekt (projekttid, till exempel projektledning och möten). Tid i en uppgift räknas på dess arbetsorder.</p></div>
    {focusedTask && reportTask === focusedTask.id ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm" role="status"><p><span className="font-medium">Tidrapport för:</span> {focusedTask.title}</p><Button type="button" size="sm" variant="outline" onClick={() => setReportTask("")}>Visa all tid</Button></div> : null}

    {/* Half and half (2026-11-02): Månadens tid under Min vecka fills the right column, each column at its own height. */}
    <div className="@container"><div className="grid items-start gap-4 @4xl:grid-cols-2" data-testid="time-columns">
      <Panel className="min-w-0" title="Rapportera tid" description="Fyll i dagens arbete." icon={Clock3}>
        {newEntryForm()}
      </Panel>
      <div className="grid min-w-0 content-start gap-4">
      <Panel className="min-w-0" icon={CalendarRange} title="Min vecka" description={`Din rapporterade tid ${weekLabel}.`} actions={<div className="flex items-center gap-1.5"><IconButton label="Föregående vecka" variant="outline" onClick={() => setAnchor((current) => addDays(current, -7))}><ChevronLeft /></IconButton><IconButton label="Nästa vecka" variant="outline" onClick={() => setAnchor((current) => addDays(current, 7))}><ChevronRight /></IconButton></div>}>
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
          {noFixedHours ? <span>Ingen fast arbetstid</span> : weeklyTarget === null ? <span>Ordinarie veckoarbetstid läses in.</span> : <span>Veckomål: {minutes(weeklyTarget * 60)}{schedule?.memberWeeklyWorkMinutes !== null ? " · personligt undantag" : " · organisationsstandard"}</span>}
          <Button type="button" size="sm" variant="ghost" className="h-auto p-0 font-medium text-primary hover:bg-transparent hover:underline" disabled={!schedule} onClick={() => setScheduleOpen(true)}><Clock3 />Arbetstid</Button>
        </div>
      </Panel>
      {/* Månadens tid (2026-10-30): send in and approve per month; Cloud only (Local has one user and no approval). */}
      {!local ? <TimePeriodPanel part="mine" onChanged={() => void load()} /> : null}
      </div>
    </div></div>

    {selectedDay ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm" role="status"><p><span className="font-medium">Visar:</span> <span className="capitalize">{longDay(selectedDay)}</span></p><Button type="button" size="sm" variant="outline" onClick={() => setSelectedDay(null)}>Visa alla dagar</Button></div> : null}

    {calendarPanel}

    {reportedPanel}

    {dialogs}
  </div>;
}

/** The page of what the time is on: a work order (or an older Local task), or the project itself (Projekttid). */
const jobHref = (taskId: string, kind: string) => kind === "PROJECT" ? `/?view=project&projectId=${encodeURIComponent(taskId)}` : `/?view=workflow_task&taskId=${encodeURIComponent(taskId)}&taskType=${encodeURIComponent(kind)}`;

/** Välj jobb gets a search from this many choices (användartest 2026-10-31, F4). */
const SEARCH_CHOICES_FROM = 12;

/**
 * Tid on a phone at level 1 (Nivå 1 på mobil, 2026-10-09): the large title with today's total, the running timer
 * with Stoppa (or Starta tid on the last job), Lägg till tid, the week as one group per day – rows with the job, the time
 * and a chevron to the job – and Mer with the page's own panels as screens. Starting asks the server like the job's own
 * button; a refusal (the risk step, the role's level) says why and leads to the job.
 */
function NativeTimeList({ loaded, entries, taskById, anchor, onWeek, weekMinutes, weekTargetMinutes, weekRemainingMinutes, choices, local, onChanged, screenUrl, office, period }: {
  /** Månadens tid (2026-10-30): the person's month and Skicka in (Cloud only). */
  period?: ReactNode;
  /** The time has been read; before that the groups under the tiles are the list's grey shape (stabil sidladdning). */
  loaded: boolean;
  entries: ReportRow[]; taskById: Map<string, TimeTask>; anchor: Date; onWeek: (amount: number) => void;
  weekMinutes: number; weekTargetMinutes: number | null; weekRemainingMinutes: number | null;
  choices: TimeTask[]; local: boolean; onChanged: () => void;
  screenUrl: (screen: TimeScreen | null) => string;
  /** The office's parts, given with Visa mer (content level 3, A2); null tells the page's button there is more. */
  office: { team: boolean; schedule: boolean; exportMenu: ReactNode } | null;
}) {
  const router = useRouter();
  // Starta tid says which job it starts, and the job can be changed (2026-10-12).
  const [chosenId, setChosenId] = useState("");
  // Mina jobb, Senaste and Alla jobb, never cut off, with a search when the list is long (användartest 2026-10-31, F4).
  const [jobSearch, setJobSearch] = useState("");
  const searchable = choices.length > SEARCH_CHOICES_FROM;
  const shownChoices = searchable ? searchTimeChoices(choices, jobSearch) : choices;
  const groupedChoices = groupTimeChoices(shownChoices);
  // No job is preselected (2026-10-18): the person picks the job; a single open job (or a single match) is the only choice there is.
  const startTask = choices.find((task) => task.id === chosenId) ?? (shownChoices.length === 1 ? shownChoices[0] : null);
  const source = useRunningTimers();
  const running = source?.timers[0] ?? null;
  const offset = source?.clockOffsetMs ?? 0;
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(new Date(Date.now() + offset));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [running, offset]);
  const today = dateKey(now);
  const todaySeconds = entries.filter((entry) => dateKey(entry.startedAt) === today).reduce((sum, entry) => sum + (entry.endedAt ? entry.durationSec : timerElapsedSeconds(entry.startedAt, now)), 0);
  const weekStart = monday(anchor);
  const weekDays = Array.from({ length: 7 }, (_, index) => dateKey(addDays(weekStart, index)));
  const groups = timeDayGroups(entries, (entry) => dateKey(entry.startedAt), weekDays, today);
  const thisWeek = weekDays.includes(dateKey(new Date()));
  const hours = (value: number) => (value / 60).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
  const weekLine = weekTargetMinutes === null ? `${hours(weekMinutes)} h` : `${hours(weekMinutes)} av ${hours(weekTargetMinutes)} h · ${(weekRemainingMinutes ?? 0) > 0 ? `${hoursLabel((weekRemainingMinutes ?? 0) * 60)} kvar` : "veckomålet nått"}`;
  const { allowStop, element: shortStopCard } = useShortStopGuard();
  // Starting while the time runs on another job asks first (2026-10-12); the server then switches with the answer.
  const { allowStart, element: switchCard } = useStartTimerGuard();
  async function pause() {
    if (!source || !running) return;
    const choice = await allowStop(running.startedAt, offset);
    if (!choice) return;
    setBusy(true);
    try { announceTimerChange(await source.pause(running, choice)); onChanged(); announce(stopMessage(choice)); }
    catch (issue) { announce((issue as Error).message, true); }
    finally { setBusy(false); }
  }
  async function start() {
    if (!startTask) return;
    const choice = await allowStart({ taskId: startTask.id, title: startTask.title });
    if (!choice) return;
    setBusy(true);
    try {
      // Projekttid starts through Tid's route, a work order's through its job (one running timer per person either way).
      const result = startTask.kind === "PROJECT"
        ? await api<{ stopped?: StoppedTimer[] }>("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "project_timer", projectId: startTask.id, command: "START", keepShort: choice.keepShort }) })
        : await api<{ stopped?: StoppedTimer[] }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "timer", id: startTask.id, command: "START", keepShort: choice.keepShort }) });
      announceTimerChange(result.stopped ?? []); onChanged();
    } catch (issue) { announce((issue as Error).message, true, [{ label: "Öppna jobbet", run: () => router.push(jobHref(startTask.id, startTask.kind)) }]); }
    finally { setBusy(false); }
  }
  // M2 (2026-10-12): the two usual choices as big tiles, the timer and Kalender as rows. Teamets tid, Arbetstid and
  // Exportera are office functions that live in level 2 (plan step 5); on a phone they follow the week with Visa mer (A2).
  return <NativeMenuPage testId="native-time"
    tiles={[
      { title: "Rapportera tid", subtitle: `I dag: ${minutes(todaySeconds)}`, type: "time", icon: Plus, href: screenUrl("add"), testId: "native-time-add" },
      { title: "Rapporterad tid", subtitle: "Sök och ändra", type: "time", icon: ListChecks, href: screenUrl("reported"), testId: "native-time-reported" },
    ]}>
    {/* Until the time is read, the groups under the tiles are one grey shape, so the job picker, the week and the days do
        not come in one after the other and push each other down (stabil sidladdning, 2026-10-23: 58 px on a phone). */}
    {!loaded ? <DelayedSkeleton testId="native-time-loading"><ListSkeleton rows={4} title={false} label="Hämtar tid…" /></DelayedSkeleton> : <>
    <ListGroup testId="native-time-timer">
      {shortStopCard}{switchCard}
      {running ? <div role="listitem"><NativeTimerCard clock={formatTimerClock(timerElapsedSeconds(running.startedAt, now))} title={running.taskTitle} href={jobHref(running.taskId, running.kind)} busy={busy} onStop={() => void pause()} testId="native-time-running" stopTestId="native-time-pause" /></div>
        : choices.length ? <>
          {searchable ? <div role="listitem" className="px-4 pt-3"><NativeSearch value={jobSearch} onChange={setJobSearch} label="Sök jobb" placeholder="Sök jobb eller projekt" /></div> : null}
          {searchable && !shownChoices.length ? <ListEmpty>Inget jobb matchar sökningen.</ListEmpty> : null}
          {shownChoices.length > 1 || (startTask && !shownChoices.some((task) => task.id === startTask.id)) ? <NativePickerRow label="Jobb" display={startTask ? optionLabel(startTask, choices) : "Välj jobb"} stacked testId="native-time-start-job">
            <select aria-label="Jobb att starta tid på" value={startTask?.id ?? ""} onChange={(event) => setChosenId(event.target.value)}>{startTask ? null : <option value="" disabled>Välj jobb</option>}
              {startTask && !shownChoices.some((task) => task.id === startTask.id) ? <option value={startTask.id}>{optionLabel(startTask, choices)}</option> : null}
              {([["Mina jobb", groupedChoices.mine], ["Senast rapporterade", groupedChoices.recent], [groupedChoices.mine.length || groupedChoices.recent.length ? "Alla jobb" : "", groupedChoices.rest]] as const).map(([label, group]) => !group.length ? null
                : label ? <optgroup key={label} label={label}>{group.map((task) => <option key={task.id} value={task.id}>{optionLabel(task, choices)}</option>)}</optgroup>
                : group.map((task) => <option key={task.id} value={task.id}>{optionLabel(task, choices)}</option>))}
            </select>
          </NativePickerRow> : null}
          {!startTask ? null : local
            ? <ListRow type="time" icon={Play} title="Starta tid" subtitle={startTask.title} href={jobHref(startTask.id, startTask.kind)} testId="native-time-start" />
            : <ListRow type="time" icon={Play} title={busy ? "Startar…" : "Starta tid"} subtitle={startTask.title} onClick={() => { if (!busy) void start(); }} chevron={false} testId="native-time-start" />}
        </> : null}
      <ListRow type="neutral" icon={CalendarDays} title="Kalender" subtitle="Månad, vecka och dag" href={screenUrl("calendar")} testId="native-time-calendar" />
    </ListGroup>
    <ListGroup title={thisWeek ? "Denna vecka" : "Vecka"} testId="native-time-week">
      <ListRow type="time" icon={CalendarDays} title={`${formatSwedish(weekStart, { day: "numeric", month: "short" })}–${formatSwedish(addDays(weekStart, 6), { day: "numeric", month: "short" })}`} subtitle={weekLine} chevron={false}
        accessory={<><IconButton label="Föregående vecka" onClick={() => onWeek(-1)}><ChevronLeft /></IconButton><IconButton label="Nästa vecka" onClick={() => onWeek(1)}><ChevronRight /></IconButton></>} />
    </ListGroup>
    {groups.length ? groups.map((group) => <ListGroup key={group.day} title={`${longDay(fromSwedishDateInput(group.day)!)}${group.seconds ? ` · ${minutes(group.seconds)}` : ""}`} testId="native-time-day">
      {group.items.length ? group.items.map((entry) => { const kind = taskById.get(entry.taskId)?.kind ?? "FORM"; return <ListRow key={entry.id} type={typeOfTaskKind(kind)} title={entry.taskTitle} testId="native-time-row"
        subtitle={`${formatSwedishTime(entry.startedAt)}–${entry.endedAt ? formatSwedishTime(entry.endedAt) : "pågår"} · ${entry.projectName}${entry.typeName ? ` · ${entry.typeName}` : ""}${entry.note ? ` · ${entry.note}` : ""}`}
        value={entry.endedAt ? hoursLabel(entry.durationSec) : "Pågår"} href={jobHref(entry.taskId, kind)} />; })
        : <ListEmpty>Ingen tid i dag ännu.</ListEmpty>}
    </ListGroup>) : <ListGroup><ListEmpty>Ingen tid rapporterad den här veckan.</ListEmpty></ListGroup>}
    {office ? <>
      {office.team || office.schedule ? <ListGroup title="Mer" testId="native-time-office">
        {office.team ? <ListRow type="time" icon={Users} title={TIME_SCREEN_TITLE.team} subtitle="Godkänn och följ teamets tid" href={timeTabHref("team")} testId="native-time-team" /> : null}
        {office.team ? <ListRow type="time" icon={FileSpreadsheet} title="Lön och export" subtitle="Löneunderlag och fil till lönesystemet" href={timeTabHref("payroll")} testId="native-time-payroll" /> : null}
        {office.schedule ? <ListRow type="time" icon={CalendarDays} title={TIME_SCREEN_TITLE.schedule} subtitle="Ordinarie veckoarbetstid" href={screenUrl("schedule")} testId="native-time-schedule" /> : null}
      </ListGroup> : null}
      <NativeActions testId="native-time-export">{office.exportMenu}</NativeActions>
    </> : <ShowMoreMarker />}
    {/* Månadens tid last: it reads its month on its own, so nothing below it moves when it appears (fasta platser, 2026-10-30). */}
    {period}
    </>}
  </NativeMenuPage>;
}

/** A time entry as a row: the job (two lines when long), the time span and the project, the duration to the right. */
function entryRow(entry: ReportRow, taskById: Map<string, TimeTask>, href: string | undefined, person?: string) {
  const kind = taskById.get(entry.taskId)?.kind ?? "FORM";
  const span = `${formatSwedishTime(entry.startedAt)}–${entry.endedAt ? formatSwedishTime(entry.endedAt) : "pågår"}`;
  return <ListRow key={entry.id} type={typeOfTaskKind(kind)} title={entry.taskTitle} twoLines href={href} testId="native-time-entry-row"
    subtitle={[person, span, entry.projectName, entry.typeName, entry.note].filter(Boolean).join(" · ")}
    pill={entry.corrected ? { label: "Korrigerad", tone: "warning" } : null}
    value={entry.endedAt ? hoursLabel(entry.durationSec) : "Pågår"} />;
}

type ReportFilter = {
  scope: "all" | "visible"; project: string; task: string; projects: string[]; tasks: TimeTask[];
  onScope: (value: "all" | "visible") => void; onProject: (value: string) => void; onTask: (value: string) => void;
};

/**
 * Rapporterad tid at level 1 (2026-10-09: "en ruta i rutan", filters over the whole first screen, a squeezed
 * table): one page that scrolls, the top bar's title only, a search field, the filters folded behind one Filter row,
 * then the entries grouped by day as rows. A row opens the entry's own screen, where it is changed or removed.
 */
function NativeReported({ entries, taskById, total, limit, onMore, older, screenUrl, search, onSearch, filter }: {
  entries: ReportRow[]; taskById: Map<string, TimeTask>; total: number; limit: number; onMore: () => void;
  older: { from: string; show: () => void } | null; screenUrl: (screen: TimeScreen | null, entry?: string) => string;
  search: string; onSearch: (value: string) => void; filter: ReportFilter;
}) {
  const [showFilter, setShowFilter] = useState(false);
  const taskName = filter.tasks.find((task) => task.id === filter.task)?.title;
  const summary = [filter.scope === "visible" ? "Kalenderns period" : "", filter.project, taskName].filter(Boolean).join(" · ");
  const groups = entriesByDay(entries.slice(0, limit), (entry) => dateKey(entry.startedAt));
  return <NativePage testId="native-time-reported">
    <NativeSearch value={search} onChange={onSearch} label="Sök i rapporterad tid" placeholder="Uppgift, projekt eller anteckning" />
    <ListGroup testId="native-time-filter">
      <ListRow type="neutral" icon={SlidersHorizontal} title="Filter" value={summary || "Alla"} onClick={() => setShowFilter((open) => !open)} chevron={false}
        ariaLabel={showFilter ? "Dölj filter" : "Visa filter"} testId="native-time-filter-toggle" />
      {showFilter ? <>
        <NativePickerRow label="Tidsperiod" display={filter.scope === "visible" ? "Kalenderns period" : "Alla datum"}>
          <select aria-label="Tidsperiod" value={filter.scope} onChange={(event) => filter.onScope(event.target.value as "all" | "visible")}><option value="all">Alla datum</option><option value="visible">Kalenderns period</option></select>
        </NativePickerRow>
        <NativePickerRow label="Projekt" display={filter.project || "Alla projekt"}>
          <select aria-label="Projekt" value={filter.project} onChange={(event) => filter.onProject(event.target.value)}><option value="">Alla projekt</option>{filter.projects.map((project) => <option key={project} value={project}>{project}</option>)}</select>
        </NativePickerRow>
        <NativePickerRow label="Uppgift" display={taskName ?? "Alla uppgifter"} stacked>
          <select aria-label="Uppgift" value={filter.task} onChange={(event) => filter.onTask(event.target.value)}><option value="">Alla uppgifter</option>{filter.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>
        </NativePickerRow>
        {summary ? <ListRow title={<span className="text-primary">Rensa filter</span>} chevron={false} onClick={() => { filter.onScope("all"); filter.onProject(""); filter.onTask(""); }} testId="native-time-filter-clear" /> : null}
      </> : null}
    </ListGroup>
    <p className="px-4 pt-3 text-xs text-muted-foreground" role="status">{entryCount(entries.length)} · totalt <span className="font-medium text-foreground">{minutes(total)}</span></p>
    {groups.length ? groups.map((group) => <ListGroup key={group.day} title={`${longDay(fromSwedishDateInput(group.day)!)} · ${minutes(group.seconds)}`} testId="native-time-reported-day">
      {group.items.map((entry) => entryRow(entry, taskById, screenUrl("entry", entry.id)))}
    </ListGroup>) : <ListGroup><ListEmpty>Inga tidposter matchar sökningen och filtret.</ListEmpty></ListGroup>}
    {entries.length > limit ? <ListGroup><ListRow title={<span className="text-primary">Visa fler tidposter</span>} chevron={false} onClick={onMore} testId="native-time-more-entries" /></ListGroup>
      : older ? <ListGroup footer={`Visar tid från ${older.from}.`}><ListRow title={<span className="text-primary">Visa äldre tid</span>} chevron={false} onClick={older.show} testId="native-time-older" /></ListGroup> : null}
  </NativePage>;
}

/**
 * Kalender at level 1 (2026-10-12): Månad is a real calendar (NativeMonthGrid, hours per day; a day pressed shows its
 * entries under the grid), Vecka is the week's days as rows (a day opens Dag), Dag is the day's entries as a list.
 */
function NativeCalendar({ mode, onMode, anchor, onAnchor, onMove, days, entries, title, total, taskById, screenUrl, initialDay }: {
  mode: CalendarMode; onMode: (mode: CalendarMode) => void; anchor: Date; onAnchor: (day: Date) => void; onMove: (amount: number) => void;
  days: Date[]; entries: ReportRow[]; title: string; total: number; taskById: Map<string, TimeTask>; screenUrl: (screen: TimeScreen | null, entry?: string, date?: string) => string;
  /** The day to show first (back from Lägg till tid on that day). */ initialDay?: string | null;
}) {
  const today = dateKey(new Date());
  const anchorKey = dateKey(anchor);
  const [picked, setPicked] = useState<string | null>(initialDay ?? null);
  const seconds = new Map<string, number>();
  for (const entry of entries) { const day = dateKey(entry.startedAt); seconds.set(day, (seconds.get(day) ?? 0) + entry.durationSec); }
  const openDay = (day: Date) => { onAnchor(day); onMode("day"); };
  const dayRow = (day: Date) => { const key = dateKey(day); return <ListRow key={key} title={firstUpper(longDay(day))}
    subtitle={key === today ? "I dag" : undefined} value={hoursLabel(seconds.get(key) ?? 0)} onClick={() => openDay(day)} testId="native-calendar-day" />; };
  // The chosen day of the month grid: the person's own press if it is in the shown month, otherwise today if it is there.
  const selected = picked && picked.slice(0, 7) === anchorKey.slice(0, 7) ? picked : today.slice(0, 7) === anchorKey.slice(0, 7) ? today : null;
  const dayEntries = mode === "day" ? entries.filter((entry) => dateKey(entry.startedAt) === anchorKey)
    : mode === "month" && selected ? entries.filter((entry) => dateKey(entry.startedAt) === selected) : [];
  // The day's entries, and Lägg till tid with the day filled in as a row under them – also on a day that already has
  // time (2026-10-12); Spara leads back here, to the same day.
  const dayList = (day: string, items: ReportRow[]) => <>
    {items.length ? items.map((entry) => entryRow(entry, taskById, screenUrl("entry", entry.id))) : <ListEmpty>Ingen tid den här dagen.</ListEmpty>}
    <ListRow type="time" icon={Plus} title="Lägg till tid" href={screenUrl("add", undefined, day)} testId="native-calendar-add" />
  </>;
  const values: Record<string, number> = {};
  seconds.forEach((value, key) => { values[key] = value; });
  return <NativePage testId="native-time-calendar">
    <div className="flex justify-center pb-1 pt-2">
      <NativeSegmented label="Visa" value={mode} onChange={onMode} testId="native-calendar-mode" options={[["month", "Månad"], ["week", "Vecka"], ["day", "Dag"]] as const} />
    </div>
    {mode === "month" ? <>
      <NativeMonthGrid anchor={anchorKey} today={today} selected={selected} values={values} testId="native-calendar-month"
        onSelect={setPicked} onMoveMonth={onMove} onToday={() => { setPicked(today); onAnchor(new Date()); }} />
      <ListGroup title={selected ? firstUpper(longDay(fromSwedishDateInput(selected)!)) : "Dag"} footer={`${minutes(total)} rapporterat i månaden`} testId="native-calendar-day-entries">
        {!selected ? <ListEmpty>Tryck på en dag för att se tiden.</ListEmpty> : dayList(selected, dayEntries)}
      </ListGroup>
    </> : <ListGroup>
      <ListRow type="time" icon={CalendarDays} title={firstUpper(title)} subtitle={`${minutes(total)} rapporterat`} chevron={false} testId="native-calendar-period"
        accessory={<>
          <IconButton label="Föregående period" onClick={() => onMove(-1)}><ChevronLeft /></IconButton>
          <Button type="button" size="sm" variant="ghost" className="px-2 text-primary" onClick={() => onAnchor(new Date())}>I dag</Button>
          <IconButton label="Nästa period" onClick={() => onMove(1)}><ChevronRight /></IconButton>
        </>} />
    </ListGroup>}
    {mode === "week" ? <ListGroup title="Dagar" testId="native-calendar-week">{days.map(dayRow)}</ListGroup> : null}
    {mode === "day" ? <ListGroup title={firstUpper(longDay(anchor))} testId="native-calendar-day-entries">
      {dayList(anchorKey, dayEntries)}
    </ListGroup> : null}
  </NativePage>;
}

function TeamTime({ team, tasks, timeTypes, taskById, busy, onEdit, onDelete, lockedReason, onRange, native = false, screenUrl }: { team: TimeTeam; tasks: TimeTask[]; timeTypes: readonly TimeTypeView[]; taskById: Map<string, TimeTask>; busy: boolean; onEdit: (entry: ReportRow) => void; onDelete: (entry: ReportRow) => void; lockedReason: (entry: ReportRow) => string; onRange?: (from: string, to: string) => void;
  /** Level 1 on a phone: a list of rows grouped by day, the filters folded behind one row, an entry on its own screen. */ native?: boolean; screenUrl?: (screen: TimeScreen | null, entry?: string) => string }) {
  const [showFilter, setShowFilter] = useState(false);
  const [person, setPerson] = useState("");
  const [project, setProject] = useState("");
  const [task, setTask] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(TIME_PAGE);
  // Ask the server for the chosen period once the dates settle; without Från it sends the last 90 days.
  useEffect(() => { if (!onRange) return; const timer = setTimeout(() => onRange(from, to), 300); return () => clearTimeout(timer); }, [from, to, onRange]);
  const names = useMemo(() => new Map(team.members.map((member) => [member.id, member.name])), [team.members]);
  const rows = useMemo(() => team.entries.flatMap((entry): ReportRow[] => { const owner = taskById.get(entry.taskId); return owner ? [{ ...entry, taskTitle: owner.title, projectName: projectName(owner), typeName: typeNameOf(timeTypes, entry) }] : []; }).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [taskById, team.entries, timeTypes]);
  // Tidstyp filter (2026-10-29): by the type's id; an entry without a type is the standard type.
  const typeOptions = useMemo(() => [...timeTypes].sort((a, b) => a.sortOrder - b.sortOrder), [timeTypes]);
  const projects = useMemo(() => [...new Set(tasks.map(projectName))].sort(), [tasks]);
  const filtered = useMemo(() => rows.filter((entry) => {
    const day = dateKey(new Date(entry.startedAt));
    return (!person || entry.userId === person) && (!project || entry.projectName === project) && (!task || entry.taskId === task) && (!type || resolveTimeType(timeTypes, entry.timeTypeId)?.id === type) && (!from || day >= from) && (!to || day <= to);
  }), [from, person, project, rows, task, to, type, timeTypes]);
  const totalSeconds = filtered.reduce((sum, entry) => sum + entry.durationSec, 0);
  const personName = (userId: string) => names.get(userId) ?? "Tidigare medlem";
  // Teamet without admin rights reads the team's time; correcting it stays with admins (2026-10-28).
  const editable = team.canEdit === true;
  const exportCsv = () => downloadCsv("teamets-tidrapport.csv", [csvHeader(timeTypes, true), ...filtered.map((entry) => csvRow(entry, timeTypes, personName(entry.userId)))]);
  const typeName = typeOptions.find((item) => item.id === type)?.name;
  if (native && screenUrl) {
    const taskName = tasks.find((item) => item.id === task)?.title;
    const summary = [person ? personName(person) : "", project, taskName, typeName, from || to ? `${from || "…"} – ${to || "…"}` : ""].filter(Boolean).join(" · ");
    return <NativePage testId="native-time-team-list">
      <ListGroup testId="native-team-filter">
        <ListRow type="neutral" icon={SlidersHorizontal} title="Filter" value={summary || "Alla"} onClick={() => setShowFilter((open) => !open)} chevron={false} ariaLabel={showFilter ? "Dölj filter" : "Visa filter"} testId="native-team-filter-toggle" />
        {showFilter ? <>
          <NativePickerRow label="Medarbetare" display={person ? personName(person) : "Alla medarbetare"}>
            <select aria-label="Teamets medarbetare" value={person} onChange={(event) => setPerson(event.target.value)}><option value="">Alla medarbetare</option>{team.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
          </NativePickerRow>
          <NativePickerRow label="Projekt" display={project || "Alla projekt"}>
            <select aria-label="Teamets projekt" value={project} onChange={(event) => { setProject(event.target.value); setTask(""); }}><option value="">Alla projekt</option>{projects.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          </NativePickerRow>
          <NativePickerRow label="Uppgift" display={taskName ?? "Alla uppgifter"} stacked>
            <select aria-label="Teamets uppgift" value={task} onChange={(event) => setTask(event.target.value)}><option value="">Alla uppgifter</option>{tasks.filter((item) => !project || projectName(item) === project).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          </NativePickerRow>
          {typeOptions.length ? <NativePickerRow label="Tidstyp" display={typeName ?? "Alla tidstyper"}>
            <select aria-label="Teamets tidstyp" value={type} onChange={(event) => setType(event.target.value)}><option value="">Alla tidstyper</option>{typeOptions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : " (avstängd)"}</option>)}</select>
          </NativePickerRow> : null}
          <NativePickerRow label="Från" display={from || (team.from ? `${team.from} (standard)` : "Senaste 90 dagarna")}>
            <input type="date" aria-label="Teamets tid från" value={from} onChange={(event) => setFrom(event.target.value)} />
          </NativePickerRow>
          <NativePickerRow label="Till" display={to || "I dag"}>
            <input type="date" aria-label="Teamets tid till" value={to} onChange={(event) => setTo(event.target.value)} />
          </NativePickerRow>
          {summary ? <ListRow title={<span className="text-primary">Rensa filter</span>} chevron={false} onClick={() => { setPerson(""); setProject(""); setTask(""); setType(""); setFrom(""); setTo(""); }} /> : null}
        </> : null}
      </ListGroup>
      <p className="px-4 pt-3 text-xs text-muted-foreground" role="status">{entryCount(filtered.length)} · totalt <span className="font-medium text-foreground">{minutes(totalSeconds)}</span></p>
      {filtered.length ? entriesByDay(filtered.slice(0, limit), (entry) => dateKey(entry.startedAt)).map((group) => <ListGroup key={group.day} title={`${longDay(fromSwedishDateInput(group.day)!)} · ${minutes(group.seconds)}`} testId="native-team-day">
        {group.items.map((entry) => entryRow(entry, taskById, editable ? screenUrl("entry", entry.id) : undefined, personName(entry.userId)))}
      </ListGroup>) : <ListGroup><ListEmpty>Inga tidposter matchar filtret.</ListEmpty></ListGroup>}
      {filtered.length > limit ? <ListGroup><ListRow title={<span className="text-primary">Visa fler tidposter</span>} chevron={false} onClick={() => setLimit((value) => value + TIME_PAGE)} /></ListGroup> : null}
      <ListGroup footer="Medarbetarnas tid med filtret ovan, som en fil som öppnas i Excel.">
        <ListRow type="neutral" icon={Download} title="Exportera" subtitle={filtered.length ? `${entryCount(filtered.length)} som CSV-fil` : "Inget att exportera"} onClick={filtered.length ? exportCsv : undefined} chevron={false} testId="native-team-export" />
      </ListGroup>
    </NativePage>;
  }
  return <Panel className="@container" title="Teamets rapporterade tid" description={editable ? "Alla medarbetares tid. Administratörer kan korrigera poster, och den som ändrar någon annans tid måste skriva en kommentar." : "Alla medarbetares tid."} icon={Users} actions={<ExportMenu title="Exportera teamets tid" description={`${filtered.length} poster med nuvarande filter. Filen öppnas i Excel.`} disabled={!filtered.length} testId="team-export-menu"
    formats={[{ id: "csv", label: "CSV", icon: FileSpreadsheet, primary: true, run: exportCsv }]} />}>
    <div className={cn("grid gap-3 @xl:grid-cols-2", typeOptions.length ? "@4xl:grid-cols-3 @6xl:grid-cols-6" : "@4xl:grid-cols-5")}>
      {/* Distinct accessible names: the personal list on the same page has its own Projekt/Uppgift filters. */}
      <label className="text-xs font-medium text-muted-foreground">Medarbetare<select aria-label="Teamets medarbetare" className="form-select mt-1" value={person} onChange={(event) => setPerson(event.target.value)}><option value="">Alla medarbetare</option>{team.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Projekt<select aria-label="Teamets projekt" className="form-select mt-1" value={project} onChange={(event) => { setProject(event.target.value); setTask(""); }}><option value="">Alla projekt</option>{projects.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Uppgift<select aria-label="Teamets uppgift" className="form-select mt-1" value={task} onChange={(event) => setTask(event.target.value)}><option value="">Alla uppgifter</option>{tasks.filter((item) => !project || projectName(item) === project).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      {typeOptions.length ? <label className="text-xs font-medium text-muted-foreground">Tidstyp<select aria-label="Teamets tidstyp" className="form-select mt-1" value={type} onChange={(event) => setType(event.target.value)}><option value="">Alla tidstyper</option>{typeOptions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : " (avstängd)"}</option>)}</select></label> : null}
      <label className="text-xs font-medium text-muted-foreground">Från<Input aria-label="Teamets tid från" className="mt-1" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="text-xs font-medium text-muted-foreground">Till<Input aria-label="Teamets tid till" className="mt-1" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    <p className="mt-4 text-xs text-muted-foreground" role="status">Teamet: {entryCount(filtered.length)} · totalt <span className="font-medium text-foreground">{minutes(totalSeconds)}</span>{team.from && !from ? ` · från ${team.from} (ändra Från för äldre tid)` : ""}</p>
    {filtered.length ? <div className="-mx-4 mt-2 divide-y border-t">{filtered.slice(0, limit).map((entry) => <TimeEntryLine key={entry.id} testId="team-time-entry" entry={entry}
      lead={<MemberInitials id={entry.userId} name={personName(entry.userId)} />} badge={entry.corrected ? "Korrigerad" : null}
      meta={<><span className="font-medium text-foreground">{personName(entry.userId)}</span> · {entry.projectName}{entry.typeName ? ` · ${entry.typeName}` : ""}</>}
      reason={editable ? <DisabledReason id={`team-time-locked-${entry.id}`} reason={lockedReason(entry)} className="mt-1" /> : null}
      actions={editable ? <>
        <IconButton label={`Redigera tidpost för ${personName(entry.userId)}`} disabledReason={lockedReason(entry)} aria-describedby={lockedReason(entry) ? `team-time-locked-${entry.id}` : undefined} onClick={() => onEdit(entry)}><Pencil /></IconButton>
        <RemoveButton label={`Ta bort tidpost för ${personName(entry.userId)}`} disabled={busy} disabledReason={lockedReason(entry)} aria-describedby={lockedReason(entry) ? `team-time-locked-${entry.id}` : undefined} onClick={() => onDelete(entry)} />
      </> : null} />)}</div> : <p className="mt-2 border-t pt-4 text-sm text-muted-foreground">Inga tidposter matchar filtren.</p>}
    {filtered.length > limit ? <div className="mt-3 border-t pt-3"><Button variant="outline" size="sm" onClick={() => setLimit((value) => value + TIME_PAGE)}>Visa fler tidposter</Button></div> : null}
  </Panel>;
}

/**
 * A time entry in the page's lists (Rapporterad tid, Teamets rapporterade tid). From 640 px one line: the job and its
 * project, the date, the length and the buttons in fixed places. On a phone (levels 2–3) stacked, so the job's name is
 * never squeezed to one letter: the job on up to two lines with the project under it, then the date, the length and the
 * buttons in a row of their own.
 */
function TimeEntryLine({ entry, testId, lead, badge, meta, reason, actions }: { entry: ReportRow; testId: string; lead?: React.ReactNode; badge: string | null; meta: React.ReactNode; reason: React.ReactNode; actions: React.ReactNode }) {
  return <div data-testid={testId} className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-secondary/40 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-2.5">
    <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
      {lead}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold [overflow-wrap:anywhere] sm:line-clamp-1">{glueDashes(entry.taskTitle)}{badge ? <span className="ml-2 inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">{badge}</span> : null}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        {reason}
      </div>
    </div>
    {/* Wraps on a narrow phone (2026-10-13: at 360 px the team list was wider than the screen). */}
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:contents", lead && "pl-11")}>
      <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden="true" />{dateTime(entry.startedAt)}</span>
      <span className="ml-auto whitespace-nowrap text-right text-sm font-semibold tabular-nums sm:ml-0 sm:min-w-20">{minutes(entry.durationSec)}</span>
      <div className="flex shrink-0">{actions}</div>
    </div>
  </div>;
}

function ReasonField({ required, value, onChange }: { required: boolean; value: string; onChange: (value: string) => void }) {
  return <label className="field-label block space-y-2 text-xs font-medium">Kommentar till korrigering{required ? " (krävs)" : " (valfritt)"}
    <textarea className="form-textarea min-h-20" value={value} onChange={(event) => onChange(event.target.value)} maxLength={TIME_CORRECTION_REASON_MAX} required={required} placeholder="Till exempel: flyttad från fel arbetsorder" />
    {required ? <span className="block font-normal text-muted-foreground">Krävs när du ändrar någon annans tid eller tid på en färdigställd uppgift.</span> : null}
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
  const describe = (snapshot: TimeEntryEvent["next"]) => snapshot ? `${snapshot.taskTitle} · ${dateTime(snapshot.startedAt)} · ${minutes(snapshot.durationSec)}${snapshot.timeType ? ` · ${snapshot.timeType}` : ""}` : "";
  return <details className="rounded-xl border bg-muted/20 p-3" data-testid="time-entry-history"><summary className="cursor-pointer text-sm font-semibold">Historik</summary>
    {failed ? <p className="mt-2 text-xs text-destructive">Historiken kunde inte läsas in.</p> : !events ? <p className="mt-2 text-xs text-muted-foreground">Läser in…</p> : events.length ? <ol className="mt-3 space-y-2">{events.map((event) => <li key={event.id} className="text-xs">
      <p className="font-medium text-foreground">{actionLabel[event.action]}{event.action === "UPDATED" ? `: ${describe(event.previous)} → ${describe(event.next)}` : `: ${describe(event.next ?? event.previous)}`}</p>
      {event.reason ? <p className="mt-1">Kommentar: {event.reason}</p> : null}
      <p className="mt-1 text-muted-foreground">{event.actorName || "Okänd person"} · {dateTime(event.createdAt)}</p>
    </li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">Ingen historik för posten ännu.</p>}
  </details>;
}

/** The quick choices of Rapportera tid, in hours: short stints first, then the working days (2026-10-12). */
export const QUICK_DURATIONS = [0.25, 0.5, 1, 2, 4, 6, 7.5, 8] as const;
export const quickDurationLabel = (hours: number) => hours < 1 ? `${Math.round(hours * 60)} min` : `${String(hours).replace(".", ",")} h`;

// The form starts on the task the person last wrote time on, not on the first task of the whole company (2026-10-02).
/** Jobs with the same name in the same project are told apart by when they were last changed, then by a number (2026-10-18). */
function optionLabel(task: TimeTask, all: TimeTask[]) {
  const same = all.filter((item) => item.title === task.title && projectName(item) === projectName(task));
  if (same.length < 2) return timeSourceLabel(task);
  const date = task.updatedAt ? new Date(task.updatedAt).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : "";
  const sameDate = same.filter((item) => item.updatedAt && new Date(item.updatedAt).toDateString() === new Date(task.updatedAt ?? 0).toDateString());
  return `${timeSourceLabel(task)} · ${[date, sameDate.length > 1 ? `nr ${same.indexOf(task) + 1}` : ""].filter(Boolean).join(" ") || `nr ${same.indexOf(task) + 1}`}`;
}
function TimeEntryForm({ onCancel, tasks, timeTypes = NO_TYPES, workdayStartMinutes = DEFAULT_WORKDAY.startMinutes, entry, preferredTaskId, initialDay, ownerName, members, currentUserId, isAdmin, ownsEntry, busy, error, onSave, loadHistory, nativeBar, locked = "", onDelete }: {
  /** Why the entry cannot be changed (a finished job, an archived project): Spara and Ta bort say it instead of acting. */ locked?: string;
  /** A new entry on this Swedish day (yyyy-mm-dd), from an empty day of the calendar. */ initialDay?: string;
  /** Avbryt in the shared actions row (Redigera tid as a view: Avbryt + Spara tid in the bottom bar, 2026-10-10). */ onCancel?: () => void;
  /** Level 1 on a phone: Ta bort tidpost inside the entry's own screen, after the shared confirm card. */ onDelete?: (reason: string) => Promise<unknown>; tasks: TimeTask[]; entry: ReportRow | null; /** The task a link came from ("Se tiden"), chosen when time can be written on it. */ preferredTaskId?: string; ownerName?: string; members?: { id: string; name: string }[]; currentUserId: string; isAdmin: boolean; ownsEntry: (userId: string) => boolean; busy: boolean; error: string; onSave: (input: TimeEntryInput, reason: string) => Promise<unknown>; loadHistory?: (entryId: string) => Promise<TimeEntryEvent[]> | TimeEntryEvent[];
  /** Nivå 1 på mobil: the form is a screen of its own with Avbryt and Spara in the top bar instead of Spara tid. */ nativeBar?: { title: string; onCancel: () => void };
  /** Tidstyper (2026-10-29): the company's list; empty (Local) hides the choice. */ timeTypes?: readonly TimeTypeView[];
  /** Företagets arbetsdag (2026-10-30): where a new entry on another day starts. */ workdayStartMinutes?: number }) {
  // Reporting for somebody else is office work: on a phone Medarbetare can be chosen with Visa mer (A2).
  const reduced = useNativeReduced();
  const now = new Date(); const before = new Date(now.getTime() - 60 * 60 * 1000);
  const selectable = (task: TimeTask) => !task.archived && (isAdmin || (task.status !== "COMPLETED" && task.status !== "CANCELLED"));
  const preferred = preferredTaskId ? tasks.find((task) => task.id === preferredTaskId && selectable(task)) : undefined;
  // A new entry starts on an open job (simulation 0.6.3: a finished one was chosen, where the person writes no time); an
  // administrator may still pick a finished one, and a link from a job ("Se tiden") keeps that job.
  // No job is preselected (2026-10-18): the person chooses actively, so time is not written on the wrong job. A link from a job keeps that job.
  const [taskId, setTaskId] = useState(entry?.taskId ?? preferred?.id ?? "");
  const [userId, setUserId] = useState(entry?.userId ?? currentUserId);
  // Today from the calendar is the same as a new entry: the last hour up to now.
  const dayDefault = !entry && initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay) && initialDay !== dateKey(now) ? initialDay : "";
  const [startedAt, setStartedAt] = useState(dayDefault ? otherDayInputs(dayDefault, workdayStartMinutes).start : localInput(entry ? new Date(entry.startedAt) : before));
  const [endedAt, setEndedAt] = useState(dayDefault ? otherDayInputs(dayDefault, workdayStartMinutes).end : localInput(entry?.endedAt ? new Date(entry.endedAt) : now));
  // Tid i efterhand räknas bakåt (2026-10-29): a new entry ends now and a length moves its start, until the person sets
  // the end (then the end stays) or the start (then the start stays). A changed entry keeps its end. Another day from the
  // calendar has no "now": it starts at the company's workday start (2026-10-30) and a length counts from there.
  const [anchor, setAnchor] = useState<RangeAnchor>(entry ? "end" : dayDefault ? "start" : "now");
  const choosableTypes = selectableTimeTypes(timeTypes, entry?.timeTypeId);
  const [timeTypeId, setTimeTypeId] = useState(() => timeTypes.length ? resolveTimeType(timeTypes, entry?.timeTypeId)?.id ?? "" : "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [reason, setReason] = useState("");
  // Sök (kundresa 2026-11-07, M32: 314 choices in one long list): a long list gets a search line that narrows it; the chosen one stays.
  const [taskQuery, setTaskQuery] = useState("");
  // The app too (mobilresan 2026-11-18): the same search line above the phone's picker, so the picker holds only the matches.
  const searchable = tasks.length > 15;
  const query = taskQuery.trim().toLocaleLowerCase("sv");
  const shownTasks = !searchable || !query ? tasks : tasks.filter((task) => task.id === taskId || `${optionLabel(task, tasks)} ${projectName(task)}`.toLocaleLowerCase("sv").includes(query));
  const projects = [...new Set(shownTasks.map(projectName))];
  // Mina jobb first (användartest 2026-10-31, F4): the person's own open work orders, also under their project below.
  const mineChoices = entry ? [] : groupTimeChoices(shownTasks.filter((task) => task.mine && selectable(task))).mine;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const reasonRequired = timeCorrectionRequiresReason({ actorIsAdmin: isAdmin, actorOwnsEntry: ownsEntry(entry?.userId ?? userId), source: entry ? taskState(byId.get(entry.taskId)) : undefined, target: taskState(byId.get(taskId)) });
  // The inputs show Swedish time and are read back as Swedish time whatever the browser's zone. A saved instant is kept
  // while its field is unchanged (the repeated October hour), and a clock time that never happens is refused (2026-10-21).
  const startInstant = fromSwedishDateTimeInputKeeping(startedAt, entry?.startedAt); const endInstant = fromSwedishDateTimeInputKeeping(endedAt, entry?.endedAt);
  // Time is what has been worked; the server allows a few minutes of clock difference (as here).
  const timeProblem = !startInstant || !endInstant ? (startedAt && endedAt ? NONEXISTENT_TIME_ERROR : "Ange start och slut.") : anchor !== "now" && endInstant.getTime() > now.getTime() + 5 * 60_000 ? "Sluttiden ligger i framtiden. Skriv tid som redan är arbetad." : "";
  const saveReason = locked || (!taskId ? "Välj arbetsorder eller projekt först." : timeProblem ? timeProblem : reasonRequired && !reason.trim() ? (entry ? "Skriv en kommentar till ändringen först." : byId.get(taskId)?.status === "COMPLETED" ? "Jobbet är färdigställt. Skriv en kommentar först." : "Skriv en kommentar till korrigeringen först.") : "");
  const deleteReasonRequired = entry ? timeCorrectionRequiresReason({ actorIsAdmin: isAdmin, actorOwnsEntry: ownsEntry(entry.userId), source: taskState(byId.get(entry.taskId)) }) : false;
  const [confirm, confirmElement] = useConfirm();
  const removeEntry = async () => {
    if (!entry || !onDelete) return;
    if (locked) { announce(locked, true); return; }
    if (deleteReasonRequired && !reason.trim()) { announce("Skriv en kommentar till korrigeringen först. Den sparas med borttagningen.", true); return; }
    if (await confirm({ title: "Ta bort tidposten?", message: `${minutes(entry.durationSec)} på ${entry.taskTitle} (${dateTime(entry.startedAt)}). Borttagningen sparas i historiken.`, confirmLabel: "Ta bort", tone: "danger" })) await onDelete(reason);
  };
  const chosenTask = byId.get(taskId);
  const formRef = useRef<HTMLFormElement>(null);
  // Level 1 (2026-10-13): Avbryt, the top bar's Bakåt and the phone's own Bakåt ask when something is changed.
  const [initial] = useState(() => JSON.stringify([taskId, userId, startedAt, endedAt, note, reason, timeTypeId]));
  const dirty = JSON.stringify([taskId, userId, startedAt, endedAt, note, reason, timeTypeId]) !== initial;
  const releaseBack = useUnsavedGuard(Boolean(nativeBar) && dirty && !busy, confirm, undefined, { browserBack: true });
  const cancelScreen = nativeBar ? () => void (async () => {
    if (dirty && !(await confirm(DISCARD_QUESTION))) return;
    leaveWithoutAsking();
    nativeBar.onCancel();
  })() : undefined;
  // Spara in the top bar says why it cannot save yet, as the page's button does (2026-10-08).
  useNativeTopBar(nativeBar && cancelScreen ? { title: nativeBar.title, cancel: { onClick: cancelScreen }, save: { busy, disabled: Boolean(saveReason), onClick: () => { if (saveReason) announce(saveReason, true); else formRef.current?.requestSubmit(); } } } : null);
  const currentHours = startInstant && endInstant ? (endInstant.getTime() - startInstant.getTime()) / 3_600_000 : null;
  const setQuickDuration = (hours: number) => {
    const range = rangeForLength({ start: fromSwedishDateTimeInput(startedAt), end: fromSwedishDateTimeInput(endedAt), hours, anchor, now: new Date() });
    if (!range) return;
    setStartedAt(localInput(range.start)); setEndedAt(localInput(range.end));
  };
  const quickHint = anchor === "now" ? "Räknas bakåt från nu. Du kan alltid ändra start och slut." : anchor === "end" ? "Räknas bakåt från sluttiden." : "Räknas framåt från starttiden.";
  return <form ref={formRef} className="space-y-4 @container" onSubmit={(event) => {
    event.preventDefault();
    if (!startInstant || !endInstant) return;
    // Untouched, a new entry is "the last hours up to now" at the moment it is saved.
    const { start, end } = !entry ? rangeAtSave({ start: startInstant, end: endInstant, anchor, now: new Date() }) : { start: startInstant, end: endInstant };
    if (entry && !entry.endedAt) announce("Tidtagningen är stoppad av ändringen.");
    // Spara closes the screen itself: off the browser-back entry first, then save.
    void releaseBack().then(() => onSave({ id: entry?.id, taskId, ...(members && userId !== currentUserId ? { userId } : {}), startedAt: start.toISOString(), endedAt: end.toISOString(), note, ...(timeTypes.length && timeTypeId ? { timeTypeId } : {}) }, reason));
  }}>
    {entry && !entry.endedAt ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="time-running-notice">Tidtagningen pågår. Sparar du med en sluttid stoppas klockan; vill du bara byta uppgift eller anteckning, {nativeBar ? "tryck Avbryt" : "stäng rutan"} och använd Pausa eller Starta på uppgiften.</p> : null}
    {ownerName ? <p className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm">Du korrigerar tid som tillhör <span className="font-semibold">{ownerName}</span>.</p> : null}
    {/* Level 1 is the field app: Medarbetare is read only (reporting for somebody else is done at level 2, 2026-10-12;
        on a phone with Visa mer, A2). */}
    <ShowMoreMarker when={Boolean(members && members.length > 1 && nativeBar && reduced)} />
    {members && members.length > 1 && nativeBar && reduced ? <label className="field-label block space-y-2 text-xs font-medium">Medarbetare
      <Input readOnly aria-readonly="true" tabIndex={-1} value={`${members.find((member) => member.id === userId)?.name ?? ""}${userId === currentUserId ? " (du)" : ""}`} data-testid="time-member-readonly" />
    </label> : members && members.length > 1 ? <label className="field-label block space-y-2 text-xs font-medium">Medarbetare
      <select className="form-select" value={userId} onChange={(event) => setUserId(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.id === currentUserId ? " (du)" : ""}</option>)}</select>
    </label> : null}
    {locked && nativeBar ? <DisabledReason id="time-locked-reason" reason={locked} /> : null}
    <label className="field-label block space-y-2 text-xs font-medium">Arbetsorder eller projekt
      {/* Level 1 on a phone: the whole name is shown (it may wrap) and a tap opens the phone's own list. */}
      {/* Wrapped so the shared "label > input ~ span" rule does not turn the picker below into a block. */}
      {nativeBar && searchable ? <div><Input type="search" value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Sök arbetsorder eller projekt" aria-label="Sök arbetsorder eller projekt" data-testid="time-task-search" className="native-search-field border-0 font-normal" /></div> : null}
      {nativeBar ? <span className="native-picker-field font-normal" data-testid="time-task-picker">
        <span className="min-w-0 flex-1 text-[0.9375rem] [overflow-wrap:anywhere]">{chosenTask ? <>{chosenTask.title}<span className="block text-xs text-muted-foreground">{projectName(chosenTask)}</span></> : "Välj uppgift"}</span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <select aria-label="Arbetsorder eller projekt" value={taskId} onChange={(event) => setTaskId(event.target.value)} required>
          {taskId ? null : <option value="" disabled>{query && !shownTasks.length ? "Inga träffar" : "Välj arbetsorder eller projekt"}</option>}
          {mineChoices.length ? <optgroup label="Mina jobb">{mineChoices.map((task) => <option key={`mine-${task.id}`} value={task.id}>{optionLabel(task, tasks)}</option>)}</optgroup> : null}{projects.map((project) => <optgroup key={project} label={project}>{shownTasks.filter((task) => projectName(task) === project).map((task) => <option key={task.id} value={task.id} disabled={!selectable(task) && task.id !== entry?.taskId}>{optionLabel(task, tasks)}{task.workOrder ? ` → tid på ${task.workOrder.title || "arbetsordern"}` : ""}{task.status === "COMPLETED" ? " (färdigställd)" : ""}{task.archived ? " (arkiverat projekt)" : ""}</option>)}</optgroup>)}
        </select>
      </span> : <>{searchable ? <Input type="search" value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Sök arbetsorder eller projekt" aria-label="Sök arbetsorder eller projekt" data-testid="time-task-search" /> : null}<select className="form-select" aria-label="Arbetsorder eller projekt" value={taskId} onChange={(event) => setTaskId(event.target.value)} required>
        {taskId ? null : <option value="" disabled>{query && !shownTasks.length ? "Inga träffar" : "Välj arbetsorder eller projekt"}</option>}
        {mineChoices.length ? <optgroup label="Mina jobb">{mineChoices.map((task) => <option key={`mine-${task.id}`} value={task.id}>{optionLabel(task, tasks)}</option>)}</optgroup> : null}{projects.map((project) => <optgroup key={project} label={project}>{shownTasks.filter((task) => projectName(task) === project).map((task) => <option key={task.id} value={task.id} disabled={!selectable(task) && task.id !== entry?.taskId}>{optionLabel(task, tasks)}{task.workOrder ? ` → tid på ${task.workOrder.title || "arbetsordern"}` : ""}{task.status === "COMPLETED" ? " (färdigställd)" : ""}{task.archived ? " (arkiverat projekt)" : ""}</option>)}</optgroup>)}
      </select></>}
      {byId.get(taskId)?.workOrder ? <span className="block font-normal text-muted-foreground" data-testid="time-on-work-order">Uppgiften hör till arbetsorder {byId.get(taskId)!.workOrder!.title || "(utan rubrik)"}; tiden sparas där.</span> : null}
    </label>
    <div className="grid gap-4 @md:grid-cols-2">
      <label className="field-label block space-y-2 text-xs font-medium">Start<Input type="datetime-local" value={startedAt} onChange={(event) => { setStartedAt(event.target.value); setAnchor("start"); }} required data-testid="time-start" /></label>
      <label className="field-label block space-y-2 text-xs font-medium">Slut<Input type="datetime-local" value={endedAt} onChange={(event) => { setEndedAt(event.target.value); setAnchor("end"); }} required data-testid="time-end" /></label>
    </div>
    {/* 15 min, 30 min, 1 h and 2 h beside the working days (2026-10-12); 44 px and two rows on a phone at level 1. */}
    <fieldset><legend className="field-label text-xs font-medium">Snabbval</legend><div className="mt-2 flex flex-wrap gap-2" data-testid="time-quick-durations">{QUICK_DURATIONS.map((hours) => { const active = currentHours === hours; return <Button key={hours} type="button" variant={active ? "default" : "outline"} size="sm" className={nativeBar ? "h-11 min-w-16 px-3 text-sm" : undefined} aria-pressed={active} onClick={() => setQuickDuration(hours)}>{quickDurationLabel(hours)}</Button>; })}</div><p className="mt-2 text-xs text-muted-foreground" data-testid="time-quick-hint">{quickHint}</p></fieldset>
    {/* Tidstyp (2026-10-29): the company's own list; the standard type is chosen from the start. */}
    {choosableTypes.length ? <label className="field-label block space-y-2 text-xs font-medium">Tidstyp
      <select className="form-select" aria-label="Tidstyp" value={timeTypeId} onChange={(event) => setTimeTypeId(event.target.value)} data-testid="time-type">
        {choosableTypes.map((type) => <option key={type.id} value={type.id}>{type.name}{type.active ? "" : " (avstängd)"}</option>)}
      </select>
    </label> : null}
    <label className="field-label block space-y-2 text-xs font-medium">Anteckning<textarea className="form-textarea min-h-24" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} /></label>
    {reasonRequired || entry ? <ReasonField required={reasonRequired} value={reason} onChange={setReason} /> : null}
    {entry && loadHistory ? <TimeEntryHistory entryId={entry.id} loadHistory={loadHistory} /> : null}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {/* Why Spara tid cannot be used yet, as text and as a toast when it is pressed (2026-10-08). */}
    <div className="flex flex-col items-end gap-1">{nativeBar ? null : <DialogActions cancel={onCancel ? { onClick: onCancel } : null} primary={{ label: "Spara tid", type: "submit", busy, disabledReason: saveReason, describedBy: saveReason ? "time-save-reason" : undefined }} />}<DisabledReason id="time-save-reason" reason={saveReason} /></div>
    {entry && onDelete ? <Button type="button" variant="outline" className="h-11 w-full border-destructive/40 text-destructive hover:bg-destructive/5" disabled={busy} disabledReason={locked}
      onClick={() => void removeEntry()} data-testid="time-entry-delete"><Trash2 />Ta bort tidpost</Button> : null}
    {confirmElement}
  </form>;
}

/**
 * Arbetstid at level 1 on a phone (2026-10-10: the phone's own lists): your hours per week with Avbryt/Spara in the
 * top bar, the organisation's standard (for those who may change it) with its own Spara standard row, and the history as
 * rows. The same rules and calls as the form on the computer.
 */
function NativeWorkSchedule({ schedule, busy, error, onSave, onClose, timeTypes, onTypesChanged, workday }: { schedule: TimeSchedule; busy: boolean; error: string; /** Tidstyper (Cloud and the demo). */ timeTypes: boolean; onTypesChanged: () => void;
  onSave: (input: ScheduleInput) => Promise<boolean>; onClose: () => void; /** Arbetstid (2026-10-30, Cloud and the demo): the workday and Ingen fast arbetstid. */ workday?: WorkdayChoice }) {
  const [organizationHours, setOrganizationHours] = useState(String(schedule.organizationWeeklyWorkMinutes / 60));
  const [memberHours, setMemberHours] = useState(schedule.memberWeeklyWorkMinutes === null ? "" : String(schedule.memberWeeklyWorkMinutes / 60));
  const [noFixedHours, setNoFixedHours] = useState(Boolean(schedule.noFixedHours));
  const toMinutes = (value: string) => Math.round(Number(value.replace(",", ".")) * 60);
  const hoursText = (value: number | null) => value === null ? "standard" : `${String(value / 60).replace(".", ",")} h/vecka`;
  const save = async () => { if (await onSave({ scope: "MEMBER", minutes: memberHours.trim() ? toMinutes(memberHours) : null, ...(workday ? { noFixedHours } : {}) })) onClose(); };
  useNativeTopBar({ title: TIME_SCREEN_TITLE.schedule, cancel: { onClick: onClose }, save: { busy, onClick: () => void save() } });
  const field = (label: string, value: string, onChange: (value: string) => void, placeholder?: string, testId?: string) => <div role="listitem" className="native-row" data-plain>
    <label className="block w-full py-1 text-[0.8125rem] text-muted-foreground">{label}
      <Input type="text" inputMode="decimal" className="mt-1.5" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} data-testid={testId} /></label>
  </div>;
  return <NativePage testId="native-work-schedule">
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <ListGroup title="Din arbetstid" footer={`Lämna fältet tomt för att använda företagets standard (${hoursText(schedule.organizationWeeklyWorkMinutes)}).`}>
        {field("Timmar per vecka", memberHours, setMemberHours, String(schedule.organizationWeeklyWorkMinutes / 60), "native-schedule-member")}
        {workday ? <div role="listitem" className="native-row" data-plain><NoFixedHoursField checked={noFixedHours} onChange={setNoFixedHours} /></div> : null}
      </ListGroup>
    </form>
    {schedule.canEditOrganization ? <>
      <ListGroup title="Organisationens standard" footer="Standarden gäller alla medlemmar som inte har ett eget undantag.">
        {field("Timmar per vecka", organizationHours, setOrganizationHours, undefined, "native-schedule-organization")}
      </ListGroup>
      <NativeActions><Button type="button" variant="ghost" disabled={busy || !organizationHours.trim()} onClick={() => void onSave({ scope: "ORGANIZATION", minutes: toMinutes(organizationHours) })}><Clock3 />Spara standard</Button></NativeActions>
      {workday ? <div className="px-4 pt-2"><WorkdayFields startMinutes={workday.startMinutes} endMinutes={workday.endMinutes} busy={busy} onSave={workday.save} /></div> : null}
    </> : null}
    {error ? <p className="px-4 pt-2 text-sm text-destructive" role="alert">{error}</p> : null}
    <ListGroup title="Historik">
      {schedule.events.length ? schedule.events.map((event) => <ListRow key={event.id} twoLines title={`${event.scope === "ORGANIZATION" ? "Organisationsstandard" : "Personligt undantag"}: ${hoursText(event.previousMinutes)} → ${hoursText(event.nextMinutes)}`}
        subtitle={`${event.actorName || "Okänd person"} · ${dateTime(event.createdAt)}`} />) : <ListEmpty>Inga ändringar är sparade ännu.</ListEmpty>}
    </ListGroup>
    {timeTypes ? <div className="px-4 pt-4"><TimeTypesSection onChanged={onTypesChanged} /></div> : null}
  </NativePage>;
}

/** The company's workday as Tid → Arbetstid shows it (Cloud and the demo; Local leaves it out). */
type WorkdayChoice = Workday & { save: (workday: Workday) => Promise<unknown> };

function WorkScheduleForm({ schedule, busy, error, onCancel, onSave, workday }: { schedule: TimeSchedule; busy: boolean; error: string; onCancel: () => void; onSave: (input: ScheduleInput) => Promise<void>;
  /** Arbetstid (2026-10-30, Cloud and the demo): the workday and Ingen fast arbetstid. */ workday?: WorkdayChoice }) {
  const [organizationHours, setOrganizationHours] = useState(String(schedule.organizationWeeklyWorkMinutes / 60));
  const [memberHours, setMemberHours] = useState(schedule.memberWeeklyWorkMinutes === null ? "" : String(schedule.memberWeeklyWorkMinutes / 60));
  const [noFixedHours, setNoFixedHours] = useState(Boolean(schedule.noFixedHours));
  const toMinutes = (value: string) => Math.round(Number(value.replace(",", ".")) * 60);
  const formatHours = (value: number | null) => value === null ? "använder standard" : `${String(value / 60).replace(".", ",")} h/vecka`;
  return <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); const minutes = memberHours.trim() ? toMinutes(memberHours) : null; void onSave({ scope: "MEMBER", minutes, ...(workday ? { noFixedHours } : {}) }); }}>
    <div className="rounded-xl border bg-muted/30 p-4"><p className="text-sm font-semibold">Din arbetstid</p><p className="mt-1 text-xs text-muted-foreground">Lämna fältet tomt för att använda företagets standard.</p><label className="mt-3 block text-xs font-medium text-muted-foreground">Timmar per vecka<Input type="text" inputMode="decimal" value={memberHours} onChange={(event) => setMemberHours(event.target.value)} placeholder={`${schedule.organizationWeeklyWorkMinutes / 60}`} /></label>
      {workday ? <NoFixedHoursField checked={noFixedHours} onChange={setNoFixedHours} /> : null}</div>
    {schedule.canEditOrganization && <div className="rounded-xl border bg-muted/30 p-4"><p className="text-sm font-semibold">Organisationens standard</p><p className="mt-1 text-xs text-muted-foreground">Standarden gäller alla medlemmar som inte har ett eget undantag.</p><div className="mt-3 flex flex-wrap items-end gap-2"><label className="flex-1 text-xs font-medium text-muted-foreground">Timmar per vecka<Input type="text" inputMode="decimal" value={organizationHours} onChange={(event) => setOrganizationHours(event.target.value)} /></label><Button type="button" variant="outline" disabled={busy || !organizationHours.trim()} onClick={() => void onSave({ scope: "ORGANIZATION", minutes: toMinutes(organizationHours) })}>Spara standard</Button></div></div>}
    {schedule.canEditOrganization && workday ? <WorkdayFields startMinutes={workday.startMinutes} endMinutes={workday.endMinutes} busy={busy} onSave={workday.save} /> : null}
    <section className="rounded-xl border bg-muted/20 p-4" aria-labelledby="schedule-history-heading"><h3 id="schedule-history-heading" className="text-sm font-semibold">Historik</h3><p className="mt-1 text-xs text-muted-foreground">De senaste ändringarna av standarden och ditt eget undantag.</p>{schedule.events.length ? <ol className="mt-3 space-y-2">{schedule.events.map((event) => <li key={event.id} className="text-xs"><p className="font-medium text-foreground">{event.scope === "ORGANIZATION" ? "Organisationsstandard" : "Personligt undantag"}: {formatHours(event.previousMinutes)} → {formatHours(event.nextMinutes)}</p><p className="mt-1 text-muted-foreground">{event.actorName || "Okänd person"} · {dateTime(event.createdAt)}</p></li>)}</ol> : <p className="mt-3 text-xs text-muted-foreground">Inga ändringar är sparade ännu.</p>}</section>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {/* On the page the row moves to the standard top (Avbryt, then the main action), as on every form page. */}
    <DialogActions cancel={{ onClick: onCancel }} primary={{ label: "Spara min arbetstid", type: "submit", busy }} />
  </form>;
}
