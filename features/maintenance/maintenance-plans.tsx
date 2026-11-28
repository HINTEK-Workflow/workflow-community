"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CalendarClock, ListChecks, Pencil, Play, Plus, Repeat, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { DialogActions, Field, Modal, RowsSkeleton } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { swedishDayKey } from "@/lib/swedish-time";
import { announce } from "@/lib/workflow/toast";
import { useLoadEffect } from "@/lib/use-load-effect";
import { shortDay } from "@/lib/workflow/schedule";
import { cn } from "@/lib/utils";
import { INTERVAL_MODE_HINTS, INTERVAL_MODE_LABELS, INTERVAL_MODES, PLAN_CHECKLIST_MAX, PLAN_ROUND_LEAD_DAYS, PLAN_STATE_LABELS, PLAN_STATE_TONES, PLAN_UNIT_LABELS, PLAN_UNITS, type IntervalMode, type PlanOccurrenceState, type PlanUnit } from "@/lib/maintenance/plan-model";
import { maintenanceGet, maintenancePost } from "./maintenance-api";
import { PlanFollowUpCard } from "./maintenance-follow-up";

/**
 * Planer (2026-10-30, återkommande underhåll): the part's maintenance plans – what is done and how often – with each
 * plan's coming work orders. A vilande work order shows as Vilande on its day (also in Planering → Kalender); Aktivera makes
 * it active before the day, Skjut upp gives it another day and the plan's following ones move with it. The server decides
 * every right; the rules are in lib/maintenance/plan-model.ts.
 *
 * Underhåll som ett enklare underhållssystem (2026-11-27): a plan has an instruction and a short checklist that follow
 * every occurrence, and can be done in a driftrond ("Var görs det") – then each occurrence is an item in the round's work order
 * instead of a work order of its own. Above the plans: how well the part's plans are kept (./maintenance-follow-up.tsx).
 */
type Occurrence = {
  id: string; title: string; due: string; state: PlanOccurrenceState; pinned: boolean; assignedToName: string;
  /** In a round (2026-11-27): the item, and the round's work order that holds it. */
  itemId?: string | null; workOrderId?: string | null; workOrderTitle?: string;
};
type Plan = {
  id: string; partId: string; name: string; description: string; unit: PlanUnit; every: number; intervalText: string; startDate: string; nextRunHours: number | null;
  assignedToUserId: string | null; assignedToName: string; estimatedMinutes: number | null; isActive: boolean; version: number; coming: Occurrence[]; last: Occurrence | null;
  checklist?: string[]; round?: { id: string; title: string } | null; waitingText?: string;
  /** Fast schema or Räkna från senaste utförda (2026-11-27); an older answer (the demo) may lack it. */
  intervalMode?: IntervalMode;
};
type RoundChoice = { id: string; title: string; ruleText: string; active: boolean };
type Plans = { plans: Plan[]; runHours: number | null; members: { id: string; name: string }[]; rounds?: RoundChoice[]; canEdit: boolean; canActivate: boolean };

const orderHref = (id: string) => `/?view=workflow_task&taskType=WORK_ORDER&taskId=${encodeURIComponent(id)}`;
const itemHref = (id: string) => `/?view=maintenance&item=${encodeURIComponent(id)}`;
const occurrenceHref = (occurrence: Occurrence) => occurrence.itemId ? itemHref(occurrence.itemId) : orderHref(occurrence.id);
const dayText = (day: string) => day ? `${shortDay(day)} ${day.slice(0, 4)}` : "–";
const hoursText = (value: number) => `${value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;

export function PartPlans({ partId }: { partId: string }) {
  const [data, setData] = useState<Plans | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [moving, setMoving] = useState<Occurrence | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { setData(await maintenanceGet<Plans>(`part=plans&id=${encodeURIComponent(partId)}`)); setError(""); } catch (cause) { setError((cause as Error).message); }
  }, [partId]);
  useLoadEffect(load);
  const activate = async (occurrence: Occurrence) => {
    try { await maintenancePost({ action: "activate_order", id: occurrence.id }); announce("Arbetsordern är aktiv."); await load(); } catch (cause) { announce((cause as Error).message, true); }
  };
  const remove = async (plan: Plan) => {
    if (!(await confirm({ title: `Ta bort ${plan.name}?`, message: "Planen tas bort med sina vilande arbetsordrar. En plan med historik kan inte tas bort. Pausa den i stället.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    try { await maintenancePost({ action: "delete_plan", id: plan.id }); announce("Planen togs bort."); await load(); } catch (cause) { announce((cause as Error).message, true); }
  };
  if (error) return <p role="alert" className="notice text-destructive">{error}</p>;
  if (!data) return <RowsSkeleton rows={3} label="Hämtar planerna…" />;
  const nextLine = (plan: Plan) => plan.unit === "RUN_HOURS"
    ? plan.nextRunHours !== null ? `Nästa vid ${hoursText(plan.nextRunHours)}${data.runHours !== null ? ` (nu ${hoursText(data.runHours)})` : ""}` : "Väntar på öppet tillfälle"
    : plan.coming[0] ? `Nästa ${dayText(plan.coming[0].due)}` : "";
  return <div className="space-y-3" data-testid="maintenance-plans">
    {data.plans.length ? <PlanFollowUpCard scope="part" id={partId} compact /> : null}
    {data.plans.length ? <ul className="-mx-4 divide-y border-y text-sm">{data.plans.map((plan) => <li key={plan.id} className="space-y-2 px-5 py-3" data-testid="maintenance-plan">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 basis-56">
          <span className="flex items-center gap-1.5 font-semibold"><Repeat className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{plan.name}</span></span>
          <span className="block text-xs text-muted-foreground">{[plan.intervalText, plan.unit !== "RUN_HOURS" && plan.intervalMode ? INTERVAL_MODE_LABELS[plan.intervalMode].toLowerCase() : "", nextLine(plan), plan.assignedToName ? `Ansvarig ${plan.assignedToName}` : ""].filter(Boolean).join(" · ")}</span>
          {plan.round ? <span className="mt-1 flex items-center gap-1 text-xs" data-testid="maintenance-plan-round"><Route className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />Görs i driftronden {plan.round.title}</span> : null}
          {plan.description ? <span className="mt-1 block whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{plan.description}</span> : null}
          {plan.checklist?.length ? <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" data-testid="maintenance-plan-checklist"><ListChecks className="size-3.5 shrink-0" aria-hidden="true" />Checklista med {plan.checklist.length} {plan.checklist.length === 1 ? "punkt" : "punkter"}</span> : null}
        </span>
        {plan.isActive ? null : <Badge variant="outline" className={indicatorBadge("neutral")}>Pausad</Badge>}
        {data.canEdit ? <span className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(plan)} data-testid="maintenance-plan-edit"><Pencil />Ändra</Button>
          <RemoveButton label={`Ta bort ${plan.name}`} onClick={() => void remove(plan)} />
        </span> : null}
      </div>
      {plan.waitingText ? <p className="notice text-xs" role="status" data-testid="maintenance-plan-waiting">{plan.waitingText}</p> : null}
      {plan.coming.length ? <ol className="space-y-1" aria-label={`Kommande för ${plan.name}`}>{plan.coming.slice(0, 4).map((occurrence) => <li key={occurrence.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5" data-testid="maintenance-plan-occurrence" data-state={occurrence.state}>
        <Badge variant="outline" className={cn(indicatorBadge(PLAN_STATE_TONES[occurrence.state]), occurrence.state === "dormant" && "border-dashed")}>{PLAN_STATE_LABELS[occurrence.state]}</Badge>
        <span className="tabular-nums">{dayText(occurrence.due)}</span>
        {occurrence.pinned ? <span className="text-xs text-muted-foreground">Flyttad</span> : null}
        {occurrence.itemId && occurrence.workOrderTitle ? <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">i {occurrence.workOrderTitle}</span> : null}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <Button asChild size="sm" variant="ghost"><Link href={occurrenceHref(occurrence)}>Öppna</Link></Button>
          {/* Aktivera and Skjut upp are the work order's: an occurrence in the round follows the round. */}
          {data.canActivate && !occurrence.itemId && occurrence.state === "dormant" ? <Button type="button" size="sm" variant="outline" onClick={() => void activate(occurrence)} data-testid="maintenance-plan-activate"><Play />Aktivera</Button> : null}
          {data.canActivate && !occurrence.itemId ? <Button type="button" size="sm" variant="outline" onClick={() => setMoving(occurrence)} data-testid="maintenance-plan-postpone"><CalendarClock />Skjut upp</Button> : null}
        </span>
      </li>)}</ol> : null}
      {plan.coming.length > 4 ? <p className="text-xs text-muted-foreground">{plan.coming.length - 4} till i Planering → Kalender.</p> : null}
      {plan.last ? <p className="text-xs text-muted-foreground">Senast: <Link className="underline-offset-2 hover:underline" href={occurrenceHref(plan.last)}>{PLAN_STATE_LABELS[plan.last.state]} {dayText(plan.last.due)}</Link></p> : null}
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga planer än.</p>}
    {data.canEdit ? <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")} data-testid="maintenance-plan-new"><Plus />Ny plan</Button> : null}
    <p className="text-xs text-muted-foreground">Varje tillfälle blir en egen arbetsorder, eller en underhållspost i driftrondens arbetsorder. De kommande väntar tills det är dags.</p>
    {editing ? <PlanDialog partId={partId} plan={editing === "new" ? null : editing} members={data.members} rounds={data.rounds ?? []} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} /> : null}
    {moving ? <PostponeDialog occurrence={moving} onClose={() => setMoving(null)} onSaved={async () => { setMoving(null); await load(); }} /> : null}
    {confirmElement}
  </div>;
}

/** The checklist as the dialog edits it: one point per line. */
const checklistLines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** Ny plan and Ändra: what is done, how often, from when, by whom, where (own work order or the round); Pausad when changing. */
function PlanDialog({ partId, plan, members, rounds, onClose, onSaved }: { partId: string; plan: Plan | null; members: Plans["members"]; rounds: RoundChoice[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState({
    name: plan?.name ?? "", description: plan?.description ?? "", unit: plan?.unit ?? "MONTH" as PlanUnit, every: String(plan?.every ?? 6), startDate: plan?.startDate ?? swedishDayKey(new Date()),
    firstRunHours: "", assignedToUserId: plan?.assignedToUserId ?? "", estimatedMinutes: plan?.estimatedMinutes === null || plan?.estimatedMinutes === undefined ? "" : String(plan.estimatedMinutes), isActive: plan?.isActive ?? true,
    checklist: (plan?.checklist ?? []).join("\n"), roundScheduleId: plan?.round?.id ?? "", intervalMode: plan?.intervalMode ?? "FROM_DONE" as IntervalMode,
  });
  const [busy, setBusy] = useState(false);
  const hours = draft.unit === "RUN_HOURS";
  const inRound = Boolean(draft.roundScheduleId);
  const points = checklistLines(draft.checklist);
  const number = (text: string) => text.trim() === "" ? null : Number(text.replace(",", ".").replace(/\s/g, ""));
  // A round that is no longer there stays choosable on its plan until it is changed, so a save never drops it in silence.
  const roundOptions = plan?.round && !rounds.some((round) => round.id === plan.round!.id) ? [...rounds, { id: plan.round.id, title: plan.round.title, ruleText: "", active: true }] : rounds;
  const save = async () => {
    const every = number(draft.every), first = number(draft.firstRunHours), minutes = number(draft.estimatedMinutes);
    if (every === null || !Number.isInteger(every) || every < 1) { announce("Intervallet ska vara ett heltal, minst 1.", true); return; }
    if ((first !== null && !(first >= 0)) || (minutes !== null && !(Number.isInteger(minutes) && minutes >= 0))) { announce("Skriv ett tal.", true); return; }
    setBusy(true);
    try {
      const body = { partId, name: draft.name, description: draft.description, unit: draft.unit, every, startDate: draft.startDate, firstRunHours: hours ? first : null,
        assignedToUserId: draft.assignedToUserId || null, estimatedMinutes: minutes, isActive: draft.isActive, checklist: points, roundScheduleId: draft.roundScheduleId || null, intervalMode: draft.intervalMode };
      if (plan) { await maintenancePost({ action: "update_plan", id: plan.id, version: plan.version, plan: body }); announce("Planen är sparad."); }
      else {
        const made = await maintenancePost<{ created: number; inRound?: boolean }>({ action: "create_plan", plan: body });
        announce(made.inRound ? (made.created ? "Planen är skapad. Första tillfället ligger i rondens arbetsorder." : "Planen är skapad. Tillfällena läggs i rondens arbetsorder när det närmar sig.")
          : hours ? "Planen är skapad." : `Planen är skapad med ${made.created} vilande arbetsordrar.`);
      }
      await onSaved();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const counted = draft.intervalMode === "FIXED" ? "Dagarna ligger fast från första gången." : "Nästa räknas från när arbetet gjordes.";
  const help = inRound
    ? `Tillfället läggs som en underhållspost i rondens arbetsorder ${PLAN_ROUND_LEAD_DAYS} dagar före, och teknikern bockar av det i ronden.${hours ? " Nästa räknas från när det gjordes." : ` ${counted}`}`
    : hours ? "En arbetsorder skapas när delen når drifttimmarna. Nästa räknas från när den gjordes." : `Arbetsordrarna skapas ett år framåt och vilar tills det är dags. ${counted}`;
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={plan ? `Ändra ${plan.name}` : "Ny plan"} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="maintenance-plan-form">
      <Field id="plan-name" label="Vad ska göras" required value={draft.name} placeholder="Till exempel Byt lager" onChange={(name) => setDraft({ ...draft, name })} />
      <Field id="plan-description" label="Instruktion" multiline value={draft.description} placeholder="Hur det görs, vad man behöver ha med sig" onChange={(description) => setDraft({ ...draft, description })} />
      <Field id="plan-checklist" label="Checklista" multiline value={draft.checklist} placeholder={"En punkt per rad, till exempel\nStäng av och lås\nByt filter\nProvkör"}
        help={points.length > PLAN_CHECKLIST_MAX ? `Högst ${PLAN_CHECKLIST_MAX} punkter.` : points.length ? `${points.length} ${points.length === 1 ? "punkt" : "punkter"}. Följer med till varje tillfälle.` : "Valfritt. Följer med till varje tillfälle."}
        onChange={(checklist) => setDraft({ ...draft, checklist })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="plan-every" label="Intervall" value={draft.every} onChange={(every) => setDraft({ ...draft, every })} />
        <Field id="plan-unit" label="Enhet" value={draft.unit} options={[...PLAN_UNITS]} optionLabels={PLAN_UNIT_LABELS} onChange={(unit) => setDraft({ ...draft, unit: unit as PlanUnit })} />
        {hours ? <Field id="plan-first-hours" label="Första vid (h)" value={draft.firstRunHours} placeholder={plan?.nextRunHours !== null && plan?.nextRunHours !== undefined ? String(plan.nextRunHours) : "Drifttimmar nu + intervall"} onChange={(firstRunHours) => setDraft({ ...draft, firstRunHours })} />
          : <Field id="plan-start" label="Första gången" type="date" value={draft.startDate} onChange={(startDate) => setDraft({ ...draft, startDate })} />}
        {hours ? null : <Field id="plan-interval-mode" label="Nästa gång räknas" value={draft.intervalMode} options={[...INTERVAL_MODES]} optionLabels={INTERVAL_MODE_LABELS}
          help={INTERVAL_MODE_HINTS[draft.intervalMode]} onChange={(intervalMode) => setDraft({ ...draft, intervalMode: intervalMode as IntervalMode })} />}
        <Field id="plan-minutes" label="Beräknad tid (min)" value={draft.estimatedMinutes} placeholder="Valfritt" onChange={(estimatedMinutes) => setDraft({ ...draft, estimatedMinutes })} />
        <Field id="plan-assignee" label="Ansvarig" value={draft.assignedToUserId} options={["", ...members.map((member) => member.id)]} optionLabels={Object.fromEntries([["", "Ingen vald"], ...members.map((member) => [member.id, member.name])])}
          onChange={(assignedToUserId) => setDraft({ ...draft, assignedToUserId })} help={inRound ? "I ronden gör rondens ansvarige arbetet." : undefined} />
        <Field id="plan-where" label="Var görs det" value={draft.roundScheduleId} options={["", ...roundOptions.map((round) => round.id)]}
          optionLabels={Object.fromEntries([["", "Egen arbetsorder"], ...roundOptions.map((round) => [round.id, `I driftronden ${round.title}${round.ruleText ? ` (${round.ruleText.toLowerCase()})` : ""}${round.active ? "" : " – pausad"}`])])}
          onChange={(roundScheduleId) => setDraft({ ...draft, roundScheduleId })} help={roundOptions.length ? undefined : "Inga driftronder än. Planera en rond under Driftronder för att göra underhållet i ronden."} />
      </div>
      <p className="text-xs text-muted-foreground" data-testid="maintenance-plan-help">{help}</p>
      {plan ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: !event.target.checked })} />Pausad</label> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: plan ? "Spara" : "Skapa", type: "submit", busy, busyLabel: "Sparar…",
        disabledReason: !draft.name.trim() ? "Skriv vad som ska göras först." : points.length > PLAN_CHECKLIST_MAX ? `Checklistan kan ha högst ${PLAN_CHECKLIST_MAX} punkter.` : null, testId: "maintenance-plan-save" }} />
    </form>
  </Modal>;
}

/** Skjut upp: a new day for one occurrence; the plan's following ones move with it. */
function PostponeDialog({ occurrence, onClose, onSaved }: { occurrence: Occurrence; onClose: () => void; onSaved: () => Promise<void> }) {
  const [day, setDay] = useState(occurrence.due);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await maintenancePost({ action: "postpone_order", id: occurrence.id, day }); announce("Tillfället är flyttat."); await onSaved(); }
    catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title="Skjut upp" size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="maintenance-postpone-form">
      <Field id="plan-postpone-day" label="Ny dag" type="date" value={day} onChange={setDay} />
      <p className="text-xs text-muted-foreground">De följande tillfällena flyttas lika långt.</p>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Flytta", type: "submit", busy, busyLabel: "Sparar…", disabledReason: day && day !== occurrence.due ? null : "Välj en annan dag.", testId: "maintenance-postpone-save" }} />
    </form>
  </Modal>;
}
