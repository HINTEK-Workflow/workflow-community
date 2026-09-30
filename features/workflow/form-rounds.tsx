"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CalendarPlus, CheckCircle2, CircleDashed, CircleAlert, Pencil, Play, Repeat, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { useCustomerOptions } from "@/features/kfid/customer-options";
import { CustomerSearchBox } from "@/features/kfid/customer-search-box";
import type { CustomerItem } from "@/features/kfid/types";
import { Empty, Modal, Panel } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { SCHEDULE_FREQUENCIES, SCHEDULE_FREQUENCY_LABEL, defaultScheduleReminders, formScheduleInputSchema, type FormScheduleInput, type ScheduleOccurrenceState, type ScheduleView } from "@/lib/workflow/form-schedule";
import { indicatorBadge } from "./indicator-tone";

type PublishedForm = { id: string; name: string };
type Option = { id: string; name: string };
/** The same view in Cloud (API) and Local (the open file). */
export type RoundsBackend = {
  load: () => Promise<{ schedules: ScheduleView[]; canPlan: boolean; today: string }>;
  save: (input: FormScheduleInput, templateName: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  customers?: CustomerItem[]; projects?: Option[]; members?: Option[];
};

export const cloudRoundsBackend: RoundsBackend = {
  load: () => api("/api/form-schedules"),
  save: async (schedule) => { await api("/api/form-schedules", { method: "POST", body: JSON.stringify({ action: "save", schedule }) }); },
  remove: async (id) => { await api("/api/form-schedules", { method: "POST", body: JSON.stringify({ action: "delete", id }) }); },
};

const WEEKDAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const STATE: Record<ScheduleOccurrenceState["state"], { label: string; tone: "success" | "warning" | "danger" | "neutral"; icon: typeof CheckCircle2 }> = {
  done: { label: "Utförd", tone: "success", icon: CheckCircle2 }, started: { label: "Påbörjad", tone: "warning", icon: CircleDashed },
  missed: { label: "Missad", tone: "danger", icon: CircleAlert }, due: { label: "Idag", tone: "warning", icon: CalendarClock }, upcoming: { label: "Kommande", tone: "neutral", icon: CalendarClock },
};
const day = (value: string) => formatSwedish(`${value}T12:00:00`, { dateStyle: "medium" });

/** The link that starts (or continues) a round: the form's editor with the schedule, the day and the place prefilled. */
function roundHref(schedule: ScheduleView, occurrence: ScheduleOccurrenceState) {
  if (occurrence.taskId) return `/?view=workflow_task&taskType=FORM&taskId=${encodeURIComponent(occurrence.taskId)}`;
  // The protocol is named after the round and its day, so rounds of the same form can be told apart (F14, 2026-09-29).
  const params = new URLSearchParams({ view: "workflow_task", taskType: "FORM", formId: schedule.templateId, scheduleId: schedule.id, occurrence: occurrence.date, roundTitle: schedule.title });
  if (schedule.facilityId) params.set("facilityId", schedule.facilityId);
  if (schedule.customerId) params.set("customerId", schedule.customerId);
  if (schedule.projectId) params.set("projectId", schedule.projectId);
  return `/?${params}`;
}

/**
 * Driftronder (2026-09-28): recurring rounds of any form – a hydropower station's daily supervision, a standby
 * generator's weekly test run, a pumping station's round. Shows what is due today, what was missed and what comes
 * next; a round is started from its occurrence and the protocol remembers the schedule and the day. The company's
 * administrator (in Local the file's owner) plans the rounds; everyone who may read the form starts them.
 */
export function FormRounds({ backend = cloudRoundsBackend, revision }: { backend?: RoundsBackend; /** Local: the file's revision, so the view reads the file again after a change. */ revision?: string }) {
  const [confirm, confirmCard] = useConfirm();
  const [data, setData] = useState<{ schedules: ScheduleView[]; canPlan: boolean; today: string } | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ScheduleView | "new" | null>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  // Local builds a new backend on every render of the open file, so it is read through a ref, not as a dependency.
  const source = useRef(backend);
  useEffect(() => { source.current = backend; });
  const reload = useCallback(async () => { try { setData(await source.current.load()); setError(""); } catch (issue) { setError((issue as Error).message); } }, []);
  useEffect(() => { void reload(); }, [reload, revision]);
  const schedules = data?.schedules ?? [];
  const active = schedules.filter((item) => item.active);
  const dueToday = active.filter((item) => item.overview.today && item.overview.today.state !== "done").length;
  const missed = active.reduce((sum, item) => sum + item.overview.missed, 0);
  const shown = filter === "attention" ? schedules.filter((item) => item.active && (item.overview.missed || (item.overview.today && item.overview.today.state !== "done"))) : schedules;
  const remove = async (schedule: ScheduleView) => {
    if (!(await confirm({ title: "Ta bort ronden?", message: `${schedule.title} tas bort. Protokoll som redan gjorts finns kvar.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    try { await source.current.remove(schedule.id); await reload(); } catch (issue) { setError((issue as Error).message); }
  };
  return <div className="space-y-6" data-testid="form-rounds">
    {confirmCard}
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Underhåll och driftronder</p><h1 className="page-title mt-1">Driftronder</h1>
        <p className="page-description mt-2 max-w-2xl">Återkommande tillsyn av anläggningar, maskiner och fastigheter – dagligen, veckovis eller med eget intervall. Starta dagens rond härifrån; mätvärdena följs som trender mot anläggningens gränsvärden.</p></div>
      {data?.canPlan ? <Button onClick={() => setEditing("new")} data-testid="round-new"><CalendarPlus />Ny rond</Button> : null}
    </div>
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="stat-card rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Att göra idag</p><p className="mt-1 text-2xl font-semibold tabular-nums">{dueToday}</p></div>
      <div className="stat-card rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Missade senaste 30 dagarna</p><p className={cn("mt-1 text-2xl font-semibold tabular-nums", missed && "text-destructive")}>{missed}</p></div>
      <div className="stat-card rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Aktiva ronder</p><p className="mt-1 text-2xl font-semibold tabular-nums">{active.length}</p></div>
    </div>
    <Panel title="Ronder" description={data ? `Idag ${day(data.today)}.` : "Hämtar ronder…"} leadingActions={<span className="panel-icon" aria-hidden="true"><Repeat className="size-4" /></span>}
      actions={<div className="flex h-9 rounded-[var(--radius-control)] border p-0.5" role="group" aria-label="Urval">{([["all", "Alla"], ["attention", "Behöver åtgärd"]] as const).map(([value, label]) => <Button key={value} type="button" size="sm" className="h-full min-h-0!" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}</div>}>
      {!data ? <p role="status" className="text-sm text-muted-foreground">Hämtar ronder…</p> : !shown.length
        ? <Empty title={schedules.length ? "Inget behöver åtgärdas" : "Inga ronder ännu"} description={schedules.length ? "Alla dagens ronder är gjorda och inga är missade." : data.canPlan ? "Planera en återkommande rond: välj formulär, anläggning och hur ofta den görs." : "Företagets administratör planerar ronderna."}>
          {!schedules.length && data.canPlan ? <Button onClick={() => setEditing("new")}><CalendarPlus />Ny rond</Button> : null}
        </Empty>
        : <ul className="grid gap-3" data-testid="round-list">{shown.map((schedule) => <RoundCard key={schedule.id} schedule={schedule} canPlan={data.canPlan} onEdit={() => setEditing(schedule)} onRemove={() => void remove(schedule)} />)}</ul>}
    </Panel>
    {editing ? <ScheduleDialog schedule={editing === "new" ? null : editing} backend={backend} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} /> : null}
  </div>;
}

function RoundCard({ schedule, canPlan, onEdit, onRemove }: { schedule: ScheduleView; canPlan: boolean; onEdit: () => void; onRemove: () => void }) {
  const current = schedule.overview.current;
  const today = schedule.overview.today;
  const status = !schedule.active ? { label: "Pausad", tone: "neutral" as const } : today?.state === "done" ? { label: "Utförd idag", tone: "success" as const } : current?.state === "missed" ? { label: `Missad ${day(current.date)}`, tone: "danger" as const } : today ? { label: today.state === "started" ? "Påbörjad idag" : "Idag", tone: "warning" as const } : { label: schedule.overview.next ? `Nästa ${day(schedule.overview.next)}` : "Avslutad", tone: "neutral" as const };
  const where = [schedule.facilityName, schedule.customerName, schedule.projectName].filter(Boolean).join(" · ");
  return <li className="rounded-xl border bg-card p-4" data-testid="round-card">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">{schedule.title}<Badge variant="outline" className={indicatorBadge(status.tone)} data-testid="round-status">{status.label}</Badge></h3>
        <p className="mt-1 text-xs text-muted-foreground">{schedule.templateName}{where ? ` · ${where}` : ""}</p>
        <p className="mt-1 text-xs text-muted-foreground">{schedule.ruleText}{schedule.assignedToName ? ` · Ansvarig ${schedule.assignedToName}` : ""}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {schedule.active && current ? <Button asChild size="sm"><Link href={roundHref(schedule, current)} data-testid="round-start">{current.taskId ? <><CircleDashed />Fortsätt rond</> : <><Play />Starta rond</>}</Link></Button> : null}
        {canPlan ? <Button type="button" size="icon" variant="ghost" aria-label={`Ändra ${schedule.title}`} onClick={onEdit}><Pencil /></Button> : null}
        {canPlan ? <Button type="button" size="icon" variant="ghost" aria-label={`Ta bort ${schedule.title}`} onClick={onRemove}><Trash2 /></Button> : null}
      </div>
    </div>
    {schedule.overview.history.length || schedule.overview.upcoming.length ? <ol className="mt-3 flex flex-wrap gap-1.5" aria-label={`Tillfällen för ${schedule.title}`}>
      {[...schedule.overview.history.slice(0, 10).reverse(), ...(today ? [today] : []), ...schedule.overview.upcoming.slice(0, 3)].map((occurrence) => {
        const state = STATE[occurrence.state];
        const Icon = state.icon;
        const content = <><Icon className="size-3" />{formatSwedish(`${occurrence.date}T12:00:00`, { day: "numeric", month: "short" })}</>;
        return <li key={occurrence.date}>{occurrence.taskId
          ? <Link href={roundHref(schedule, occurrence)} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium hover:underline", indicatorBadge(state.tone))} title={`${state.label} – öppna protokollet`}>{content}</Link>
          : <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", indicatorBadge(state.tone))} title={state.label}>{content}<span className="sr-only">{state.label}</span></span>}</li>;
      })}
    </ol> : null}
  </li>;
}

/** Plans or changes a round: the form, where, who and how often (daily, chosen weekdays, monthly; every N). */
function ScheduleDialog({ schedule, backend, onClose, onSaved }: { schedule: ScheduleView | null; backend: RoundsBackend; onClose: () => void; onSaved: () => void }) {
  const [forms, setForms] = useState<PublishedForm[]>([]);
  const [projects, setProjects] = useState<Option[]>(backend.projects ?? []);
  const [members, setMembers] = useState<Option[]>(backend.members ?? []);
  const cloudCustomers = useCustomerOptions(!backend.customers);
  const customers = useMemo(() => backend.customers ?? cloudCustomers ?? [], [backend.customers, cloudCustomers]);
  const [draft, setDraft] = useState<FormScheduleInput>(() => schedule ? { ...schedule } : { title: "", templateId: "", customerId: null, facilityId: null, projectId: null, assignedToUserId: null, assignedToName: "", active: true, rule: { frequency: "DAILY", interval: 1, weekdays: [], startDate: swedishDayKey(new Date()), endDate: "" }, reminders: { ...defaultScheduleReminders } });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ forms: PublishedForm[] }>("/api/forms").then((result) => setForms(result.forms)).catch(() => setForms([]));
    if (!backend.projects) api<{ projects?: Option[] }>("/api/projects?scope=planning").then((result) => setProjects((result.projects ?? []).map((item) => ({ id: item.id, name: item.name })))).catch(() => undefined);
    if (!backend.members) api<{ members?: Option[] }>("/api/workflow-tasks?members=only").then((result) => setMembers(result.members ?? [])).catch(() => undefined);
  }, [backend.projects, backend.members]);
  const facilities = useMemo(() => customers.flatMap((customer) => (customer.facilities ?? []).filter((facility) => facility.isActive || facility.id === draft.facilityId).map((facility) => ({ ...facility, customerName: customer.company || customer.name }))), [customers, draft.facilityId]);
  const rule = draft.rule;
  const setRule = (patch: Partial<FormScheduleInput["rule"]>) => setDraft({ ...draft, rule: { ...rule, ...patch } });
  const save = async () => {
    const parsed = formScheduleInputSchema.safeParse({ ...draft, title: draft.title.trim() || forms.find((form) => form.id === draft.templateId)?.name || "" });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Kontrollera uppgifterna."); return; }
    if (!parsed.data.templateId) { setError("Välj formulär."); return; }
    setBusy(true); setError("");
    try { await backend.save(parsed.data, forms.find((form) => form.id === parsed.data.templateId)?.name ?? ""); onSaved(); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  // Labels above their fields, one rule for the whole dialog (2026-09-30: "Frekvens" stood beside its field).
  const label = "grid content-start gap-1.5 text-xs font-medium text-muted-foreground";
  const unit = rule.frequency === "DAILY" ? (rule.interval === 1 ? "dag" : "dagar") : rule.frequency === "WEEKLY" ? (rule.interval === 1 ? "vecka" : "veckor") : (rule.interval === 1 ? "månad" : "månader");
  const reminders = draft.reminders ?? defaultScheduleReminders;
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={schedule ? "Ändra rond" : "Ny rond"} className="max-w-2xl">
    <div className="grid gap-4 sm:grid-cols-2" data-testid="round-dialog">
      <label className={cn(label, "sm:col-span-2")}>Formulär<select className="form-select" value={draft.templateId} onChange={(event) => setDraft({ ...draft, templateId: event.target.value, title: draft.title || forms.find((form) => form.id === event.target.value)?.name || "" })}><option value="">Välj formulär</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
      <label className={cn(label, "sm:col-span-2")}>Namn på ronden<Input value={draft.title} maxLength={200} placeholder="T.ex. Daglig tillsyn Forsen kraftstation" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label className={label}>Anläggning<select className="form-select" value={draft.facilityId ?? ""} onChange={(event) => { const facility = facilities.find((item) => item.id === event.target.value); setDraft({ ...draft, facilityId: facility?.id ?? null, customerId: facility?.customerId ?? draft.customerId }); }}><option value="">Ingen anläggning</option>{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name} · {facility.customerName}</option>)}</select></label>
      <label className={label}>Kund<select className="form-select" value={draft.customerId ?? ""} disabled={Boolean(draft.facilityId)} onChange={(event) => setDraft({ ...draft, customerId: event.target.value || null })}><option value="">Ingen kund</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company || customer.name}</option>)}</select></label>
      <CustomerSearchBox enabled={!backend.customers && !draft.facilityId} onPick={(customer) => setDraft({ ...draft, customerId: customer.id })} />
      <label className={label}>Projekt (valfritt)<select className="form-select" value={draft.projectId ?? ""} onChange={(event) => setDraft({ ...draft, projectId: event.target.value || null })}><option value="">Inget projekt</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className={label}>Ansvarig (valfri)<select className="form-select" value={draft.assignedToUserId ?? ""} onChange={(event) => { const member = members.find((item) => item.id === event.target.value); setDraft({ ...draft, assignedToUserId: member?.id ?? null, assignedToName: member?.name ?? "" }); }}><option value="">Ingen</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <fieldset className="grid gap-4 rounded-lg border p-4 sm:col-span-2"><legend className="px-1 text-xs font-semibold">Hur ofta</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className={label}>Frekvens<select className="form-select" value={rule.frequency} onChange={(event) => setRule({ frequency: event.target.value as FormScheduleInput["rule"]["frequency"] })}>{SCHEDULE_FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{SCHEDULE_FREQUENCY_LABEL[frequency]}</option>)}</select></label>
          <label className={label}>Var<span className="flex items-center gap-2"><Input className="w-20" type="number" min={1} max={366} value={rule.interval} aria-label={`Var … ${unit}`} onChange={(event) => setRule({ interval: Math.max(1, Math.min(366, Number(event.target.value) || 1)) })} /><span className="text-sm text-foreground">{unit}</span></span></label>
          <label className={label}>Från<Input type="date" value={rule.startDate} onChange={(event) => setRule({ startDate: event.target.value })} /></label>
          <label className={label}>Till (valfritt)<Input type="date" value={rule.endDate} onChange={(event) => setRule({ endDate: event.target.value })} /></label>
        </div>
        {rule.frequency === "WEEKLY" ? <div className="grid gap-1.5"><span className="text-xs font-medium text-muted-foreground">Veckodagar</span><div className="flex flex-wrap gap-1.5" role="group" aria-label="Veckodagar">{WEEKDAYS.map((name, index) => { const weekday = index + 1; const on = rule.weekdays.includes(weekday);
          return <Button key={name} type="button" size="sm" className="min-w-12" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => setRule({ weekdays: on ? rule.weekdays.filter((item) => item !== weekday) : [...rule.weekdays, weekday] })}>{name}</Button>; })}</div>
          {!rule.weekdays.length ? <span className="text-xs text-muted-foreground">Ingen dag vald: samma veckodag som startdatumet.</span> : null}</div> : null}
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Aktiv</label>
      </fieldset>
      {/* Reminders (2026-09-30): the bell in the top bar, and an e-mail, to the responsible person – or the admins. */}
      <fieldset className="grid gap-2 rounded-lg border p-4 sm:col-span-2" data-testid="round-reminders"><legend className="px-1 text-xs font-semibold">Påminnelser</legend>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={reminders.bell} onChange={(event) => setDraft({ ...draft, reminders: { ...reminders, bell: event.target.checked } })} />Notis i klockan när ronden ska göras och om den missas</label>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={reminders.email} onChange={(event) => setDraft({ ...draft, reminders: { ...reminders, email: event.target.checked } })} />E-post samma morgon som ronden ska göras</label>
        <p className="text-xs text-muted-foreground">Går till {draft.assignedToName || "företagets administratörer, eftersom ingen ansvarig är vald"}.</p>
      </fieldset>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Avbryt</Button><Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Sparar…" : "Spara rond"}</Button></div>
  </Modal>;
}
