"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, ChevronLeft, ChevronRight, FolderKanban, Pencil, Repeat, Trash2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListEmpty, ListFact, ListGroup, ListRow, NativeActions, NativePage, NativeSegmented, useNativeTopBar } from "@/components/native";
import { returnToWork, useEntryState } from "@/components/history-nav";
import { useReturnTo } from "@/features/kfid/use-return-to";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { roundTimeText } from "@/lib/workflow/form-schedule";
import { withScreen } from "@/lib/workflow/native-mode";
import { planningWeekByPerson, planningWeekOf, shiftPlanningWeek } from "@/lib/workflow/native-planning";
import { PLANNING_ROUND_STATE_LABEL, type PlanningRound } from "@/lib/workflow/planning-rounds";
import { TASK_CANCEL_LABEL } from "@/lib/workflow/task-cancel";
import { VIEW_LABEL } from "@/lib/workflow/navigation";
import type { IndicatorTone } from "./indicator-tone";
import { IconButton } from "@/components/ui/icon-button";

/**
 * Planering på nivå 1 (2026-10-09, docs/ui-system.md 9): the week as a list per person instead of the calendar
 * grid – ‹ Vecka 41 ›, Mina/Alla, a group per person with the bookings and rounds day by day. A booking opens its own
 * screen (time, job, project, people) with Öppna jobbet and, for whoever may change it, Redigera and Ta bort; Ny planering
 * and Redigera are the page's own form on a screen of their own with Avbryt/Spara in the top bar (`&step=`). The rules
 * are in lib/workflow/native-planning.ts; what may be changed is decided by the page (canEdit) and the server.
 */
export type NativePlanningActivity = {
  id: string; title: string; description: string; kind: string; status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  startsAt: string; endsAt: string; projectId: string | null; workflowTaskId: string | null;
  assignedToUserIds: string[]; assignedToName: string; deletedAt?: string | null;
};

const STATUS: Record<NativePlanningActivity["status"], { label: string; tone: IndicatorTone } | null> = {
  // A cancelled booking says Utgår, the job's word (plan 1C, 2026-10-11); the stored value CANCELED is unchanged.
  PLANNED: null, IN_PROGRESS: { label: "Pågår", tone: "warning" }, COMPLETED: { label: "Slutförd", tone: "success" }, CANCELED: { label: TASK_CANCEL_LABEL, tone: "neutral" },
};
const KIND: Record<string, string> = { TASK: "Arbete", MEETING: "Möte", DEADLINE: "Milstolpe", OTHER: "Övrigt" };
const roundTone = (state: PlanningRound["state"]): IndicatorTone => state === "done" ? "success" : state === "missed" ? "danger" : state === "started" || state === "due" ? "warning" : "neutral";
const time = (iso: string) => formatSwedish(iso, { hour: "2-digit", minute: "2-digit" });
const dayLabel = (day: string) => formatSwedish(`${day}T12:00:00`, { weekday: "short", day: "numeric", month: "short" });
const SCREENS = ["ny", "aktivitet", "redigera"] as const;

export function NativePlanning<A extends NativePlanningActivity>({ canReadProjects = true, canReadRounds = true, activities, rounds, members, currentUserId, canCreate, canEdit, projectName, jobHref, onRange, onShownDays, form, onDelete }: {
  /** Driftronder (under Mer) only for someone who may read rounds (lib/workflow/permissions.ts canReadRounds). */
  canReadRounds?: boolean;
  /** Mina projekt is offered only to someone who may read projects. */
  canReadProjects?: boolean;
  activities: A[];
  rounds: PlanningRound[];
  members: { id: string; name: string }[];
  currentUserId: string;
  canCreate: boolean;
  canEdit: (activity: A) => boolean;
  projectName: (activity: A) => string;
  /** The booked job's address when the person may read it. */
  jobHref: (activity: A) => string | null;
  /** Cloud reads the planning by period: the shown week ± one week. */
  onRange?: (from: string, to: string) => void;
  /** The rounds are computed for the shown days. */
  onShownDays?: (update: (current: { from: string; to: string } | null) => { from: string; to: string } | null) => void;
  /** The page's own form: a new booking (null) or a change; `close` after saving or Avbryt. */
  form: (activity: A | null, close: () => void) => ReactNode;
  /** Ta bort asks first (the page's own small dialog). */
  onDelete: (activity: A) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const step = (SCREENS as readonly string[]).includes(params.get("step") ?? "") ? params.get("step") as (typeof SCREENS)[number] : null;
  const today = swedishDayKey(new Date());
  const [anchor, setAnchor] = useEntryState("planning.nativeWeek", today);
  const [scope, setScope] = useEntryState<"all" | "mine">("planning.nativeScope", "all");
  const week = useMemo(() => planningWeekOf(anchor), [anchor]);
  useEffect(() => { onRange?.(shiftPlanningWeek(week.from, -1), shiftPlanningWeek(week.to, 1)); }, [week.from, week.to, onRange]);
  useEffect(() => { onShownDays?.((current) => current?.from === week.from && current.to === week.to ? current : { from: week.from, to: week.to }); }, [week.from, week.to, onShownDays]);
  const shown = activities.filter((activity) => !activity.deletedAt);
  const people = planningWeekByPerson(shown, rounds, week, members, currentUserId)
    .filter((group) => scope === "all" || group.me);
  const open = shown.find((activity) => activity.id === params.get("activity")) ?? null;
  const href = (to: string | null, activity?: string) => {
    const next = new URLSearchParams(withScreen(params.toString(), to).slice(2));
    if (activity) next.set("activity", activity); else next.delete("activity");
    // Boka's address (2026-11-02) does not stay behind, so a later Ny planering does not fill in the old job.
    next.delete("new"); next.delete("bookTaskId");
    return `/?${next.toString()}`;
  };
  // Bakåt is a step back when the list is where the person came from, so the list keeps its place.
  const close = () => returnToWork(href(null), (address) => router.push(address));
  // A change goes back to the booking it came from; a new one to the week, or where Boka came from (the work order, Teamet).
  const way = useReturnTo();
  const closeForm = () => step === "ny" && way ? way.cancel() : returnToWork(step === "redigera" && open ? href("aktivitet", open.id) : href(null), (address) => router.push(address));
  // A booking removed on its own screen leads back to the week.
  const seen = useRef(false);
  useEffect(() => {
    if (open) { seen.current = true; return; }
    if (step === "aktivitet" && seen.current) { seen.current = false; close(); }
  });
  const box = useRef<HTMLDivElement | null>(null);
  const editing = step === "ny" || (step === "redigera" && open && canEdit(open));
  useNativeTopBar(step === "ny" || step === "redigera" ? {
    title: step === "ny" ? "Ny planering" : "Redigera planering",
    // Skapa for a new booking, as the form's own button says (simulation 0.6.3); a tap presses that button, so its reason
    // ("Ange start och slut.") is told instead of the browser's own bubble.
    ...(editing ? { cancel: { onClick: closeForm }, save: { label: step === "ny" ? "Skapa" : "Spara", onClick: () => box.current?.querySelector<HTMLButtonElement>('[data-dialog-role="primary"]')?.click() } } : {}),
  } : step === "aktivitet" ? { title: open?.title || VIEW_LABEL.planning, back: { label: VIEW_LABEL.planning } }
    // M4 (2026-10-12): the list has the top bar (title, Ny planering) and no large title of its own. It is Kalender
    // as in the menu (2026-10-13: it said Planering, the name of another page).
    : { title: VIEW_LABEL.planning, save: canCreate ? { label: "Ny planering", onClick: () => router.push(href("ny")) } : null });

  if (step === "ny" || step === "redigera") {
    if (!editing) return <NativePage><ListGroup><ListEmpty>Planeringen finns inte längre eller får inte ändras av dig.</ListEmpty></ListGroup></NativePage>;
    // The form's own buttons give way to Avbryt and Spara in the top bar.
    return <div ref={box} className="native-page native-screen pb-4 [&_.dialog-actions]:hidden" data-testid="native-planning-form">
      <div className="native-group p-4">{form(step === "ny" ? null : open, closeForm)}</div>
    </div>;
  }
  if (step === "aktivitet") {
    if (!open) return <NativePage><ListGroup><ListEmpty>Planeringen finns inte längre.</ListEmpty></ListGroup></NativePage>;
    const status = STATUS[open.status];
    const names = open.assignedToUserIds.map((id) => members.find((member) => member.id === id)?.name).filter(Boolean).join(", ") || open.assignedToName || "Ingen ansvarig";
    const job = jobHref(open);
    return <NativePage testId="native-planning-activity">
      {/* The top bar carries the booking's title (M1); the kind and status stay as one line. */}
      {[KIND[open.kind] ?? "", status?.label].filter(Boolean).length ? <p className="px-1 pb-2 pt-1 text-sm text-muted-foreground" data-testid="native-planning-kind">{[KIND[open.kind] ?? "", status?.label].filter(Boolean).join(" · ")}</p> : null}
      <ListGroup>
        <ListFact label="När">{`${dayLabel(swedishDayKey(open.startsAt))} ${time(open.startsAt)} – ${swedishDayKey(open.endsAt) === swedishDayKey(open.startsAt) ? "" : `${dayLabel(swedishDayKey(open.endsAt))} `}${time(open.endsAt)}`}</ListFact>
        <ListFact label="Vem">{names}</ListFact>
        <ListFact label="Projekt">{projectName(open)}</ListFact>
        {open.description.trim() ? <ListFact label="Beskrivning">{open.description}</ListFact> : null}
      </ListGroup>
      {job || open.projectId ? <ListGroup>
        {job ? <ListRow type="work-order" icon={ClipboardList} title="Öppna jobbet" href={job} testId="native-planning-job" /> : null}
        {open.projectId ? <ListRow type="project" icon={FolderKanban} title="Öppna projektet" href={`/?view=project&projectId=${encodeURIComponent(open.projectId)}`} /> : null}
      </ListGroup> : null}
      {canEdit(open) ? <NativeActions testId="native-planning-actions">
        <Button type="button" variant="ghost" onClick={() => router.push(href("redigera", open.id))} data-testid="native-planning-edit"><Pencil />Redigera</Button>
        <Button type="button" variant="ghost" onClick={() => onDelete(open)}><Trash2 />Ta bort planering</Button>
      </NativeActions> : null}
    </NativePage>;
  }

  const current = week.from <= today && today <= week.to;
  return <NativePage testId="native-planning">
    {/* Mina / Alla, as the work lists. */}
    <NativeSegmented label="Visa" value={scope} onChange={setScope} options={[["mine", "Mina"], ["all", "Alla"]]} testId="native-planning-scope" />
    <div className="flex items-center justify-between gap-2 py-1" data-testid="native-planning-week">
      <IconButton label="Föregående vecka" className="size-11" onClick={() => setAnchor(shiftPlanningWeek(anchor, -1))}><ChevronLeft className="size-5" /></IconButton>
      <div className="min-w-0 text-center">
        <p className="text-base font-semibold" data-testid="native-planning-week-title">Vecka {week.week}</p>
        <p className="text-xs text-muted-foreground">{formatSwedish(`${week.from}T12:00:00`, { day: "numeric", month: "short" })} – {formatSwedish(`${week.to}T12:00:00`, { day: "numeric", month: "short" })}{current ? " · denna vecka" : ""}</p>
      </div>
      <IconButton label="Nästa vecka" className="size-11" onClick={() => setAnchor(shiftPlanningWeek(anchor, 1))}><ChevronRight className="size-5" /></IconButton>
    </div>
    {current ? null : <div className="text-center"><Button type="button" variant="ghost" size="sm" className="text-primary" onClick={() => setAnchor(today)}>Till denna vecka</Button></div>}
    {people.length ? people.map((group) => <ListGroup key={group.key} title={group.me ? `${group.name} (du)` : group.name} testId="native-planning-person" alignPills>
      {group.items.map((item) => item.kind === "activity"
        ? <ListRow key={`a-${item.activity.id}`} type="time" icon={CalendarClock} title={item.activity.title || "Utan rubrik"} href={href("aktivitet", item.activity.id)} testId="native-planning-row"
          subtitle={[`${dayLabel(item.day)} ${time(item.activity.startsAt)}–${time(item.activity.endsAt)}`, projectName(item.activity)].filter(Boolean).join(" · ")}
          pill={STATUS[item.activity.status]} />
        : <ListRow key={`r-${item.round.key}`} type="round" icon={Repeat} title={item.round.title} href={item.round.href} testId="native-planning-round"
          subtitle={[dayLabel(item.day), roundTimeText({ time: item.round.time ?? undefined, durationMinutes: item.round.durationMinutes ?? undefined }), (!item.round.taskId && item.round.formNotice) || item.round.facilityName || item.round.templateName].filter(Boolean).join(" · ")}
          pill={{ label: PLANNING_ROUND_STATE_LABEL[item.round.state], tone: roundTone(item.round.state) }} />)}
    </ListGroup>) : <ListGroup><ListEmpty>{scope === "mine" ? "Du har inget planerat den här veckan." : "Inget planerat den här veckan."}</ListEmpty></ListGroup>}
    <ListGroup title="Mer">
      {canReadRounds ? <ListRow type="round" icon={Repeat} title="Driftronder" href="/?view=rounds" /> : null}
      {canReadProjects ? <ListRow type="project" icon={FolderKanban} title="Projekt" href="/?view=projects" /> : null}
    </ListGroup>
  </NativePage>;
}
