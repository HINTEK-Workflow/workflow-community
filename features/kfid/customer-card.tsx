"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Building2, ClipboardList, Contact, FolderKanban, Pause, Pencil, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { Empty, Modal, Panel, ShowMore } from "./ui";
import type { CustomerItem } from "./types";
import { facilityLabel, type CustomerFacilityInput, type FacilityItem } from "@/lib/workflow/customer-facility";
import type { ProjectStatus } from "@/lib/workflow/project-status";
import { indicatorBadge, statusTone } from "@/features/workflow/indicator-tone";

export type CustomerCardKind = "all" | "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "COMMISSIONING_CONTROL";
export type CustomerCardFacility = FacilityItem & { version?: number; links: number };
export type CustomerCardTask = { id: string; number?: number; kind: string; title: string; status: string; progress: number; updatedAt: string; facilityId: string | null; projectName: string };
export type CustomerCardData = {
  customer: Omit<CustomerItem, "facilities">;
  facilities: CustomerCardFacility[];
  projects: { id: string; name: string; startDate: string; dueDate: string; facilityId: string | null; status: ProjectStatus }[];
  canReadProjects: boolean;
  tasks: { items: CustomerCardTask[]; total: number; page: number; pages: number; counts: Record<CustomerCardKind, number> };
  canManageFacilities: boolean;
};
/** Local reads the open .hwf file and writes through the same pure store functions; Cloud uses /api/customer-card. */
export type CustomerCardAdapter = {
  load: (kind: CustomerCardKind, page: number) => Promise<CustomerCardData>;
  saveFacility: (input: { id?: string; version?: number; facility: CustomerFacilityInput }) => Promise<void>;
  setFacilityActive: (id: string, isActive: boolean) => Promise<void>;
};

type Tab = "projects" | "tasks" | "facilities" | "contact";
const kindLabels: Record<CustomerCardKind, string> = { all: "Alla", WORK_ORDER: "Arbetsorder", RISK_ASSESSMENT: "Riskbedömningar", FORM: "Formulär", COMMISSIONING_CONTROL: "Kontroller" };
const typeLabel = (kind: string) => kind === "WORK_ORDER" ? "Arbetsorder" : kind === "RISK_ASSESSMENT" ? "Riskbedömning" : kind === "FORM" ? "Formulär" : "Kontroll före idrifttagning";
const statusLabel = (status: string) => ({ PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Slutförd", DRAFT: "Utkast" } as Record<string, string>)[status] ?? status;
const taskHref = (task: CustomerCardTask) => task.kind === "COMMISSIONING_CONTROL" ? `/?view=new&id=${encodeURIComponent(task.id)}` : `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`;
const emptyFacility: Required<CustomerFacilityInput> = { name: "", address: "", postalCode: "", city: "", description: "" };

function cloudAdapter(customerId: string): CustomerCardAdapter {
  return {
    load: (kind, page) => api<CustomerCardData>(`/api/customer-card?${new URLSearchParams({ id: customerId, kind, page: String(page) })}`),
    saveFacility: async (input) => { await api("/api/customer-card", { method: "POST", body: JSON.stringify({ action: "facility_save", customerId, ...input }) }); },
    setFacilityActive: async (id, isActive) => { await api("/api/customer-card", { method: "POST", body: JSON.stringify({ action: "facility_status", id, isActive }) }); },
  };
}

/**
 * The customer card (Daniel 2026-09-26, decision 12B/D10 B): the customer is the hub for its projects, all its tasks,
 * its facilities (decision 11) and its contact details. Tasks are loaded one bounded page at a time.
 */
export function CustomerCard({ customerId, local, onEdit }: { customerId: string; local?: CustomerCardAdapter; onEdit?: (customer: CustomerItem) => void }) {
  const [adapter] = useState(() => local ?? cloudAdapter(customerId));
  const [data, setData] = useState<CustomerCardData | null>(null);
  const [tasks, setTasks] = useState<CustomerCardTask[]>([]);
  // The register's counts link straight to a tab and task type (F15, 2026-09-29): ?tab=tasks&kind=WORK_ORDER.
  const params = useSearchParams();
  const [kind, setKind] = useState<CustomerCardKind>(() => (["WORK_ORDER", "RISK_ASSESSMENT", "FORM", "COMMISSIONING_CONTROL"].includes(params.get("kind") ?? "") ? params.get("kind") as CustomerCardKind : "all"));
  const [tab, setTab] = useState<Tab>(() => (["projects", "tasks", "facilities", "contact"].includes(params.get("tab") ?? "") ? params.get("tab") as Tab : "projects"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; version?: number; facility: Required<CustomerFacilityInput> } | null>(null);
  const [formError, setFormError] = useState("");

  const load = useCallback(async (nextKind: CustomerCardKind, page = 1) => {
    setBusy(true);
    try {
      const result = await (local ?? adapter).load(nextKind, page);
      setData(result);
      setTasks((current) => page === 1 ? result.tasks.items : [...current, ...result.tasks.items]);
      setError("");
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy(false);
    }
  }, [adapter, local]);
  useEffect(() => { void load(kind); }, [kind, load]);

  if (error && !data) return <Panel title="Kundkortet kunde inte hämtas"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (!data) return <Panel title="Hämtar kundkort"><p role="status" className="text-sm text-muted-foreground">Läser kunden och dess arbete…</p></Panel>;
  const { customer } = data;
  const facilityName = (id: string | null) => id ? data.facilities.find((facility) => facility.id === id)?.name : undefined;
  const saveFacility = async () => {
    if (!editing) return;
    setBusy(true); setFormError("");
    try {
      await (local ?? adapter).saveFacility({ id: editing.id, version: editing.version, facility: editing.facility });
      setEditing(null);
      await load(kind);
    } catch (issue) { setFormError((issue as Error).message); } finally { setBusy(false); }
  };
  const toggleFacility = async (facility: CustomerCardFacility) => {
    setBusy(true);
    try { await (local ?? adapter).setFacilityActive(facility.id, !facility.isActive); await load(kind); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  const tabs: [Tab, string, number | null, React.ReactNode][] = [
    ["projects", "Projekt", data.canReadProjects ? data.projects.length : null, <FolderKanban key="p" />],
    ["tasks", "Uppgifter", data.tasks.counts.all, <ClipboardList key="t" />],
    ["facilities", "Anläggningar", data.facilities.length, <Building2 key="f" />],
    ["contact", "Kontaktuppgifter", null, <Contact key="c" />],
  ];
  const address = [customer.address, [customer.postalCode, customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><Link className="text-sm text-primary hover:underline" href="/?view=customers">← Kundregister</Link><h1 className="page-title mt-2">{customer.name}</h1><p className="page-description mt-1">{[customer.company, address].filter(Boolean).join(" · ") || "Kundkort med projekt, uppgifter och anläggningar."}</p></div>
      <div className="flex flex-wrap justify-end gap-2">
        {onEdit && !customer.deletedAt && <Button variant="outline" onClick={() => onEdit({ ...customer, facilities: data.facilities })}><Pencil />Redigera kund</Button>}
        {!customer.deletedAt && <Button asChild><Link href={`/?view=new_task&customerId=${encodeURIComponent(customer.id)}`}><Plus />Ny uppgift</Link></Button>}
      </div>
    </div>
    {customer.deletedAt && <div className="notice">Kunden ligger i papperskorgen. Återställ den i kundregistret för att lägga till arbete.</div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex w-fit max-w-full overflow-x-auto rounded-xl border bg-card p-1" role="group" aria-label="Kundkortets flikar">
      {tabs.map(([value, label, count, icon]) => <Button key={value} size="sm" variant={tab === value ? "secondary" : "ghost"} aria-pressed={tab === value} onClick={() => setTab(value)}>{icon}{label}{count !== null ? ` (${count})` : ""}</Button>)}
    </div>

    {tab === "projects" && <Panel title="Projekt" description="Kundens projekt, senast ändrade först.">
      {!data.canReadProjects ? <p className="text-sm text-muted-foreground">Du saknar behörighet att läsa projekt.</p>
        : data.projects.length ? <ul data-testid="customer-projects" className="divide-y">{data.projects.map((project) => <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0"><Link className="font-medium hover:text-primary" href={`/?view=project&projectId=${encodeURIComponent(project.id)}`}>{project.name}</Link><p className="text-xs text-muted-foreground">{[project.startDate && project.dueDate ? `${project.startDate} – ${project.dueDate}` : project.dueDate ? `Slutdatum ${project.dueDate}` : "", facilityName(project.facilityId)].filter(Boolean).join(" · ") || "Ingen tidsram"}</p></div>
          <Badge variant="outline" className={indicatorBadge(project.status.overdue ? "danger" : project.status.state === "IN_PROGRESS" ? "warning" : project.status.state === "READY_TO_CLOSE" || project.status.state === "CLOSED" ? "success" : "neutral")}>{project.status.label}</Badge>
        </li>)}</ul> : <Empty title="Inga projekt" description="Kunden har inga projekt ännu. Välj kunden när du skapar ett projekt." />}
    </Panel>}

    {tab === "tasks" && <Panel title="Uppgifter" description="Kundens arbetsorder, riskbedömningar och kontroller, senast ändrade först.">
      <div className="mb-3 flex max-w-full gap-1 overflow-x-auto" role="group" aria-label="Uppgiftstyp">
        {(Object.keys(kindLabels) as CustomerCardKind[]).filter((value) => value !== "FORM" || (data.tasks.counts.FORM ?? 0) > 0).map((value) => <Button key={value} size="sm" variant={kind === value ? "secondary" : "ghost"} aria-pressed={kind === value} onClick={() => setKind(value)}>{kindLabels[value]} ({data.tasks.counts[value]})</Button>)}
      </div>
      {tasks.length ? <ul data-testid="customer-tasks" className="divide-y">{tasks.map((task) => <li key={`${task.kind}-${task.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
        <div className="min-w-0"><Link className="font-medium hover:text-primary" href={taskHref(task)}>{task.title || "Utan rubrik"}</Link><p className="text-xs text-muted-foreground">{[typeLabel(task.kind), task.projectName || "Fristående", facilityName(task.facilityId)].filter(Boolean).join(" · ")}</p></div>
        <div className="flex items-center gap-2"><span className="text-xs font-semibold tabular-nums">{task.progress}%</span><Badge variant="outline" className={indicatorBadge(task.status === "NEEDS_ACTION" ? "danger" : statusTone(task.status))}>{statusLabel(task.status)}</Badge></div>
      </li>)}</ul> : <Empty title="Inga uppgifter" description="Kunden har inga uppgifter av den här typen som du kan läsa." />}
      <ShowMore shown={tasks.length} total={data.tasks.total} busy={busy} onMore={() => void load(kind, data.tasks.page + 1)} />
    </Panel>}

    {tab === "facilities" && <Panel title="Anläggningar" description="Kundens anläggningar, till exempel fastigheter eller ställverk. Projekt, uppgifter och kontroller kan kopplas till dem."
      actions={!customer.deletedAt ? <Button size="sm" variant="outline" onClick={() => { setFormError(""); setEditing({ facility: { ...emptyFacility } }); }}><Plus />Ny anläggning</Button> : undefined}>
      {data.facilities.length ? <ul data-testid="customer-facilities" className="grid gap-3 md:grid-cols-2">{data.facilities.map((facility) => <li key={facility.id} className={cn("rounded-xl border p-4", !facility.isActive && "opacity-70")}>
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="text-sm font-semibold">{facility.name}{!facility.isActive && <span className="font-normal text-muted-foreground"> (pausad)</span>}</h3><p className="mt-0.5 text-xs text-muted-foreground">{facilityLabel({ ...facility, name: "" }).replace(/^, /, "") || "Ingen adress"}</p></div><span className="shrink-0 text-xs text-muted-foreground">{facility.links} {facility.links === 1 ? "koppling" : "kopplingar"}</span></div>
        {facility.description && <p className="mt-2 whitespace-pre-wrap text-sm">{facility.description}</p>}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {/* A task for the facility starts with the customer and the facility filled in (the guided flow, 2026-09-30). */}
          {!customer.deletedAt && facility.isActive && <Button asChild size="sm" variant="outline"><Link href={`/?view=new_task&customerId=${encodeURIComponent(customerId)}&facilityId=${encodeURIComponent(facility.id)}`} data-testid="facility-new-task"><Plus />Ny uppgift</Link></Button>}
          {!customer.deletedAt && <Button size="sm" variant="ghost" onClick={() => { setFormError(""); setEditing({ id: facility.id, version: facility.version, facility: { name: facility.name, address: facility.address, postalCode: facility.postalCode, city: facility.city, description: facility.description } }); }}><Pencil />Redigera</Button>}
          {data.canManageFacilities && <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleFacility(facility)}>{facility.isActive ? <><Pause />Pausa</> : <><Play />Aktivera</>}</Button>}
        </div>
      </li>)}</ul> : <Empty title="Inga anläggningar" description="Lägg till kundens anläggningar för att koppla projekt och uppgifter till rätt objekt." />}
    </Panel>}

    {tab === "contact" && <Panel title="Kontaktuppgifter" actions={onEdit && !customer.deletedAt ? <Button size="sm" variant="outline" onClick={() => onEdit({ ...customer, facilities: data.facilities })}><Pencil />Redigera</Button> : undefined}>
      <dl data-testid="customer-contact" className="grid gap-3 text-sm sm:grid-cols-2">
        {([["Företag", customer.company], ["Adress", address], ["E-post", customer.email], ["Telefon", customer.phone], ["Mobil", customer.mobile], ["Anteckningar", customer.notes]] as const).map(([label, value]) => <div key={label} className={label === "Anteckningar" ? "sm:col-span-2" : undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words">{value || "–"}</dd></div>)}
      </dl>
    </Panel>}

    <Modal open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }} title={editing?.id ? "Redigera anläggning" : "Ny anläggning"} className="max-w-lg">
      {editing && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveFacility(); }}>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Namn<Input value={editing.facility.name} onChange={(event) => setEditing({ ...editing, facility: { ...editing.facility, name: event.target.value } })} maxLength={160} required autoFocus placeholder="Till exempel Ställverk 1" /></label>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Adress<Input value={editing.facility.address} onChange={(event) => setEditing({ ...editing, facility: { ...editing.facility, address: event.target.value } })} maxLength={200} /></label>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <label className="block space-y-2 text-xs font-medium text-muted-foreground">Postnummer<Input value={editing.facility.postalCode} onChange={(event) => setEditing({ ...editing, facility: { ...editing.facility, postalCode: event.target.value } })} maxLength={20} /></label>
          <label className="block space-y-2 text-xs font-medium text-muted-foreground">Ort<Input value={editing.facility.city} onChange={(event) => setEditing({ ...editing, facility: { ...editing.facility, city: event.target.value } })} maxLength={120} /></label>
        </div>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Beskrivning<textarea className="form-textarea" value={editing.facility.description} onChange={(event) => setEditing({ ...editing, facility: { ...editing.facility, description: event.target.value } })} maxLength={2000} /></label>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditing(null)}>Avbryt</Button><Button type="submit" disabled={busy || !editing.facility.name.trim()}>Spara anläggning</Button></div>
      </form>}
    </Modal>
  </div>;
}

/** The register's link to a customer's card. */
export function CustomerCardLink({ customer }: { customer: Pick<CustomerItem, "id" | "name"> }) {
  return <Button asChild variant="outline"><Link aria-label={`Kundkort för ${customer.name}`} href={`/?view=customers&customerId=${encodeURIComponent(customer.id)}`}><ArrowRight />Kundkort</Link></Button>;
}
