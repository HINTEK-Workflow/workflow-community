"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CalendarClock, Pencil, Play, Plus, Repeat } from "lucide-react";
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
import { PLAN_STATE_LABELS, PLAN_STATE_TONES, PLAN_UNIT_LABELS, PLAN_UNITS, type PlanOccurrenceState, type PlanUnit } from "@/lib/maintenance/plan-model";
import { maintenanceGet, maintenancePost } from "./maintenance-api";

/**
 * Planer (2026-10-30, återkommande underhåll): the part's maintenance plans – what is done and how often – with each
 * plan's coming work orders. A vilande work order shows as Vilande on its day (also in Planering → Kalender); Aktivera makes
 * it active before the day, Skjut upp gives it another day and the plan's following ones move with it. The server decides
 * every right; the rules are in lib/maintenance/plan-model.ts.
 */
type Occurrence = { id: string; title: string; due: string; state: PlanOccurrenceState; pinned: boolean; assignedToName: string };
type Plan = {
  id: string; partId: string; name: string; description: string; unit: PlanUnit; every: number; intervalText: string; startDate: string; nextRunHours: number | null;
  assignedToUserId: string | null; assignedToName: string; estimatedMinutes: number | null; isActive: boolean; version: number; coming: Occurrence[]; last: Occurrence | null;
};
type Plans = { plans: Plan[]; runHours: number | null; members: { id: string; name: string }[]; canEdit: boolean; canActivate: boolean };

const orderHref = (id: string) => `/?view=workflow_task&taskType=WORK_ORDER&taskId=${encodeURIComponent(id)}`;
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
    ? plan.nextRunHours !== null ? `Nästa vid ${hoursText(plan.nextRunHours)}${data.runHours !== null ? ` (nu ${hoursText(data.runHours)})` : ""}` : "Väntar på öppen arbetsorder"
    : plan.coming[0] ? `Nästa ${dayText(plan.coming[0].due)}` : "";
  return <div className="space-y-3" data-testid="maintenance-plans">
    {data.plans.length ? <ul className="-mx-4 divide-y border-y text-sm">{data.plans.map((plan) => <li key={plan.id} className="space-y-2 px-5 py-3" data-testid="maintenance-plan">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-semibold"><Repeat className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{plan.name}</span>
          <span className="block text-xs text-muted-foreground">{[plan.intervalText, nextLine(plan), plan.assignedToName ? `Ansvarig ${plan.assignedToName}` : ""].filter(Boolean).join(" · ")}</span>
          {plan.description ? <span className="mt-1 block whitespace-pre-wrap text-xs">{plan.description}</span> : null}
        </span>
        {plan.isActive ? null : <Badge variant="outline" className={indicatorBadge("neutral")}>Pausad</Badge>}
        {data.canEdit ? <span className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(plan)} data-testid="maintenance-plan-edit"><Pencil />Ändra</Button>
          <RemoveButton label={`Ta bort ${plan.name}`} onClick={() => void remove(plan)} />
        </span> : null}
      </div>
      {plan.coming.length ? <ol className="space-y-1" aria-label={`Kommande för ${plan.name}`}>{plan.coming.slice(0, 4).map((occurrence) => <li key={occurrence.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5" data-testid="maintenance-plan-occurrence" data-state={occurrence.state}>
        <Badge variant="outline" className={cn(indicatorBadge(PLAN_STATE_TONES[occurrence.state]), occurrence.state === "dormant" && "border-dashed")}>{PLAN_STATE_LABELS[occurrence.state]}</Badge>
        <span className="tabular-nums">{dayText(occurrence.due)}</span>
        {occurrence.pinned ? <span className="text-xs text-muted-foreground">Flyttad</span> : null}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <Button asChild size="sm" variant="ghost"><Link href={orderHref(occurrence.id)}>Öppna</Link></Button>
          {data.canActivate && occurrence.state === "dormant" ? <Button type="button" size="sm" variant="outline" onClick={() => void activate(occurrence)} data-testid="maintenance-plan-activate"><Play />Aktivera</Button> : null}
          {data.canActivate ? <Button type="button" size="sm" variant="outline" onClick={() => setMoving(occurrence)} data-testid="maintenance-plan-postpone"><CalendarClock />Skjut upp</Button> : null}
        </span>
      </li>)}</ol> : null}
      {plan.coming.length > 4 ? <p className="text-xs text-muted-foreground">{plan.coming.length - 4} till i Planering → Kalender.</p> : null}
      {plan.last ? <p className="text-xs text-muted-foreground">Senast: <Link className="underline-offset-2 hover:underline" href={orderHref(plan.last.id)}>{PLAN_STATE_LABELS[plan.last.state]} {dayText(plan.last.due)}</Link></p> : null}
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga planer än.</p>}
    {data.canEdit ? <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")} data-testid="maintenance-plan-new"><Plus />Ny plan</Button> : null}
    <p className="text-xs text-muted-foreground">Varje tillfälle blir en egen arbetsorder. De kommande väntar tills det är dags.</p>
    {editing ? <PlanDialog partId={partId} plan={editing === "new" ? null : editing} members={data.members} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} /> : null}
    {moving ? <PostponeDialog occurrence={moving} onClose={() => setMoving(null)} onSaved={async () => { setMoving(null); await load(); }} /> : null}
    {confirmElement}
  </div>;
}

/** Ny plan and Ändra: what is done, how often, from when, by whom; Pausad when changing. */
function PlanDialog({ partId, plan, members, onClose, onSaved }: { partId: string; plan: Plan | null; members: Plans["members"]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState({
    name: plan?.name ?? "", description: plan?.description ?? "", unit: plan?.unit ?? "MONTH" as PlanUnit, every: String(plan?.every ?? 6), startDate: plan?.startDate ?? swedishDayKey(new Date()),
    firstRunHours: "", assignedToUserId: plan?.assignedToUserId ?? "", estimatedMinutes: plan?.estimatedMinutes === null || plan?.estimatedMinutes === undefined ? "" : String(plan.estimatedMinutes), isActive: plan?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const hours = draft.unit === "RUN_HOURS";
  const number = (text: string) => text.trim() === "" ? null : Number(text.replace(",", ".").replace(/\s/g, ""));
  const save = async () => {
    const every = number(draft.every), first = number(draft.firstRunHours), minutes = number(draft.estimatedMinutes);
    if (every === null || !Number.isInteger(every) || every < 1) { announce("Intervallet ska vara ett heltal, minst 1.", true); return; }
    if ((first !== null && !(first >= 0)) || (minutes !== null && !(Number.isInteger(minutes) && minutes >= 0))) { announce("Skriv ett tal.", true); return; }
    setBusy(true);
    try {
      const body = { partId, name: draft.name, description: draft.description, unit: draft.unit, every, startDate: draft.startDate, firstRunHours: hours ? first : null,
        assignedToUserId: draft.assignedToUserId || null, estimatedMinutes: minutes, isActive: draft.isActive };
      if (plan) { await maintenancePost({ action: "update_plan", id: plan.id, version: plan.version, plan: body }); announce("Planen är sparad."); }
      else {
        const made = await maintenancePost<{ created: number }>({ action: "create_plan", plan: body });
        announce(hours ? "Planen är skapad." : `Planen är skapad med ${made.created} vilande arbetsordrar.`);
      }
      await onSaved();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={plan ? `Ändra ${plan.name}` : "Ny plan"} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="maintenance-plan-form">
      <Field id="plan-name" label="Vad ska göras" required value={draft.name} placeholder="Till exempel Byt lager" onChange={(name) => setDraft({ ...draft, name })} />
      <Field id="plan-description" label="Beskrivning" multiline value={draft.description} onChange={(description) => setDraft({ ...draft, description })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="plan-every" label="Intervall" value={draft.every} onChange={(every) => setDraft({ ...draft, every })} />
        <Field id="plan-unit" label="Enhet" value={draft.unit} options={[...PLAN_UNITS]} optionLabels={PLAN_UNIT_LABELS} onChange={(unit) => setDraft({ ...draft, unit: unit as PlanUnit })} />
        {hours ? <Field id="plan-first-hours" label="Första vid (h)" value={draft.firstRunHours} placeholder={plan?.nextRunHours !== null && plan?.nextRunHours !== undefined ? String(plan.nextRunHours) : "Drifttimmar nu + intervall"} onChange={(firstRunHours) => setDraft({ ...draft, firstRunHours })} />
          : <Field id="plan-start" label="Första gången" type="date" value={draft.startDate} onChange={(startDate) => setDraft({ ...draft, startDate })} />}
        <Field id="plan-minutes" label="Beräknad tid (min)" value={draft.estimatedMinutes} placeholder="Valfritt" onChange={(estimatedMinutes) => setDraft({ ...draft, estimatedMinutes })} />
        <Field id="plan-assignee" label="Ansvarig" value={draft.assignedToUserId} options={["", ...members.map((member) => member.id)]} optionLabels={Object.fromEntries([["", "Ingen vald"], ...members.map((member) => [member.id, member.name])])}
          onChange={(assignedToUserId) => setDraft({ ...draft, assignedToUserId })} />
      </div>
      <p className="text-xs text-muted-foreground">{hours ? "En arbetsorder skapas när delen når drifttimmarna. Nästa räknas från när den gjordes." : "Arbetsordrarna skapas ett år framåt och vilar tills det är dags. Nästa räknas från när arbetet gjordes."}</p>
      {plan ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: !event.target.checked })} />Pausad</label> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: plan ? "Spara" : "Skapa", type: "submit", busy, busyLabel: "Sparar…", disabledReason: draft.name.trim() ? null : "Skriv vad som ska göras först.", testId: "maintenance-plan-save" }} />
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
