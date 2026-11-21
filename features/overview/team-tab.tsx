"use client";

import Link from "next/link";
import { useSubPageHref } from "@/features/kfid/use-return-to";
import { bookJobHref } from "@/lib/workflow/bookings";
import { useModuleOn } from "@/features/workflow/use-modules";
import { AlarmClock, CalendarClock, CircleCheck, CircleSlash, FileSignature, FolderKanban, ListChecks, Play, RotateCcw, ShieldAlert, ShieldCheck, OctagonAlert, UserX, Users, Clock3, BadgeCheck, CalendarX, GraduationCap, IdCard, Gauge, Wrench, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { indicatorBar, indicatorText } from "@/features/workflow/indicator-tone";
import { Avatar, BOX_GAP, Box, Columns, EmptyNote, GrowBar, Pill, ROWS_SKELETON, SrTable } from "@/features/overview/viz";
import { cn } from "@/lib/utils";
import { swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { isoWeek } from "@/lib/workflow/schedule";
import { REPORTABLE_LABEL } from "@/lib/self-inspection/incidents";
import { periodLabel } from "@/lib/workflow/time-periods";
import { TEAM_GROUP_TITLE, TEAM_GROUPS, teamFigures, teamGroupCounts, teamSentence, type TeamGroup } from "@/lib/overview/team-headline";
import { LATE_STATE_LABEL } from "@/lib/workflow/late-tasks";
import type { TeamAffectedRow, TeamJobRow, TeamTabData } from "@/lib/overview/team-server";
import { AbsenceDialog, HandleAbsenceDialog, type AbsenceDraft } from "./absence-dialog";
import { Calm, CountLink, CountText, HeadlineCard, Progression, Row, RowList, rowLook } from "./rows";
import { MoreNote, TabSkeleton, day, hours, rowLimit } from "./team-customers-parts";

/**
 * Översikt – Teamet (2026-10-28, 0.29.0; reworked 2026-10-29 "med användare i fokus", the same way as Jag): the team's
 * situation on top; Just nu (who works on what) beside Att följa upp – five groups with their own figures, no total (
 * 2026-11-01, beslut 15), the same rows as Jag;
 * the load per person and day; the project status and the deviation log; rounds and safety last, one calm line when there is
 * nothing. Every figure opens its card or the list it counts. A section the person may not read is not sent by the server
 * (null) and is left out here; nothing is invented.
 */

type Level = 2 | 3;
const LONG_MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const LONG_DAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
const DAY_SHORT = ["Mån", "Tis", "Ons", "Tors", "Fre"];

function TeamHeadline({ data }: { data: TeamTabData }) {
  const date = new Date(`${data.today}T12:00:00Z`);
  const name = LONG_DAYS[(date.getUTCDay() + 6) % 7];
  const figures = teamFigures(data);
  return <HeadlineCard label="Läget i teamet" testId="team-headline" title="Läget i teamet" sentence={teamSentence(data)}
    kicker={`${name.charAt(0).toUpperCase()}${name.slice(1)} ${date.getUTCDate()} ${LONG_MONTHS[date.getUTCMonth()]} · vecka ${isoWeek(data.today)}`}
    chips={[
      { count: figures.working, label: "arbetar nu", href: "#just-nu", icon: Play, tone: "info", testId: "team-chip-working" },
      { count: figures.groups.conflicts, label: figures.groups.conflicts === 1 ? "krock" : "krockar", href: "#team-group-conflicts", icon: UserX, tone: "danger", testId: "team-chip-conflicts" },
      { count: figures.groups.obstacles, label: "hinder", href: "#team-group-obstacles", icon: CircleSlash, tone: "danger", testId: "team-chip-obstacles" },
      { count: figures.groups.approvals, label: "att godkänna", href: "#team-group-approvals", icon: Clock3, tone: "warning", testId: "team-chip-approvals" },
      { count: figures.groups.overdue, label: figures.groups.overdue === 1 ? "förfallen" : "förfallna", href: "#team-group-overdue", icon: AlarmClock, tone: "danger", testId: "team-chip-overdue" },
      { count: figures.groups.notStarted, label: "ej startat", href: "#team-group-notStarted", icon: CalendarClock, tone: "warning", testId: "team-chip-not-started" },
      { count: figures.missingTime, label: "saknar tidrapport", href: "#tidrapport", icon: Clock3, tone: "warning", testId: "team-chip-time" },
      { count: figures.expiring, label: "går ut snart", href: "#behorigheter", icon: BadgeCheck, tone: "warning", testId: "team-chip-expiring" },
      { count: figures.overbooked, label: "överbokade", href: "#belastning", icon: Users, tone: "warning", testId: "team-chip-overbooked" },
      { count: figures.lateProjects, label: figures.lateProjects === 1 ? "förfallet projekt" : "förfallna projekt", href: "#projektlage", icon: FolderKanban, tone: "danger", testId: "team-chip-projects" },
    ]} />;
}

/** "1 h 15 min" since a moment. */
const elapsed = (since: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
};

/** Just nu: each person with what their time runs on and since when, and their time today; those working first. Who is
 * away says so (the words this viewer may see) and when they are back; Lägg in frånvaro registers for anyone. */
function NowCard({ data, absence, onChanged }: { data: NonNullable<TeamTabData["now"]>; absence: TeamTabData["absence"]; onChanged?: () => void }) {
  const [draft, setDraft] = useState<AbsenceDraft | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  return <Box title="Just nu" area="time" icon={Play} anchor="just-nu" className="h-full"
    action={absence?.canRegister ? <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ userId: data.people[0]?.id ?? "", type: "SICK", note: "", from: today, to: today, hours: null })} data-testid="team-absence-add">Lägg in frånvaro</Button> : undefined}>
    {draft ? <AbsenceDialog open onOpenChange={(open) => { if (!open) setDraft(null); }} draft={draft} people={data.people.map((person) => ({ id: person.id, name: person.name }))} onSaved={() => onChanged?.()} /> : null}
    {data.people.length ? <ul className="@container/rows divide-y rounded-lg border" data-testid="team-now">
      {data.people.map((person) => <li key={person.id} className="tap-card relative flex items-center gap-3 p-3" data-running={person.running ? "" : undefined}>
        <span className="mt-0.5 self-start"><Avatar personKey={person.id} name={person.name} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{person.name}</p>
          {person.running ? <p className="truncate text-xs">
            {person.running.href ? <Link href={person.running.href} className="stretched-link font-medium text-foreground hover:text-primary">{person.running.title}</Link> : <span className="font-medium">{person.running.title}</span>}
            <span className="text-muted-foreground"> · sedan {swedishClock(new Date(person.running.since))}{person.running.project ? " · projekttid" : ""}</span>
          </p> : person.absent ? <p className="truncate text-xs text-muted-foreground">Frånvarande · tillbaka {day(person.absent.backOn)}</p> : <p className="truncate text-xs text-muted-foreground">Ingen tid går</p>}
          {/* The progression as on Jag (2026-10-29): the running job's status and how far it has come; else today's
              reported time against the ordinary day. Nothing for someone who is away. */}
          {!person.absent ? <div className="@container/meta mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden" data-testid="team-now-progress">
            {person.running && (person.running.status || typeof person.running.progress === "number")
              ? <Progression kind={person.running.kind ?? undefined} status={person.running.status ?? undefined} progress={person.running.progress} />
              : <>
                <Pill tone="neutral" className="min-w-[5.5rem] shrink-0 justify-center">I dag</Pill>
                {person.dayMinutes !== 0 ? <GrowBar value={person.todayMinutes} max={Math.max(1, person.dayMinutes ?? 480)} className="hidden h-1.5 min-w-8 max-w-28 grow basis-8 @[13rem]/meta:block" fill={person.todayMinutes >= (person.dayMinutes ?? 480) ? "bg-[var(--type-round)]" : "bg-primary"} /> : null}
                <span className="shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums text-muted-foreground">{person.dayMinutes === 0 ? `${hours(person.todayMinutes)} h i dag` : `${hours(person.todayMinutes)} av ${hours(person.dayMinutes ?? 480)}`}</span>
              </>}
          </div> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 self-start text-right">
          {person.running ? <Pill tone="info" className="whitespace-nowrap"><Play className="size-3" aria-hidden="true" />{elapsed(person.running.since)}</Pill>
            : person.absent ? <Pill tone="warning" className="whitespace-nowrap">{person.absent.label}</Pill> : null}
          {person.running ? <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">i dag {hours(person.todayMinutes)}</span> : null}
        </div>
      </li>)}
    </ul> : <Calm text="Teamet har inga aktiva medlemmar" />}
  </Box>;
}

/** One row of a group, with what puts it first in its group (the smallest first). */
type GroupRow = { key: string; order: string; node: ReactNode };
type GroupLook = { icon: LucideIcon; tone: "danger" | "warning" };
const GROUP_LOOK: Record<TeamGroup, GroupLook> = { conflicts: { icon: UserX, tone: "danger" }, obstacles: { icon: CircleSlash, tone: "danger" }, approvals: { icon: Clock3, tone: "warning" }, overdue: { icon: AlarmClock, tone: "danger" }, notStarted: { icon: CalendarClock, tone: "warning" } };

const open = (href: string, label: string, text = "Välj ansvarig") => <Button asChild size="sm" variant="outline"><Link href={href} aria-label={label}>{text}</Link></Button>;

/**
 * Att följa upp (2026-11-01, beslut 15): no total, the five groups each in a card of its own with their own figure and the most urgent rows,
 * Krockar och frånvaro and Hinder first. A figure with a list of its own is a link to the list, with as many rows; the rest of a
 * group opens here. Förfallen: the end date has passed. Försenad start: the start has passed and nobody has begun.
 */
function FollowUp({ data, level, onHandle }: { data: TeamTabData; level: Level; onHandle: (row: TeamAffectedRow) => void }) {
  const subPage = useSubPageHref();
  const counts = teamGroupCounts(data);
  const [expanded, setExpanded] = useState<Partial<Record<TeamGroup, boolean>>>({});
  const limit = level === 2 ? 2 : 3;
  const job = (row: TeamJobRow) => rowLook(row.kind, row.id);
  const rows: Record<TeamGroup, GroupRow[]> = {
    // Planned work an absence touches, the soonest first – a person chooses how to re-plan it.
    conflicts: (data.absence?.affected ?? []).map((row) => ({ key: `absence:${row.key}`, order: row.day, node: <Row key={`absence:${row.key}`} columns
      row={{ id: row.key, title: row.title, href: row.href, detail: `${row.personName} · ${row.label} · ${row.kind === "booking" ? "bokad" : "klart senast"} ${day(row.day)}` }}
      area="calendar" icon={UserX} pill={<Pill tone="warning" className="whitespace-nowrap">Frånvaro</Pill>}
      action={<Button type="button" size="sm" variant="outline" onClick={() => onHandle(row)} data-testid="absence-handle-open">Planera om</Button>} /> })),
    // What must be reported to the authority first (användartest 2026-10-31, fel 3), then what stops a job.
    obstacles: [
      ...data.deviations.rows.filter((row) => row.reportable && !row.overdue).map((row) => ({ key: `dev:${row.id}`, order: "0", node: <Row key={`dev:${row.id}`} columns
        row={{ id: row.id, title: row.title, href: row.href, detail: [row.label, row.responsibleName ?? "Ingen ansvarig"].join(" · ") }}
        area="tools" icon={OctagonAlert} meta={<Progression kind="DEVIATION" status={row.status} />} pill={<Pill tone="danger" className="whitespace-nowrap">{REPORTABLE_LABEL}</Pill>}
        action={open(row.href, `Åtgärda ${row.title}`, "Åtgärda")} /> })),
      ...(data.needsAction?.rows ?? []).map((row) => ({ key: `job:${row.id}`, order: "1", node: <Row key={`job:${row.id}`} columns
        row={{ id: row.id, title: row.title, href: row.href, detail: [row.obstacle ?? "", row.customerName].filter(Boolean).join(" · ") }}
        area={job(row).area} icon={job(row).icon} meta={<Progression kind={row.kind} status={row.status} progress={row.progress} />}
        pill={<Pill tone="warning" className="whitespace-nowrap">{row.obstacle ? "Hinder" : "Behöver åtgärdas"}</Pill>}
        action={open(row.href, `Åtgärda ${row.title}`, "Åtgärda")} /> })),
    ],
    // Månadens tid (användartest 2026-10-31, F5): a month sent in waits for one of those who see Teamet.
    approvals: (data.pendingTime?.rows ?? []).map((row) => ({ key: `time:${row.userId}:${row.period}`, order: row.submittedAt ?? "", node: <Row key={`time:${row.userId}:${row.period}`} columns
      row={{ id: `${row.userId}:${row.period}`, title: `${row.name} · ${periodLabel(row.period)}`, href: data.pendingTime!.href, detail: row.submittedAt ? `Inskickad ${day(swedishDayKey(new Date(row.submittedAt)))}` : "Inskickad" }}
      area="time" icon={Clock3} pill={<Pill tone="warning" className="whitespace-nowrap">Tid att godkänna</Pill>}
      action={<Button asChild size="sm" variant="outline"><Link href={data.pendingTime!.href} aria-label={`Granska tiden för ${row.name}`} data-testid="team-pending-time">Granska</Link></Button>} /> })),
    // The earliest end date first, jobs and deviations together.
    overdue: [
      ...(data.overdueJobs?.rows ?? []).map((row) => ({ key: `late:${row.id}`, order: row.dueDate, node: <Row key={`late:${row.id}`} columns
        row={{ id: row.id, title: row.title, href: row.href, late: true, detail: [row.customerName, row.responsibleName ?? "Ingen ansvarig", `${LATE_STATE_LABEL.overdue} ${day(row.dueDate)}`].filter(Boolean).join(" · ") }}
        area={job(row).area} icon={job(row).icon} meta={<Progression kind={row.kind} status={row.status} progress={row.progress} />}
        pill={<Pill tone="danger" className="whitespace-nowrap">{LATE_STATE_LABEL.overdue}</Pill>} /> })),
      ...data.deviations.rows.filter((row) => row.overdue).map((row) => ({ key: `dev:${row.id}`, order: row.dueDate, node: <Row key={`dev:${row.id}`} columns
        row={{ id: row.id, title: row.title, href: row.href, late: true, detail: [row.label, row.responsibleName ?? "Ingen ansvarig", row.dueDate ? `${LATE_STATE_LABEL.overdue} ${day(row.dueDate)}` : ""].filter(Boolean).join(" · ") }}
        area="tools" icon={OctagonAlert} meta={<Progression kind="DEVIATION" status={row.status} />} pill={<Pill tone="danger" className="whitespace-nowrap">{row.reportable ? REPORTABLE_LABEL : LATE_STATE_LABEL.overdue}</Pill>}
        action={open(row.href, `Åtgärda ${row.title}`, "Åtgärda")} /> })),
    ],
    // What should have started first, then a risk step before a coming start, then work without an owner or a booking.
    notStarted: [
      ...(data.lateStarts?.rows ?? []).map((row) => ({ key: `start:${row.id}`, order: `0${row.plannedStartDate ?? ""}`, node: <Row key={`start:${row.id}`} columns
        row={{ id: row.id, title: row.title, href: row.href, detail: [row.customerName, row.responsibleName ?? "Ingen ansvarig", `Skulle starta ${day(row.plannedStartDate)}`].filter(Boolean).join(" · ") }}
        area={job(row).area} icon={job(row).icon} meta={<Progression kind={row.kind} status={row.status} progress={row.progress} />}
        pill={<Pill tone="warning" className="whitespace-nowrap">{LATE_STATE_LABEL.late_start}</Pill>} /> })),
      ...(data.riskBeforeStart?.rows ?? []).filter((row) => !row.late).map((row) => ({ key: `risk:${row.id}`, order: `1${row.plannedStartDate}`, node: <Row key={`risk:${row.id}`} columns
        row={{ id: row.id, title: row.title, href: row.href, detail: [row.customerName, `Startar ${day(row.plannedStartDate)}`].filter(Boolean).join(" · ") }}
        area="risk" icon={ShieldAlert} meta={<Progression kind="WORK_ORDER" status={row.status} progress={0} />} pill={<Pill tone="warning" className="whitespace-nowrap">Riskbedömning</Pill>} /> })),
      // Arbete utan ägare (punkt 2): no responsible person, or starting within a week without a booking.
      ...(data.unowned?.rows ?? []).map((row) => ({ key: `unowned:${row.id}`, order: `2${row.day}`, node: <Row key={`unowned:${row.id}`} columns
        row={{ id: row.id, title: row.title, href: row.href, detail: [row.customerName, row.day ? (row.reason === "no-booking" ? `Startar ${day(row.day)}` : `Klart senast ${day(row.day)}`) : ""].filter(Boolean).join(" · ") }}
        area="work-order" icon={row.reason === "no-owner" ? UserX : CalendarX} pill={<Pill tone="warning" className="whitespace-nowrap">{row.reason === "no-owner" ? "Ingen ansvarig" : "Ej bokad"}</Pill>}
        // Boka opens the form with the job filled in (2026-11-02); without the right to book the row opens the job.
        action={row.reason === "no-booking" && row.canBook ? open(subPage(bookJobHref(row.id)), `Boka ${row.title}`, "Boka")
          : row.reason === "no-booking" ? undefined : open(row.href, `Välj ansvarig för ${row.title}`)} /> })),
    ],
  };
  const riskComing = data.riskBeforeStart?.coming ?? data.riskBeforeStart?.total ?? 0;
  // A figure with a list of its own: the list holds exactly what the figure counts.
  const links: Partial<Record<TeamGroup, ReactNode>> = {
    obstacles: data.needsAction?.total && data.needsAction.href ? <CountLink href={data.needsAction.href} count={data.needsAction.total} testId="team-link-obstacles">jobb</CountLink> : null,
    approvals: data.pendingTime?.total ? <CountLink href={data.pendingTime.href} count={data.pendingTime.total} testId="team-link-approvals">{data.pendingTime.total === 1 ? "månad" : "månader"}</CountLink> : null,
    overdue: <>
      {data.overdueJobs?.total ? <CountLink href={data.overdueJobs.href} count={data.overdueJobs.total} tone="danger" testId="team-link-overdue-jobs">jobb</CountLink> : null}
      {data.deviations.counts.overdue ? <CountLink href={data.deviations.links.overdue} count={data.deviations.counts.overdue} tone="danger" testId="team-link-overdue-deviations">{data.deviations.counts.overdue === 1 ? "avvikelse" : "avvikelser"}</CountLink> : null}
      {data.rounds?.late ? <CountLink href={data.rounds.href} count={data.rounds.late} tone="danger" testId="team-link-overdue-rounds">rondtillfällen</CountLink> : null}
    </>,
    // The parts of Ej startat side by side, so they add up to the figure (resa 4, 2026-11-06: "425 försenad start" beside 682).
    notStarted: <>
      {data.lateStarts?.total ? <CountLink href={data.lateStarts.href} count={data.lateStarts.total} testId="team-link-late-starts">försenad start</CountLink> : null}
      {riskComing ? <CountText count={riskComing} testId="team-count-risk-before-start">riskbedömning före start</CountText> : null}
      {data.unowned?.total ? <CountText count={data.unowned.total} testId="team-count-unowned">utan ansvarig eller bokning</CountText> : null}
    </>,
  };
  // A won quote without a work order: apart, never in the figure – only those with the quotes right see it (K4).
  const wonQuotes = data.acceptedQuotes?.total ? <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="team-won-quotes"><FileSignature className="size-3.5" aria-hidden="true" />
    <Link href={data.acceptedQuotes.href} className="hover:text-primary hover:underline">Vunna offerter utan arbetsorder: <span className="font-semibold tabular-nums">{data.acceptedQuotes.total}</span></Link></p> : null;
  const withRows = TEAM_GROUPS.filter((group) => rows[group].length);
  const calm = TEAM_GROUPS.filter((group) => !rows[group].length);
  // One card per group, so each stands out (2026-11-02; they shared one big card). A group with nothing to show is one line in a card of its own at the end.
  return <div id="att-folja-upp" className={cn("grid min-w-0 scroll-mt-6 content-start", BOX_GAP)} data-testid="team-groups">
    {withRows.map((group) => {
      const { icon, tone } = GROUP_LOOK[group];
      const sorted = [...rows[group]].sort((x, y) => x.order.localeCompare(y.order));
      const shown = expanded[group] ? sorted : sorted.slice(0, limit);
      return <div key={group} id={`team-group-${group}`} className="min-w-0 scroll-mt-6" data-testid={`team-group-${group}`}>
        <Box title={TEAM_GROUP_TITLE[group]} area="work-order" icon={icon} action={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex flex-wrap items-baseline gap-x-3">{links[group]}</span>
          <Pill tone={counts[group] ? tone : "neutral"} className="min-w-7 justify-center tabular-nums" data-testid={`team-group-count-${group}`}>{counts[group]}</Pill>
        </span>}>
          <RowList testId={`team-group-rows-${group}`}>{shown.map((row) => row.node)}</RowList>
          {sorted.length > limit ? <Button type="button" size="sm" variant="ghost" className="mt-1" aria-expanded={Boolean(expanded[group])} onClick={() => setExpanded((current) => ({ ...current, [group]: !current[group] }))}>{expanded[group] ? "Visa färre" : `Visa ${sorted.length - limit} till`}</Button> : null}
          {/* Always the true total, so "Visa 9 till" is never read as all there is (resa 4, 2026-11-06). */}
          <MoreNote shown={shown.length} total={counts[group]} />
          {group === "notStarted" ? wonQuotes : null}
        </Box>
      </div>;
    })}
    {calm.length ? <Box label="Inget just nu" className="py-3">
      <ul className="flex flex-wrap gap-x-6 gap-y-2">{calm.map((group) => {
        const { icon: Icon } = GROUP_LOOK[group];
        return <li key={group} id={`team-group-${group}`} className="flex scroll-mt-6 items-center gap-2 text-sm font-medium" data-testid={`team-group-${group}`}>
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />{TEAM_GROUP_TITLE[group]}
          <Pill tone="neutral" className="min-w-7 justify-center tabular-nums" data-testid={`team-group-count-${group}`}>{counts[group]}</Pill>
          <span className="flex flex-wrap items-baseline gap-x-3">{links[group]}</span>
          {group === "notStarted" ? wonQuotes : null}
        </li>;
      })}</ul>
    </Box> : null}
  </div>;
}

/** Nya felanmälningar (användartest 2026-10-31, TE12): an operator's fault report nobody has taken; the bell's rule. Only when there is any. */
function FaultReports({ rows }: { rows: NonNullable<TeamTabData["faultReports"]>["rows"] }) {
  return <Box title="Nya felanmälningar" area="work-order" icon={Wrench} anchor="felanmalningar"
    action={<span className="text-xs font-medium tabular-nums text-muted-foreground" data-testid="team-fault-count">{rows.length}</span>}>
    <RowList testId="team-fault-reports">{rows.map((row) => <Row key={row.id} columns pillColumn={false} area="work-order" icon={Wrench} row={{ id: row.id, title: row.title, href: row.href, detail: row.detail }} />)}</RowList>
  </Box>;
}

type Tone = "danger" | "warning" | "success";

/**
 * Tidrapportering (punkt 1, 2026-10-29): who lacks reported time on the past workdays, against their ordinary day
 * (away time counted off) – the same slack as Jag's "Mån saknar 6,5 h". Each row shows how far the person has come.
 */
function TimeGaps({ data }: { data: NonNullable<TeamTabData["timeGaps"]> }) {
  const range = data.days.length ? `${day(data.days[0])}–${day(data.days[data.days.length - 1])}` : "";
  return <Box title="Tidrapportering" area="time" icon={Clock3} anchor="tidrapport" className="h-full"
    action={<Button asChild size="sm" variant="ghost"><Link href={data.href}>Tid</Link></Button>}>
    {data.rows.length ? <RowList testId="team-time-gaps">{data.rows.map((row) => <Row key={row.userId} columns pillColumn={false} area="time" icon={Clock3}
      row={{ id: row.userId, title: row.name, href: data.href, late: true, detail: `Saknar ${hours(row.missingMinutes)} · ${row.days.map((item) => item.label).join(", ")}` }}
      meta={<>
        {/* The pill says the state, not the bar's word (kundresa 2026-11-07, L56: "Rapporterat" beside "Saknar 40 h"). */}
        <Pill tone="warning" className="min-w-[5.5rem] shrink-0 justify-center">{row.reportedMinutes ? "Delvis" : "Inget"}</Pill>
        <GrowBar value={row.reportedMinutes} max={Math.max(1, row.expectedMinutes)} className="hidden h-1.5 min-w-8 max-w-28 grow basis-8 @[13rem]/meta:block" fill="bg-primary" />
        <span className="shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums text-muted-foreground">{hours(row.reportedMinutes)} av {hours(row.expectedMinutes)}</span>
      </>} />)}</RowList>
      : <Calm text={`Alla har rapporterat sin tid ${range}`} />}
  </Box>;
}

const EXPIRING_ICON = { credential: GraduationCap, licence: IdCard, instrument: Gauge } as const;
/**
 * Behörigheter och instrument (punkt 3): trainings and driving licences on the competence cards (admins only) and instruments
 * whose calibration is due, within 30 days – what has already run out first, in red.
 */
function Expiring({ data }: { data: NonNullable<TeamTabData["expiring"]> }) {
  return <Box title={data.scope === "all" ? "Behörigheter och instrument" : "Instrument"} area="tools" icon={BadgeCheck} anchor="behorigheter" className="h-full">
    {data.rows.length ? <RowList testId="team-expiring">{data.rows.map((row) => <Row key={row.id} columns pillColumn={false} area={row.kind === "instrument" ? "instrument" : "tools"} icon={EXPIRING_ICON[row.kind]}
      row={{ id: row.id, title: row.title, href: row.href, late: row.overdue,
        detail: [row.personName, row.kind === "instrument" ? "Kalibrering" : row.kind === "licence" ? "Körkort" : "Utbildning", row.overdue ? `gick ut ${day(row.date)}` : `går ut ${day(row.date)} (${row.days} ${row.days === 1 ? "dag" : "dagar"})`].filter(Boolean).join(" · ") }} />)}</RowList>
      : <Calm text="Inget går ut de närmaste 30 dagarna" />}
  </Box>;
}

const REASON_PILL: Record<"overdue" | "overBudget" | "readyToClose", { label: string; tone: Tone }> = { // the words and tone of each reason
  overdue: { label: "Förfallet", tone: "danger" }, overBudget: { label: "Över budget", tone: "danger" }, readyToClose: { label: "Klart att avsluta", tone: "success" },
};

/**
 * Projektläge (Jag's rows, 2026-10-29: "även projektläge skall ha progression"): the ongoing projects in the head; the
 * projects that need attention as rows – status, how far they have come (the share of färdigställda jobs) and why they are
 * here – each opening its project; the jobs marked Behöver åtgärdas as one row to their list.
 */
function Projects({ data }: { data: NonNullable<TeamTabData["projects"]> }) {
  const list = data.list?.rows ?? [];
  return <Box title="Projektläge" area="project" icon={FolderKanban} anchor="projektlage" className="h-full"
    action={<CountLink href={data.links.ongoing} count={data.ongoing} testId="team-projects-ongoing">pågående</CountLink>}>
    {list.length || data.needsActionJobs ? <RowList testId="team-project-rows">
      {list.map((row) => { return <Row key={row.id} columns pillColumn={false} area="project" icon={FolderKanban}
        // Why the project is here leads the line, red when it is late or over budget (as Jag's Förfallet); the progression stays short.
        row={{ id: row.id, title: row.name, href: row.href, late: row.reasons.some((item) => item !== "readyToClose"),
          detail: [...row.reasons.map((item) => REASON_PILL[item].label), row.customerName, row.dueDate ? `Slut ${day(row.dueDate)}` : "", row.budgetMinutes ? `${hours(row.reportedMinutes)} av ${hours(row.budgetMinutes)}` : ""].filter(Boolean).join(" · ") }}
        meta={<Progression kind="PROJECT" status={row.state} progress={row.completion} />} />; })}
      {data.needsActionJobs ? <Row columns pillColumn={false} area="work-order" icon={ListChecks}
        row={{ id: "needs-action", title: "Arbetsordrar som behöver åtgärdas", detail: "Markerade Behöver åtgärdas i projekten", href: data.links.needsAction }}
        action={<Pill tone="warning" className="min-w-10 justify-center tabular-nums">{data.needsActionJobs}</Pill>} /> : null}
    </RowList> : <Calm text="Inga projekt kräver uppmärksamhet" />}
    {data.list && data.list.total > list.length ? <MoreNote shown={list.length} total={data.list.total} /> : null}
  </Box>;
}

/** Avvikelser (Jag's Mina avvikelser): the counts in the head, the open entries as rows with their steps and Åtgärda. */
function Deviations({ data, level }: { data: TeamTabData["deviations"]; level: Level }) {
  const rows = data.rows.slice(0, rowLimit(level));
  const notes = [data.counts.withoutResponsible ? `${data.counts.withoutResponsible} utan ansvarig` : "", data.counts.systematic ? `${data.counts.systematic} systematisk${data.counts.systematic === 1 ? "" : "a"}` : ""].filter(Boolean);
  return <Box title="Avvikelser" area="tools" icon={OctagonAlert} anchor="avvikelser" className="h-full"
    action={<span className="flex flex-wrap items-baseline gap-x-3">
      <CountLink href={data.links.open} count={data.counts.open} testId="team-deviations-open">öppna</CountLink>
      <CountLink href={data.links.overdue} count={data.counts.overdue} tone="danger">förfallna</CountLink>
    </span>}>
    {notes.length || data.scope === "own" ? <p className="mb-3 text-xs text-muted-foreground">{[data.scope === "own" ? "Avvikelser som du har rapporterat eller ansvarar för" : "", ...notes].filter(Boolean).join(" · ")}</p> : null}
    {rows.length ? <RowList testId="team-deviation-rows">
      {rows.map((row) => <Row key={row.id} columns pillColumn={false} area="tools" icon={OctagonAlert}
        row={{ id: row.id, title: row.title, href: row.href, late: row.overdue,
          detail: [row.label, row.responsibleName ?? "Ingen ansvarig", row.dueDate ? (row.overdue ? `Förfallen ${day(row.dueDate)}` : `Klart senast ${day(row.dueDate)}`) : "", `${row.ageDays} ${row.ageDays === 1 ? "dag" : "dagar"}`].filter(Boolean).join(" · ") }}
        meta={<><Progression kind="DEVIATION" status={row.status} />{row.reportable ? <span className="flex shrink-0" data-testid="team-deviation-reportable"><Pill tone="danger" className="whitespace-nowrap">{REPORTABLE_LABEL}</Pill></span> : null}</>}
        action={<Button asChild size="sm" variant="outline"><Link href={row.href} aria-label={`Åtgärda ${row.title}`}>Åtgärda</Link></Button>} />)}
    </RowList> : <Calm text="Inga öppna avvikelser" />}
  </Box>;
}

/** A cell's tone by how full it is: amber near the limit, red over it. */
const loadTone = (planned: number, capacity: number) => { const share = capacity ? planned / capacity : planned ? 2 : 0; return share > 1 ? "danger" : share > 0.9 ? "warning" : "info"; };

/**
 * Belastning: the week on top as on Jag's Tid card (Vecka 44 · dates, planned against the working time and its line), then per
 * person this week's workdays and the week's total and next week's – Planering's calculation. Where the card is narrow the
 * days give way to the totals.
 */
function Load({ data, level, absenceCounted }: { data: TeamTabData["load"]; level: Level; absenceCounted: boolean }) {
  const planned = data.people.reduce((sum, person) => sum + (person.weeks[0]?.plannedMinutes ?? 0), 0);
  const capacity = data.people.reduce((sum, person) => sum + (person.weeks[0]?.capacityMinutes ?? 0), 0);
  // Overbooked per week, so the line and its words say which week (2026-10-29: next week's holiday made "1 person" look like now).
  const overIn = (index: number) => data.people.filter((person) => (person.weeks[index]?.plannedMinutes ?? 0) > (person.weeks[index]?.capacityMinutes ?? 0)).length;
  const overThis = overIn(0), overNext = overIn(1);
  const days = data.days ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const week = data.weeks[0];
  return <Box title="Belastning" area="calendar" icon={Users} anchor="belastning"
    action={<Button asChild size="sm" variant="ghost"><Link href={data.href}>Kapacitet</Link></Button>}>
    {week ? <section aria-label="Veckan" data-testid="team-load-week">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
        <h3 className="font-semibold">Vecka {week.week} <span className="font-normal text-muted-foreground">· {day(week.startsOn)}–{day(week.endsOn)}</span></h3>
        <span className="tabular-nums text-muted-foreground" title="Bara bokade tider räknas, inte arbetsordrar utan bokning."><span className="font-semibold text-foreground">{hours(planned)}</span> av {hours(capacity)} bokat</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={cn("h-full rounded-full", planned > capacity ? indicatorBar("danger") : "bg-primary")} style={{ width: `${Math.min(100, capacity ? (planned / capacity) * 100 : 0)}%` }} /></div>
      {overThis || overNext ? <p className={cn("mt-1 text-xs font-medium", indicatorText(overThis ? "danger" : "warning"))}>{[overThis ? `${overThis} överbokad${overThis === 1 ? "" : "e"} v. ${week.week}` : "", overNext && data.weeks[1] ? `${overNext} överbokad${overNext === 1 ? "" : "e"} v. ${data.weeks[1].week}` : ""].filter(Boolean).join(" · ")}</p> : null}
    </section> : null}
    {data.people.length ? <div className="@container/load mt-5" data-testid="team-load">
      <div className="hidden grid-cols-[minmax(9rem,1.4fr)_repeat(5,minmax(0,1fr))_6.5rem_6.5rem] gap-2 pb-1 text-[11px] font-medium text-muted-foreground @xl/load:grid" aria-hidden="true">
        <span />{days.map((date, index) => <span key={date} className={cn("text-center", date === today && "text-primary")}>{DAY_SHORT[index]} {Number(date.slice(8))}</span>)}
        <span className="text-right">v. {data.weeks[0]?.week}</span><span className="text-right">{data.weeks[1] ? `v. ${data.weeks[1].week}` : ""}</span>
      </div>
      <ul className="space-y-2" aria-label="Planerad tid per person">
        {data.people.map((person) => {
          const current = person.weeks[0], next = person.weeks[1];
          return <li key={person.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2 @xl/load:grid-cols-[minmax(9rem,1.4fr)_repeat(5,minmax(0,1fr))_6.5rem_6.5rem]" data-testid="team-load-person">
            <span className="flex min-w-0 items-center gap-2"><Avatar personKey={person.id} name={person.name} size="sm" /><span className="truncate text-sm font-medium">{person.name}</span></span>
            {(person.days ?? []).map((cell, index) => cell.absent ? <span key={days[index] ?? index} className="hidden flex-col gap-1 @xl/load:flex" data-testid="team-load-absent"
              title={`${DAY_SHORT[index]}: ${cell.absent}${cell.plannedMinutes ? ` – ${hours(cell.plannedMinutes)} är fortfarande bokat` : ""}`}>
              {/* An absent day says why; work still booked on it is red, so the clash is seen (Frånvaro, 2026-10-29). */}
              <span className={cn("h-1.5 rounded-full ring-1", cell.plannedMinutes ? "bg-[repeating-linear-gradient(135deg,var(--destructive)_0_4px,transparent_4px_8px)] ring-[var(--destructive)]" : "bg-[repeating-linear-gradient(135deg,var(--muted)_0_4px,transparent_4px_8px)] ring-border")} />
              <span className={cn("truncate text-center text-[11px] font-medium", cell.plannedMinutes ? indicatorText("danger") : "text-muted-foreground")}>{cell.absent}{cell.plannedMinutes ? ` · ${hours(cell.plannedMinutes)}` : ""}</span>
            </span> : <span key={days[index] ?? index} className="hidden flex-col gap-1 @xl/load:flex" title={`${DAY_SHORT[index]}: ${hours(cell.plannedMinutes)} av ${hours(cell.capacityMinutes)}`}>
              <GrowBar value={cell.plannedMinutes} max={Math.max(1, cell.capacityMinutes * 1.25)} fill={indicatorBar(loadTone(cell.plannedMinutes, cell.capacityMinutes))} className="h-1.5" />
              <span className={cn("text-center text-[11px] tabular-nums", cell.plannedMinutes > cell.capacityMinutes ? cn("font-semibold", indicatorText("danger")) : "text-muted-foreground")}>{cell.plannedMinutes ? hours(cell.plannedMinutes) : "–"}</span>
            </span>)}
            {/* Booked on days away is a clash, said under the week's total (användartest 2026-10-31, K7). */}
            {current ? <span className={cn("flex flex-col items-end whitespace-nowrap text-right text-xs tabular-nums", current.plannedMinutes > current.capacityMinutes ? cn("font-semibold", indicatorText("danger")) : "text-foreground")}>
              <span>{hours(current.plannedMinutes)} / {hours(current.capacityMinutes)}</span>
              {person.conflictMinutes ? <span className={cn("text-[11px] font-semibold", indicatorText("danger"))} data-testid="team-load-conflict" title="Bokat på dagar då personen är frånvarande">Krock {hours(person.conflictMinutes)}</span> : null}
            </span> : <span />}
            {level === 3 && next ? <span className={cn("hidden whitespace-nowrap text-right text-xs tabular-nums @xl/load:block", next.plannedMinutes > next.capacityMinutes ? cn("font-semibold", indicatorText("danger")) : "text-muted-foreground")}>{hours(next.plannedMinutes)} / {hours(next.capacityMinutes)}</span> : <span className="hidden @xl/load:block" />}
          </li>;
        })}
      </ul>
    </div> : <div className="mt-4"><Calm text="Teamet har inga aktiva medlemmar" /></div>}
    <SrTable caption="Planerad tid per person och vecka" head={["Person", ...data.weeks.map((item) => `Vecka ${item.week}`)]}
      rows={data.people.map((person) => [person.name, ...person.weeks.map((item) => `${hours(item.plannedMinutes)} av ${hours(item.capacityMinutes)}`)])} />
    {/* Absence lowers the capacity when the Tid module is on (lib/overview/team-server.ts); without it the figures say so. */}
    {absenceCounted ? null : <p className="mt-4 text-xs text-muted-foreground">Frånvaro räknas inte här, eftersom Tid är av för företaget.</p>}
  </Box>;
}

/** Ronder och säkerhet (Jag's rows): rounds not done and safety checks whose conditions changed – shown only when there is any. */
function RoundsSafety({ rounds, safety, level }: { rounds: TeamTabData["rounds"]; safety: TeamTabData["safety"]; level: Level }) {
  return <Box title="Ronder och säkerhet" area="round" icon={RotateCcw}>
    <RowList testId="team-rounds-safety">
      {/* Försenade like Driftronder counts them (kundresa 2026-11-07, M28: "Alla ronder är utförda" while 88 were missed). */}
      {rounds?.late ? <Row columns pillColumn={false} area="round" icon={RotateCcw} row={{ id: "late", title: "Försenade rondtillfällen", detail: "Inte utförda i tid", href: rounds.href, late: true }}
        action={<Pill tone="danger" className="min-w-10 justify-center tabular-nums" data-testid="team-rounds-late">{rounds.late}</Pill>} /> : null}
      {rounds?.notDone ? <Row columns pillColumn={false} area="round" icon={RotateCcw} row={{ id: "not-done", title: "Ej utförda rondtillfällen", detail: "Senaste 30 dagarna", href: rounds.href, late: true }}
        action={<Pill tone="warning" className="min-w-10 justify-center tabular-nums" data-testid="team-rounds-not-done">{rounds.notDone}</Pill>} /> : null}
      {(safety?.rows ?? []).slice(0, rowLimit(level)).map((row) => <Row key={row.id} columns pillColumn={false} area="risk" icon={ShieldCheck}
        row={{ id: row.id, title: row.title, detail: `Ändrade förutsättningar · avstämd ${day(row.checkedOn)}`, href: row.href }}
        action={row.workOrderHref ? <Button asChild size="sm" variant="outline"><Link href={row.workOrderHref}>Arbetsorder</Link></Button> : undefined} />)}
    </RowList>
  </Box>;
}

export function TeamTab({ data, level, onChanged }: { data: TeamTabData | null; level: Level; onChanged?: () => void }) {
  const [handling, setHandling] = useState<TeamAffectedRow | null>(null);
  const planningOn = useModuleOn("planning");
  if (!data) return <TabSkeleton label="Hämtar Teamet…" heights={ROWS_SKELETON} testId="overview-team-skeleton" />;
  // Rounds and safety with nothing in them are one calm line, last (as Jag's empty boxes).
  const roundsBusy = Boolean(data.rounds?.notDone || data.rounds?.late);
  const safetyBusy = Boolean(data.safety?.changed) && level === 3;
  const calm = [data.rounds && !roundsBusy ? "Alla ronder är utförda" : "", data.safety && !data.safety.changed ? "Inga ändrade förutsättningar på ronderna" : ""].filter(Boolean);
  return <div className={cn("grid", BOX_GAP)} data-testid="overview-team">
    <TeamHeadline data={data} />
    {/* Jag's rows (2026-10-29): Just nu | Att följa upp as Tid | Gör detta nu, then the lists in halves, the load last. */}
    {/* Half and half, each column a stack (2026-11-02). */}
    <Columns testId="team-row-1"
      left={<>
        {data.now ? <NowCard key="now" data={data.now} absence={data.absence} onChanged={onChanged} /> : null}
        {data.projects ? <Projects key="projects" data={data.projects} /> : null}
        {data.timeGaps ? <TimeGaps key="time" data={data.timeGaps} /> : null}
        {data.expiring ? <Expiring key="expiring" data={data.expiring} /> : null}
      </>}
      right={<>
        {data.faultReports?.rows.length ? <FaultReports key="faults" rows={data.faultReports.rows} /> : null}
        <FollowUp key="follow-up" data={data} level={level} onHandle={setHandling} />
        <Deviations key="deviations" data={data.deviations} level={level} />
      </>} />
    <HandleAbsenceDialog row={handling} onOpenChange={(open) => { if (!open) setHandling(null); }} onDone={() => onChanged?.()} />
    {/* Företagets moduler (0.39.0): without Planering there is no load to show. */}
    {planningOn ? <Load data={data.load} level={level} absenceCounted={Boolean(data.absence)} /> : null}
    {roundsBusy || safetyBusy ? <RoundsSafety rounds={roundsBusy ? data.rounds : null} safety={safetyBusy ? data.safety : null} level={level} /> : null}
    {calm.length ? <div className="app-panel rounded-lg border bg-card p-3" data-testid="team-calm"><EmptyNote compact icon={CircleCheck} title={`${calm.join(" · ")} (30 dagar)`} /></div> : null}
  </div>;
}
