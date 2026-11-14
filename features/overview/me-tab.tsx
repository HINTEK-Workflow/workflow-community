"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlarmClock, Bell, CalendarDays, CircleSlash, Clock3, FilePlus2, ListChecks, Play, Square, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModuleOn } from "@/features/workflow/use-modules";
import { SkeletonText } from "@/components/skeleton";
import { useRunningTimers } from "@/components/workspace-actions";
import { indicatorText } from "@/features/workflow/indicator-tone";
import { shortDay } from "@/lib/workflow/my-day";
import { isoWeek } from "@/lib/workflow/schedule";
import { swedishClock } from "@/lib/swedish-time";
import { firstName, greetingFigures, greetingSentence, greetingWord } from "@/lib/overview/me-greeting";
import { announceTimerChange, stopMessage, useNow, useShortStopGuard, useStartTimerGuard } from "@/features/workflow/running-timer";
import { api } from "@/features/kfid/api";
import { useSubPageHref } from "@/features/kfid/use-return-to";
import { formatTimerClock, runningTimerPlace, runningTimerTaskHref, timerElapsedSeconds, type StoppedTimer } from "@/lib/workflow/running-timer";
import type { TaskNotification } from "@/lib/workflow/task-notifications";
import { announce } from "@/lib/workflow/toast";
import { listHref } from "@/lib/url-filters";
import { cn } from "@/lib/utils";
import { PLAN_KIND_INFO, type MeTabData, type PlanItem, type TimeLine } from "@/lib/overview/me";
import { DayTimeline } from "./day-timeline";
import { PlanCalendar } from "./plan-calendar";
import { BOX_GAP, Box, EmptyNote, ONLY_LEVEL_3, Pill, SrTable } from "./viz";
import { AbsenceDialog, type AbsenceDraft } from "./absence-dialog";
import { Calm, CountLink, HeadlineCard, Progression, Row, RowAction, RowList, rowLook, statusOf } from "./rows";

/**
 * Jag (dashboard etapp 6, 2026-10-28; layout A of the proposal): what I need to do, not only figures. On the left
 * Tid – the running time from the top bar's source with Stoppa (the same guard under a minute) – and the week against the
 * ordinary working time; on the right Gör detta nu with its reasons, Förfallet, Mina avvikelser, my notices, drafts to link
 * to a work order and Ej utfört in my rounds; Min plan under. Every number opens the list it counts (the same rule as the
 * list). `data` null = the first read is on its way: a skeleton of the same shape and height.
 */
const NOTICE_KINDS: Partial<Record<TaskNotification["kind"], string>> = { ASSIGNED: "Tilldelad dig", OBSTACLE: "Hinder", FOLLOW_UP: "Uppföljning", TEAM: "Teamet", COMMENT: "Kommentar" };
const NOTICES_HREF = "/?view=notifications";
const MY_OPEN_JOBS_HREF = listHref("tasks", { type: "all", filter: "open", scope: "mine" });

/** Hours with one decimal only when the rounded value has one: two minutes are "0 h", not "0,0 h" (resa 4, 2026-11-06). */
export const hours = (minutes: number) => { const value = Math.round(minutes / 6) / 10; return value.toLocaleString("sv-SE", { minimumFractionDigits: value % 1 ? 1 : 0, maximumFractionDigits: 1 }); };
const DAY_SHORT = ["Mån", "Tis", "Ons", "Tors", "Fre", "Lör", "Sön"];

/**
 * The past workdays this week with less than the ordinary day reported (half an hour's slack), all of them and the hours they
 * lack together: "Mån saknar 3,5 h", "Mån–Tors saknar 32 h" or "Mån, Ons saknar 12 h" (resa 4: only Monday was named).
 */
export function weekGap(week: Pick<MeTabData["week"], "ordinaryMinutes" | "days">, today: string) {
  const ordinaryDay = week.ordinaryMinutes / 5;
  if (ordinaryDay <= 0) return null;
  const short = week.days.map((day, position) => ({ position, missing: position < 5 && day.date < today ? ordinaryDay - day.minutes : 0 })).filter((day) => day.missing > 30);
  if (!short.length) return null;
  const run = short.every((day, index) => index === 0 || day.position === short[index - 1].position + 1);
  const days = short.length === 1 ? DAY_SHORT[short[0].position] : run ? `${DAY_SHORT[short[0].position]}–${DAY_SHORT[short[short.length - 1].position]}` : short.map((day) => DAY_SHORT[day.position]).join(", ");
  return `${days} saknar ${hours(short.reduce((sum, day) => sum + day.missing, 0))} h`;
}

/** Today's entries under the clock: on what, from–to and how long (a running one has no end yet). */
function TodayLines({ lines }: { lines: readonly TimeLine[] }) {
  const total = lines.reduce((sum, line) => sum + line.minutes, 0);
  return <section aria-labelledby="overview-today" data-testid="overview-today-entries">
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <h3 id="overview-today" className="font-semibold">Idag</h3>
      <span className="text-muted-foreground">Summa <span className="font-semibold tabular-nums text-foreground">{clockText(total)}</span></span>
    </div>
    {lines.length ? <ul className="mt-2 divide-y rounded-lg border">{lines.slice(-4).map((line) => <li key={line.id} className="relative flex items-center gap-2 px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <Link href={line.href} className="stretched-link block truncate font-medium hover:text-primary">{line.title}</Link>
        <p className="tabular-nums text-muted-foreground">{line.start}–{line.end ?? "pågår"}</p>
      </div>
      {line.end ? <span className="font-semibold tabular-nums">{clockText(line.minutes)}</span> : <Pill tone="info" className="shrink-0">Pågår</Pill>}
    </li>)}</ul> : <EmptyNote compact icon={Clock3} title="Ingen tid rapporterad idag" />}
  </section>;
}
const clockText = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** Skriv tid: the time report opened on the job or project (it fills in Lägg till tid), and back here afterwards. */
const writeTimeHref = (target: { taskId?: string | null; projectId?: string | null }) =>
  target.taskId ? `/?view=time&timeTaskId=${encodeURIComponent(target.taskId)}` : target.projectId ? `/?view=time&timeProjectId=${encodeURIComponent(target.projectId)}` : "/?view=time";

/**
 * Tid: the running time (Stoppa, Öppna); the job chosen in the timeline (2026-10-29: "bara byter jobb", Starta tid and
 * Skriv tid); or, without either, where I last had time (Fortsätt, Skriv tid). Then today and the week.
 */
function TimeCard({ week, today, recent, todayEntries, chosen, onClear }: { week: MeTabData["week"]; today: string; recent?: TimeLine | null; todayEntries?: readonly TimeLine[];
  chosen?: PlanItem | null; onClear?: () => void }) {
  const source = useRunningTimers();
  const router = useRouter();
  const subPage = useSubPageHref();
  const current = source?.timers[0] ?? null;
  const now = useNow(Boolean(current), source?.clockOffsetMs ?? 0);
  const [busy, setBusy] = useState(false);
  const { allowStop, element: shortStopCard } = useShortStopGuard();
  const { allowStart, element: switchCard } = useStartTimerGuard();
  async function stop() {
    if (!source || !current) return;
    // Under a minute the same question as everywhere: Spara ändå, Släng or Fortsätt tiden (2026-10-12).
    const choice = await allowStop(current.startedAt, source.clockOffsetMs);
    if (!choice) return;
    setBusy(true);
    try { announceTimerChange(await source.pause(current, choice)); announce(stopMessage(choice)); }
    catch (issue) { announce((issue as Error).message, true); }
    finally { setBusy(false); }
  }
  // The chosen job, unless the time already runs on it (then the card shows the running time).
  const picked = chosen?.job && !source?.timers.some((timer) => timer.taskId === chosen.job!.id) ? chosen : null;
  /** Starta tid (the chosen job) and Fortsätt (where I last had time) start the timer the same way; true when it runs. */
  async function startOn(target: { id: string; kind: string; title: string; href: string }): Promise<boolean> {
    // Starting while the time runs on another job asks first, as everywhere (2026-10-12).
    const choice = await allowStart({ taskId: target.id, title: target.title });
    if (!choice) return false;
    setBusy(true);
    try {
      // Projekttid starts through Tid's route, a job's through the job (one running timer per person either way), as Tid does.
      const result = target.kind === "PROJECT"
        ? await api<{ stopped?: StoppedTimer[] }>("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "project_timer", projectId: target.id, command: "START", keepShort: choice.keepShort }) })
        : await api<{ stopped?: StoppedTimer[] }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "timer", id: target.id, command: "START", keepShort: choice.keepShort }) });
      announceTimerChange(result.stopped ?? []);
      announce(`Tiden går på ${target.title}.`);
      return true;
    } catch (issue) { announce((issue as Error).message, true, [{ label: "Öppna", run: () => router.push(target.href) }]); return false; }
    finally { setBusy(false); }
  }
  const todayMinutes = week.days.find((day) => day.date === today)?.minutes ?? 0;
  const ordinaryDay = week.ordinaryMinutes / 5;
  const shownDays = week.days.filter((day, index) => index < 5 || day.minutes > 0);
  const running = Boolean(current && !picked);
  const clock = running && current ? formatTimerClock(timerElapsedSeconds(current.startedAt, now)) : "0:00:00";
  const gap = weekGap(week, today);
  const head = picked ? { label: "Vald arbetsorder", title: picked.title, line: [picked.start ? `${picked.start}${picked.end ? `–${picked.end}` : ""}` : "", PLAN_KIND_INFO[picked.kind].label,
    picked.job?.kind === "PROJECT" ? "projekttid" : "", picked.state === "done" ? "klar" : "", current ? `tiden går på ${current.taskTitle}` : ""].filter(Boolean).join(" · ") }
    : current ? { label: "Tiden går", title: current.taskTitle, line: runningTimerPlace(current) }
    : recent ? { label: "Senast", title: recent.title, line: `${recent.start}–${recent.end ?? ""} · ${clockText(recent.minutes)}` }
    : { label: "Ingen tid går", title: "Starta tiden på en arbetsorder eller ett projekt.", line: "" };
  return <div className="flex h-full flex-col gap-5" data-testid="overview-time-card" data-picked={picked ? picked.job?.id : undefined}>
    {shortStopCard}{switchCard}
    {/* Fixed heights: the card never changes size when a time starts or stops. */}
    <div className="min-h-[3.25rem]">
      <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">{head.label}
        {picked ? <button type="button" className="font-medium text-primary hover:underline" onClick={() => onClear?.()} data-testid="overview-time-unpick">Ångra val</button> : null}</p>
      <p className="truncate text-sm font-semibold" title={head.title}>{head.title}</p>
      <p className="truncate text-xs text-muted-foreground">{head.line || " "}</p>
    </div>
    <p className={cn("text-5xl font-bold tracking-tight tabular-nums", !running && "text-muted-foreground")} aria-label={running ? `Tiden går: ${clock}` : "Ingen tid går"} data-testid="overview-time-clock">{clock}</p>
    {/* Two buttons of the same width, whatever the card's width (2026-10-29: "knappen jätte bred men inte Skriv tid"). */}
    <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
      {picked ? <>
        <Button size="lg" disabled={busy} onClick={() => void startOn({ ...picked.job!, title: picked.title, href: picked.href }).then((started) => { if (started) onClear?.(); })} data-testid="overview-time-start"><Play />Starta tid</Button>
        <Button size="lg" variant="outline" asChild><Link href={subPage(writeTimeHref(picked.job!.kind === "PROJECT" ? { projectId: picked.job!.id } : { taskId: picked.job!.id }))} data-testid="overview-time-write">Skriv tid</Link></Button>
      </> : current ? <>
        <Button size="lg" disabled={busy} onClick={() => void stop()} data-testid="overview-time-stop"><Square />Stoppa</Button>
        <Button size="lg" variant="outline" asChild><Link href={runningTimerTaskHref(current)}>{current.kind === "PROJECT" ? "Öppna projekt" : "Öppna arbetsorder"}</Link></Button>
      </> : recent ? <>
        {/* Fortsätt starts the time again where I last had it (2026-10-29), with the server's checks; without a job or
            project to put it on (an older control's time) it opens the time report. */}
        {recent.taskId || recent.projectId
          ? <Button size="lg" disabled={busy} onClick={() => void startOn({ id: (recent.taskId ?? recent.projectId)!, kind: recent.taskId ? "TASK" : "PROJECT", title: recent.title, href: recent.href })} data-testid="overview-time-continue"><Play />Fortsätt</Button>
          : <Button size="lg" asChild><Link href={recent.href} data-testid="overview-time-continue"><Play />Fortsätt</Link></Button>}
        <Button size="lg" variant="outline" asChild><Link href={subPage(writeTimeHref(recent))} data-testid="overview-time-write">Skriv tid</Link></Button>
      </> : <Button size="lg" variant="outline" className="col-span-2" asChild><Link href={MY_OPEN_JOBS_HREF}>Mina arbetsordrar</Link></Button>}
    </div>
    {/* Lägg till tid is gone (2026-10-29): Skriv tid above does it. */}
    {todayEntries ? <TodayLines lines={todayEntries} /> : null}
    <section aria-labelledby="overview-week">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        {/* Which week it is (2026-10-29: "förtydliga vilken vecka detta är"): its number and its Monday–Sunday. */}
        <h3 id="overview-week" className="font-semibold" data-testid="overview-week-title">Vecka {isoWeek(week.from)} <span className="font-normal text-muted-foreground">· {shortDay(week.from)}–{shortDay(week.days[6]?.date ?? week.from)}</span></h3>
        <Link href={week.href} className="tabular-nums text-muted-foreground hover:text-primary hover:underline">
          {/* Without fixed hours (ordinary time 0) only the reported time is shown, never "av 0". */}
          <span className="font-semibold text-foreground">{hours(week.reportedMinutes)}</span>{week.ordinaryMinutes > 0 ? <> av {hours(week.ordinaryMinutes)} h ordinarie arbetstid</> : " h rapporterad"}
        </Link>
      </div>
      <p className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <span>Idag <span className="font-semibold tabular-nums text-foreground">{hours(todayMinutes)} h</span></span>
        {gap ? <Link href={week.href} className={cn("font-medium hover:underline", indicatorText("warning"))} data-testid="overview-week-gap">{gap} · Lägg till tid</Link> : null}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, week.ordinaryMinutes ? (week.reportedMinutes / week.ordinaryMinutes) * 100 : 0)}%` }} /></div>
      {/* The days as columns (display level 3); the thin line is the ordinary day (a fifth of the week). */}
      <div className="mt-3 flex h-28 items-end gap-2" aria-hidden="true" {...ONLY_LEVEL_3}>
        {shownDays.map((day) => {
          const index = week.days.indexOf(day);
          const here = day.date === today;
          return <div key={day.date} className="flex h-full flex-1 flex-col items-center gap-1">
            <span className={cn("text-[10.5px] tabular-nums", day.minutes ? "font-semibold" : "text-muted-foreground")}>{day.minutes ? hours(day.minutes) : "–"}</span>
            <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-md bg-muted">
              <span className="absolute inset-x-0 top-0 h-px bg-[var(--workflow-field-border)]" />
              <div className={cn("w-full rounded-md", here ? "bg-primary" : "bg-[color-mix(in_srgb,var(--primary)_40%,var(--card))]")} style={{ height: `${Math.min(100, ordinaryDay ? (day.minutes / ordinaryDay) * 100 : 0)}%` }} />
            </div>
            <span className={cn("text-[10.5px]", here ? "font-semibold text-primary" : "text-muted-foreground")}>{DAY_SHORT[index]}</span>
          </div>;
        })}
      </div>
      <SrTable caption="Rapporterad tid per dag den här veckan" head={["Dag", "Timmar"]} rows={week.days.map((day, index) => [DAY_SHORT[index], hours(day.minutes)])} />
    </section>
  </div>;
}


/**
 * Hälsningen (2026-10-29): the day and the week, God morgon and the first name, one sentence about the day and the four
 * figures, each opening its card on this page (or the list). The words come from lib/overview/me-greeting.ts.
 */
const LONG_MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const LONG_DAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
/**
 * Frånvaro on Jag (2026-10-29): one button, Anmäl frånvaro…, that opens one window for everything (Sjuk idag, Sjuk
 * imorgon, another reason, dates and hours); my absence from today on stands to its right and opens the same window to change
 * it. Shown only where the answer carries it (the demo first).
 */
function MyAbsence({ absence, today, onChanged }: { absence: NonNullable<MeTabData["absence"]>; today: string; onChanged?: () => void }) {
  const [draft, setDraft] = useState<AbsenceDraft | null>(null);
  // Ny and Hem's tile on the phone (2026-11-01) lead here with ?absence=new: the window opens once and the address lets go of it.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const asked = params.get("absence") === "new";
  const [handled, setHandled] = useState(false);
  if (asked !== handled) {
    setHandled(asked);
    if (asked) setDraft({ userId: absence.userId, type: "SICK", note: "", from: today, to: today, hours: null });
  }
  useEffect(() => {
    if (!asked) return;
    const rest = new URLSearchParams(params.toString());
    rest.delete("absence");
    router.replace(`${pathname}?${rest.toString()}`, { scroll: false });
  }, [asked, params, router, pathname]);
  const tomorrow = (() => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); })();
  const range = (from: string, to: string) => from === to ? shortDay(from) : `${shortDay(from)}–${shortDay(to)}`;
  return <div className="flex flex-wrap items-center gap-2" data-testid="my-absence">
    <Button type="button" size="sm" variant="outline" onClick={() => setDraft({ userId: absence.userId, type: "SICK", note: "", from: today, to: today, hours: null })} data-testid="absence-report">Anmäl frånvaro…</Button>
    {absence.mine.map((item) => <button key={item.id} type="button" className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/40" data-testid="my-absence-item"
      onClick={() => setDraft({ id: item.id, userId: absence.userId, type: (item.type ?? "OTHER") as AbsenceDraft["type"], note: item.note, from: item.from, to: item.to, hours: item.hours, byOther: Boolean(item.byOther),
        ...(item.locked ? { locked: `${item.sourceLabel || "Från lönesystemet"}. Den ändras där.` } : {}) })}>
      <Pill tone="warning" className="gap-1.5 whitespace-nowrap px-2.5 py-1 hover:brightness-95"><CalendarDays className="size-3.5" aria-hidden="true" />{item.label} {range(item.from, item.to)}{item.status === "APPLIED" ? " · ansökt" : ""}</Pill>
    </button>)}
    {draft ? <AbsenceDialog key={draft.id ?? "new"} open onOpenChange={(open) => { if (!open) setDraft(null); }} draft={draft} people={[{ id: absence.userId, name: "Jag" }]}
      quick={{ today, tomorrow }} onSaved={() => onChanged?.()} /> : null}
  </div>;
}

function Greeting({ data, name, footer }: { data: MeTabData; name: string; footer?: ReactNode }) {
  const date = new Date(`${data.today}T12:00:00Z`);
  const day = LONG_DAYS[(date.getUTCDay() + 6) % 7];
  const figures = greetingFigures(data);
  const who = firstName(name);
  return <HeadlineCard label="Din dag" testId="overview-greeting" footer={footer}
    kicker={`${day.charAt(0).toUpperCase()}${day.slice(1)} ${date.getUTCDate()} ${LONG_MONTHS[date.getUTCMonth()]} · vecka ${isoWeek(data.today)}`}
    title={`${greetingWord(Number(swedishClock().slice(0, 2)))}${who ? `, ${who}` : ""}`} sentence={greetingSentence(data)}
    chips={[
      { count: figures.overdue, label: figures.overdue === 1 ? "förfallen" : "förfallna", href: "#forfallet", icon: AlarmClock, tone: "danger", testId: "greeting-overdue" },
      { count: figures.today, label: "idag", href: "#tidslinje", icon: Clock3, tone: "info", testId: "greeting-today" },
      { count: figures.deviations, label: figures.deviations === 1 ? "avvikelse" : "avvikelser", href: "#mina-avvikelser", icon: OctagonAlert, tone: data.deviations?.overdue ? "danger" : "warning", testId: "greeting-deviations" },
      { count: figures.laterThisWeek, label: "senare i veckan", href: "#min-plan", icon: CalendarDays, tone: "neutral", testId: "greeting-week" },
    ]} />;
}
export function MeTab({ data, level, notifications = [], userName = "", onChanged }: {
  data: MeTabData | null;
  level: 2 | 3;
  /** The bell's reminders the workspace already reads (no second read): Tilldelad dig, Hinder and Uppföljning are shown here. */
  notifications?: readonly TaskNotification[];
  /** The person's name, for the greeting (first name only). */
  userName?: string;
  /** Read the tab again (after Frånvaro is saved). */
  onChanged?: () => void;
}) {
  // The day chosen in Min plan, shown by Dagens tidslinje (2026-10-29); today's posts until the map reports.
  const [chosenDay, setChosenDay] = useState<{ day: string; items: PlanItem[] | null } | null>(null);
  // The job chosen in the timeline for Tid (2026-10-29: a click chooses, it does not start the time).
  const [pickedPost, setPickedPost] = useState<PlanItem | null>(null);
  // Företagets moduler (0.39.0): without Tid och lön there is no time to show on Jag; the rest of the row takes the room.
  const timeOn = useModuleOn("time");
  if (!data) return <MeSkeleton level={level} />;
  const timelineDay = chosenDay ?? { day: data.today, items: data.plan.items.filter((item) => item.date === data.today) };
  const notices = notifications.filter((item) => NOTICE_KINDS[item.kind]).slice(0, 5);
  const { next, overdue, deviations, drafts, notDone } = data;
  // Tid | Gör detta nu of the same height (2026-10-29), then two columns of lists with Min plan and the timeline last.
  const boxes: { key: string; empty: boolean; node: ReactNode }[] = [];
  // The cards' colours are Hem's for the same tiles (lib/workflow/native-layout.ts): Gör detta nu project, Förfallet
  // work order, Mina avvikelser tools.
  // One job per row, at most five (2026-11-02; replaces the two columns of 2026-11-01).
  const nextBox = next ? <Box title="Gör detta nu" area="project" icon={ListChecks} anchor="gor-detta-nu">
    {next.rows.length ? <RowList testId="overview-next">{next.rows.map((row, index) => {
      const look = rowLook(row.kind, row.id);
      // The most pressing row is marked, so the eye lands there first.
      const status = statusOf(row.status);
      return <Row key={row.id} row={{ id: row.id, title: row.title, detail: row.detail ?? "", href: row.href }} area={look.area} icon={look.icon} highlight={index === 0 && row.pressing} columns
        meta={<Progression kind={row.kind} status={row.status} progress={row.progress} />}
        // The reason stays on the right; it is left out when the status already says it ("Pågår", "Öppen").
        pill={!(status && (row.reason === "in_progress" || row.reason === "open" || row.chip === status.label)) ? <Pill tone={row.pressing ? "danger" : "info"} className="shrink-0">{row.chip}</Pill> : undefined}
        action={<RowAction kind={row.kind} href={row.href} title={row.title} />} />;
    })}</RowList> : <Calm text="Inget just nu" />}
  </Box> : null;
  if (overdue) boxes.push({ key: "overdue", empty: !overdue.rows.length, node: <Box title="Förfallet" area="work-order" icon={AlarmClock} anchor="forfallet"
    action={<span className="flex flex-wrap items-baseline gap-x-3">
      <CountLink href={overdue.tasksHref} count={overdue.tasks} tone="danger">förfallna arbetsordrar</CountLink>
      <CountLink href={overdue.roundsHref} count={overdue.rounds} tone="danger">förfallna ronder</CountLink>
    </span>}>
    {overdue.rows.length ? <RowList testId="overview-overdue">{overdue.rows.map((row) => { const look = rowLook(row.kind, row.id);
      return <Row key={row.id} row={row} area={look.area} icon={look.icon} columns pillColumn={false}
        meta={<Progression kind={row.kind} status={row.status} progress={row.progress} />} action={<RowAction kind={row.kind} href={row.href} title={row.title} />} />; })}</RowList> : <Calm text="Inget är förfallet" />}
  </Box> });
  if (deviations) boxes.push({ key: "deviations", empty: !deviations.rows.length, node: <Box title="Mina avvikelser" area="tools" icon={OctagonAlert} anchor="mina-avvikelser"
    action={<span className="flex flex-wrap items-baseline gap-x-3">
      <CountLink href={deviations.mineHref} count={deviations.count}>öppna</CountLink>
      {deviations.overdue ? <span className={cn("text-xs font-medium tabular-nums", indicatorText("danger"))}>{deviations.overdue} förfallna</span> : null}
    </span>}>
    {deviations.rows.length ? <RowList testId="overview-deviations">{deviations.rows.map((row) => <Row key={row.id} row={row} area="tools" icon={OctagonAlert} columns pillColumn={false}
      meta={<Progression kind="DEVIATION" status={row.status} />} action={<RowAction kind="DEVIATION" href={row.href} title={row.title} />} />)}</RowList> : <Calm text="Inga öppna avvikelser" />}
  </Box> });
      if (notices.length) boxes.push({ key: "notices", empty: false, node: <Box title="Notiser" area="notice" icon={Bell} extra
        action={<Button asChild size="sm" variant="ghost"><Link href={NOTICES_HREF}>Alla notiser</Link></Button>}>
        <RowList testId="overview-notices">{notices.map((item) => <Row key={item.id} row={{ id: item.id, title: item.title, detail: item.detail || item.dueDate || "", href: item.href, late: item.deadline === "OVERDUE" }} area="notice" icon={Bell} columns
          pill={<Pill tone={item.kind === "OBSTACLE" ? "warning" : "info"} className="shrink-0">{NOTICE_KINDS[item.kind]}</Pill>} />)}</RowList>
      </Box> });
  if (drafts && drafts.count) boxes.push({ key: "drafts", empty: false, node: <Box title="Utkast utan arbetsorder" area="control" icon={FilePlus2}
        action={<span className="text-xs font-medium tabular-nums text-muted-foreground"><span className="font-semibold">{drafts.count}</span> att koppla</span>}>
        <RowList testId="overview-drafts">{drafts.rows.map((row) => <Row key={row.id} row={row} area="control" columns
          action={<Button asChild size="sm" variant="outline"><Link href={row.href} aria-label={`Koppla ${row.title} till en arbetsorder`}>Koppla</Link></Button>} />)}</RowList>
      </Box> });
  if (notDone && notDone.count) boxes.push({ key: "not-done", empty: false, node: <Box title="Ej utfört i mina ronder" area="round" icon={CircleSlash}
        action={<CountLink href={notDone.href} count={notDone.count}>ej utförda</CountLink>}>
        <RowList testId="overview-not-done">{notDone.rows.map((row) => <Row key={row.id} row={row} area="round" icon={CircleSlash} />)}</RowList>
      </Box> });
  // Gör detta nu and Förfallet belong together, one right under the other (2026-11-02); Mina avvikelser stands under Tid.
  const boxNode = (key: string) => boxes.find((box) => box.key === key)?.node ?? null;
  const overdueBox = boxNode("overdue");
  const deviationsBox = boxNode("deviations");
  const listBoxes = boxes.filter((box) => box.key !== "overdue" && box.key !== "deviations");
  const sideOn = timeOn || Boolean(deviationsBox);
  const workOn = Boolean(nextBox || overdueBox);
  // A click chooses the job for Tid and leaves the page where it is (2026-11-02: the page jumped up); the toast leads there.
  const pickPost = (item: PlanItem | null) => {
    setPickedPost(item);
    if (item) announce(`${item.title} är vald i Tid.`, false, [{ label: "Gå till Tid", run: () => document.getElementById("tid")?.scrollIntoView({ block: "nearest", behavior: "smooth" }) }]);
  };
  return <div className={cn("grid", BOX_GAP)} data-testid="overview-me">
    <Greeting data={data} name={userName} footer={data.absence ? <MyAbsence absence={data.absence} today={data.today} onChanged={onChanged} /> : undefined} />
    {/* Half and half from 1024 px like the other tabs (2026-11-02): Tid with Mina avvikelser under, the work lists beside them. */}
    <div className={cn("grid items-start", sideOn && workOn && "lg:grid-cols-2", BOX_GAP)} data-testid="overview-me-row-1">
      {sideOn ? <div className={cn("grid min-w-0", BOX_GAP)} data-testid="overview-me-side">
        {!timeOn ? null : <Box title="Tid" area="time" icon={Clock3} anchor="tid"><TimeCard week={data.week} today={data.today} recent={data.recent} todayEntries={data.todayEntries} chosen={pickedPost} onClear={() => setPickedPost(null)} /></Box>}
        {deviationsBox}
      </div> : null}
      {workOn ? <div className={cn("grid min-w-0", BOX_GAP)} data-testid="overview-me-work">
        {nextBox}
        {overdueBox}
      </div> : null}
    </div>
    {/* Two columns from 1024 px, each card its own height and the next right under it, so no card leaves air beside it (2026-11-02; replaces rows of equal height). */}
    <div className={cn("grid items-start lg:grid-cols-2", BOX_GAP)} data-testid="overview-me-columns">
    <div className={cn("grid min-w-0", BOX_GAP)} data-testid="overview-me-left">
      {listBoxes.filter((_, index) => index % 2 === 0).map((box) => <div key={box.key} className="min-w-0">{box.node}</div>)}
      <PlanCalendar plan={data.plan} today={data.today} level={level} narrow legendApart dayList={false} onDay={(day, items) => setChosenDay({ day, items })} />
    </div>
    <div className={cn("grid min-w-0", BOX_GAP)} data-testid="overview-me-right">
      {listBoxes.filter((_, index) => index % 2 === 1).map((box) => <div key={box.key} className="min-w-0">{box.node}</div>)}
      <DayTimeline day={timelineDay.day} today={data.today} items={timelineDay.items} selectedId={pickedPost?.id ?? null}
        onPick={pickPost} />
    </div>
    </div>
  </div>;
}

/** Jag on its way: Tid and three list boxes of their real height, and the plan's card – seen only after ~150 ms. */
export function MeSkeleton({ level }: { level: 2 | 3 }) {
  const box = (rows: number, key: string) => <div key={key} className="app-panel rounded-lg border bg-card" aria-hidden="true">
    <div className="px-4 pb-3 pt-3.5"><span className="section-title block"><SkeletonText className="w-32" /></span></div>
    <div className="space-y-2 px-4 pb-4">{Array.from({ length: rows }, (_, index) => <div key={index} className="native-skeleton h-12 rounded-md" />)}</div>
  </div>;
  // The same places as the tab: Tid and Mina avvikelser | Gör detta nu and Förfallet, then Min plan | Dagens tidslinje.
  const block = (height: string, key?: string) => <div key={key} className="app-panel rounded-lg border bg-card" aria-hidden="true"><div className={cn("native-skeleton m-4 rounded-md", height)} /></div>;
  return <div className={cn("grid", BOX_GAP)} aria-busy="true" data-testid="overview-me-skeleton">
    <span role="status" className="sr-only">Hämtar din översikt…</span>
    <div className={cn("grid items-start lg:grid-cols-2", BOX_GAP)}>
      <div className={cn("grid min-w-0", BOX_GAP)}>{[block("h-[31.25rem]", "time"), box(2, "c")]}</div>
      <div className={cn("grid min-w-0", BOX_GAP)}>{[block("h-[31.25rem]", "next"), box(2, "b")]}</div>
    </div>
    <div className={cn("grid items-start lg:grid-cols-2", BOX_GAP)}>
      {block(level === 2 ? "h-80" : "h-96", "plan")}
      {block(level === 2 ? "h-80" : "h-96", "timeline")}
    </div>
  </div>;
}
