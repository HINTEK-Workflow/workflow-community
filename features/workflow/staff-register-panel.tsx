"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, LogIn, LogOut, PencilLine, ShieldCheck, UserPlus, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Modal, Panel } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { formatSwedish, fromSwedishDateTimeInputKeeping, NONEXISTENT_TIME_ERROR, swedishDayKey, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { NEEDS_ID_NUMBER } from "@/lib/staff-register/model";
import { announce } from "@/lib/workflow/toast";
import { jobCheckIn, jobCheckInText, keepsWorkflowRegister } from "@/lib/workflow/staff-register";
import { ListGroup, ListRow } from "@/components/native";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useLoadEffect } from "@/lib/use-load-effect";
import { DownloadButton } from "@/components/ui/download-button";

/**
 * Personalliggare, steg 1 (2026-10-09: "klarar kraven men inte mer"). The project's register: one big Checka in /
 * Checka ut button for yourself (your identity number is asked for once), your own rows with Rätta and Registrera i
 * efterhand, and – for those with the rights – who is on site, registering others (also people who are not members)
 * and the Kontrollvy with PDF and CSV (also for the project's responsible person, access.control). A person checked in
 * right now without that right gets "Visa för Skatteverket" (2026-10-10): the same view for today only, without
 * period, person or export, and the server logs every opening. The server decides
 * every right again; this page only shows what it may do. The panel never hides or locks for a Cloud payment block:
 * the register is exempt from it (lib/staff-register/routes.ts).
 */
type Person = { id: string; userId: string | null; name: string; idNumberMasked: string; employerName: string; employerOrgNo: string };
type Status = {
  project: { id: string; name: string; siteId: string };
  access: { self: boolean; control: boolean; others: boolean };
  me: { person: Person | null; onSite: boolean; since: string | null };
  /** False when new rows are not allowed (no valid Cloud agreement; an overdue invoice alone never stops the register). */
  writable?: boolean;
  onSite: { personId: string; name: string; idNumber: string; employer: string; since: string }[];
  people: Person[];
  today: string;
};
type OwnRow = { id: string; kind: "IN" | "OUT" | "VOID"; occurredAt: string; registeredAt: string; correctsId: string | null; reason: string; registeredBy: string };
type ControlRow = { id: string; personId: string; number: number; name: string; idNumber: string; employer: string; employerOrgNo: string; kind: string; time: string; registered: string; registeredBy: string; corrects: string; correctsId: string | null; corrected: boolean; reason: string; occurredAt: string };
type Control = { limited?: boolean; project: Status["project"]; company: { name: string; orgNo: string }; from: string; to: string; rows: ControlRow[]; onSite: { personId: string; name: string; idNumber: string; employer: string; employerOrgNo: string; since: string }[] };

const post = <T = Record<string, unknown>>(input: unknown) => api<T>("/api/staff-register", { method: "POST", body: JSON.stringify(input) });
const time = (value: string) => formatSwedish(value, { hour: "2-digit", minute: "2-digit" });
const dayTime = (value: string) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
const KIND: Record<OwnRow["kind"], string> = { IN: "In", OUT: "Ut", VOID: "Struken" };
/** Sent after a check-in made outside the panel (the toast after Starta tid), so an open panel reads its state again. */
const CHANGED_EVENT = "hwf-staff-register";
const isDemo = () => typeof window !== "undefined" && Boolean((window as typeof window & { __workflowDemo?: boolean }).__workflowDemo);

/** Checks the signed-in person in on a project (the toast after Starta tid). Returns the message to show. */
export async function checkInFromTimer(projectId: string): Promise<{ text: string; error: boolean }> {
  try {
    const status = await api<Status>(`/api/staff-register?projectId=${encodeURIComponent(projectId)}`);
    if (status.me.onSite) return { text: `Du är redan incheckad i personalliggaren sedan ${time(status.me.since ?? "")}.`, error: false };
    await post({ action: "check", projectId, kind: "IN" });
    window.dispatchEvent(new Event(CHANGED_EVENT));
    return { text: "Du är incheckad i personalliggaren.", error: false };
  } catch (issue) {
    const details = (issue as { details?: { code?: string } }).details;
    return { text: details?.code === NEEDS_ID_NUMBER ? "Skriv ditt personnummer i projektets personalliggare en gång, så kan du checka in." : (issue as Error).message, error: true };
  }
}

/** Whether the signed-in person is checked in on the project; null when it cannot be read. */
export async function staffRegisterOnSite(projectId: string) {
  try { return (await api<Status>(`/api/staff-register?projectId=${encodeURIComponent(projectId)}`)).me.onSite; } catch { return null; }
}

/**
 * "Checka in här" / "Checka ut" on a job (2026-10-12): the project's own check-in (the same API and rules as the
 * panel) in the job's header (variant "button", level 2–3) or as the first row of the job (variant "row", level 1).
 * Nothing is shown unless the project keeps Workflow's register and the person may check in; it switches nothing on.
 */
export function JobCheckIn({ project, variant }: { project: { id: string; staffRegister?: unknown; archivedAt?: string | null; closedAt?: string | null }; variant: "row" | "button" }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const projectId = project.id;
  const demo = isDemo();
  const load = useCallback(async () => {
    try { setStatus(await api<Status>(`/api/staff-register?projectId=${encodeURIComponent(projectId)}`)); } catch { setStatus(null); }
  }, [projectId]);
  // A project that does not keep the register in Workflow answers 409: do not ask (no console error).
  const keeps = keepsWorkflowRegister(project);
  useLoadEffect(load, !demo && keeps);
  useEffect(() => {
    if (demo || !keeps) return;
    const reload = () => void load();
    window.addEventListener(CHANGED_EVENT, reload);
    return () => window.removeEventListener(CHANGED_EVENT, reload);
  }, [demo, keeps, load]);
  const state = demo ? null : jobCheckIn(project, status);
  if (!state) return null;
  const text = jobCheckInText(state, time);
  async function press() {
    if (!state) return;
    if (state.needsIdNumber) {
      // The identity number is asked for once, in the register panel (here on the page, or on the project page).
      const panel = document.getElementById("personalliggare");
      if (panel) { panel.scrollIntoView({ block: "start" }); panel.focus(); } else router.push(`/?view=project&projectId=${encodeURIComponent(projectId)}`);
      return;
    }
    setBusy(true);
    try {
      await post({ action: "check", projectId, kind: state.kind });
      window.dispatchEvent(new Event(CHANGED_EVENT));
      announce(state.kind === "IN" ? "Du är incheckad." : "Du är utcheckad.");
    } catch (issue) { announce((issue as Error).message, true); }
    finally { setBusy(false); }
  }
  if (variant === "row") return <ListGroup testId="job-checkin-row"><ListRow type="checkin" title={state.label} subtitle={state.needsIdNumber ? "Skriv ditt personnummer först" : text} onClick={() => void press()} testId="job-checkin" /></ListGroup>;
  return <>
    <Button type="button" variant={state.kind === "OUT" ? "outline" : "default"} disabled={busy} onClick={() => void press()} data-testid="job-checkin">{state.kind === "OUT" ? <LogOut /> : <LogIn />}{state.label}</Button>
    <span className="self-center text-xs text-muted-foreground" role="status" data-testid="job-checkin-state">{state.needsIdNumber ? "Personnummer saknas" : text}</span>
  </>;
}

export function StaffRegisterPanel({ projectId, locked = false, keepOpen = false, moduleOff = false }: { projectId: string; locked?: boolean;
  /** Företagets moduler (0.39.0): Personalliggare is off. The Kontrollvy and its export are always there; nobody checks in, whoever is checked in can check out. */
  moduleOff?: boolean; /** On a task page: never folded by a display level. */ keepOpen?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [idNumber, setIdNumber] = useState("");
  const [foreign, setForeign] = useState(false);
  const [mine, setMine] = useState<OwnRow[] | null>(null);
  const [fixing, setFixing] = useState<{ eventId?: string; personId?: string; kind: "IN" | "OUT" | "VOID"; at: string; /** The saved instant a correction starts from: kept while the field still shows it (the repeated October hour). */ savedAt?: string; reason: string; title: string } | null>(null);
  const [adding, setAdding] = useState(false);
  // "full" is the Kontrollvy; "today" is "Visa för Skatteverket" for a checked-in person without the Kontrollvy right.
  const [control, setControl] = useState<false | "full" | "today">(false);
  // Bumped after every change, so an open Kontrollvy reads the register again.
  const [stamp, setStamp] = useState(0);
  const demo = isDemo();

  const load = useCallback(async () => {
    try { setStatus(await api<Status>(`/api/staff-register?projectId=${encodeURIComponent(projectId)}`)); setError(""); }
    catch (issue) { setError((issue as Error).message); }
  }, [projectId]);
  const loadMine = useCallback(async () => {
    try { setMine((await api<{ rows: OwnRow[] }>(`/api/staff-register?projectId=${encodeURIComponent(projectId)}&mine=1`)).rows); }
    catch (issue) { setError((issue as Error).message); }
  }, [projectId]);
  useLoadEffect(load, !demo);
  useEffect(() => {
    if (demo) return;
    const reload = () => void load();
    window.addEventListener(CHANGED_EVENT, reload);
    return () => window.removeEventListener(CHANGED_EVENT, reload);
  }, [demo, load]);

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true); setError("");
    try { await work(); setStamp((value) => value + 1); await load(); if (mine) await loadMine(); window.dispatchEvent(new Event(CHANGED_EVENT)); if (done) announce(done); return true; }
    catch (issue) { setError((issue as Error).message); return false; }
    finally { setBusy(false); }
  }
  const check = (kind: "IN" | "OUT", personId?: string, name?: string) => run(() => post({ action: "check", projectId, kind, personId }),
    personId ? `${name ?? "Personen"} är ${kind === "IN" ? "incheckad" : "utcheckad"}.` : kind === "IN" ? "Du är incheckad." : "Du är utcheckad.");
  const saveId = () => run(async () => {
    await post({ action: "save_my_id", idNumber, foreign });
    await post({ action: "check", projectId, kind: "IN" });
    setIdNumber("");
  }, "Personnumret är sparat och du är incheckad.");

  if (demo) return <Panel icon={ClipboardList} title="Personalliggare"><p className="text-sm text-muted-foreground">Personalliggaren i Workflow finns inte i demon.</p></Panel>;
  if (!status) return <Panel icon={ClipboardList} title="Personalliggare">{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p role="status" className="text-sm text-muted-foreground">Hämtar personalliggaren…</p>}</Panel>;

  const { me, access } = status;
  const paused = status.writable === false;
  return <div id="personalliggare" tabIndex={-1}>
    <Panel icon={ClipboardList} title="Personalliggare" keepOpen={keepOpen} description={`Byggarbetsplatsens id-nr ${status.project.siteId}. Checka in när arbetspasset börjar och ut när det slutar.`}
      actions={access.control ? <Button variant="outline" onClick={() => setControl("full")} data-testid="staff-register-control-open"><ClipboardCheck />Kontrollvy</Button> : undefined}>
      <div className="space-y-5" data-testid="staff-register-panel">
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {paused ? <p className="notice" data-testid="staff-register-paused">Företaget har inget giltigt Cloud-avtal. Personalliggaren går att läsa och exportera men inte registrera i.</p> : locked ? <p className="notice">Projektet är arkiverat. Personalliggaren går att läsa men inte registrera i.</p> : !me.person ? (
          <form className="field-group space-y-3 rounded-xl border p-4" onSubmit={(event) => { event.preventDefault(); void saveId(); }} data-testid="staff-register-own-id">
            <p className="text-sm"><span className="font-medium">Skriv ditt personnummer en gång.</span> <span className="text-muted-foreground">Det ska stå i personalliggaren och visas bara i kontrollvyn.</span></p>
            <label className="block space-y-2 text-xs font-medium text-muted-foreground">{foreign ? "Utländskt id-nummer" : "Personnummer eller samordningsnummer"}
              <Input value={idNumber} onChange={(event) => setIdNumber(event.target.value)} inputMode={foreign ? "text" : "numeric"} autoComplete="off" placeholder={foreign ? "" : "ÅÅÅÅMMDD-NNNN"} maxLength={40} data-testid="staff-register-own-id-input" />
            </label>
            <label className="flex items-center gap-3 text-sm"><Checkbox checked={foreign} onCheckedChange={(value) => setForeign(value === true)} />Jag har inget svenskt personnummer eller samordningsnummer</label>
            <Button type="submit" size="xl" className="w-full sm:w-auto" disabled={busy || !idNumber.trim()}><LogIn />Spara och checka in</Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {moduleOff && !me.onSite ? null : <Button size="xl" className="w-full sm:w-auto sm:min-w-56" variant={me.onSite ? "outline" : "default"} disabled={busy}
              onClick={() => void check(me.onSite ? "OUT" : "IN")} data-testid="staff-register-check">{me.onSite ? <><LogOut />Checka ut</> : <><LogIn />Checka in</>}</Button>}
            <p className="text-sm" role="status" data-testid="staff-register-state">{me.onSite && me.since ? <>Du är <span className="font-medium">incheckad sedan {time(me.since)}</span>.</> : "Du är inte incheckad."} <span className="text-muted-foreground">{me.person.name} · {me.person.idNumberMasked}</span></p>
          </div>
        )}

        {me.onSite && !access.control ? <div className="space-y-2" data-testid="staff-register-onsite">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => setControl("today")} data-testid="staff-register-onsite-open"><ShieldCheck />Visa för Skatteverket</Button>
          <p className="text-xs text-muted-foreground">Vid ett kontrollbesök: visar dagens registreringar på byggarbetsplatsen. Varje visning sparas i företagets historik.</p>
        </div> : null}

        {me.person ? <details className="group rounded-xl border" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !mine) void loadMine(); }}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">Mina registreringar</summary>
          <div className="space-y-3 border-t px-4 py-3">
            {!(locked || paused) ? <Button variant="outline" onClick={() => setFixing({ personId: me.person!.id, kind: me.onSite ? "OUT" : "IN", at: toSwedishDateTimeInput(new Date()), reason: "", title: "Registrera i efterhand" })}><PencilLine />Registrera i efterhand</Button> : null}
            {mine === null ? <p role="status" className="text-sm text-muted-foreground">Hämtar…</p> : mine.length ? <ul className="divide-y text-sm">{mine.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className={cn(mine.some((other) => other.correctsId === row.id) && "text-muted-foreground line-through")}>{row.correctsId ? "Rättelse: " : ""}{KIND[row.kind]} {dayTime(row.occurredAt)}{row.reason ? ` · ${row.reason}` : ""}<span className="block text-xs text-muted-foreground no-underline">Registrerad {dayTime(row.registeredAt)} av {row.registeredBy}</span></span>
              {!row.correctsId && !(locked || paused) ? <Button variant="outline" onClick={() => setFixing({ eventId: row.id, kind: row.kind === "VOID" ? "IN" : row.kind, at: toSwedishDateTimeInput(row.occurredAt), savedAt: row.occurredAt, reason: "", title: "Rätta registrering" })}>Rätta</Button> : null}
            </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga registreringar de senaste två veckorna.</p>}
          </div>
        </details> : null}

        {access.control || access.others ? <section aria-label="På plats nu" data-testid="staff-register-on-site">
          <h3 className="text-sm font-semibold">På plats nu ({status.onSite.length})</h3>
          {status.onSite.length ? <ul className="mt-2 divide-y rounded-xl border text-sm">{status.onSite.map((person) => <li key={person.personId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <span><span className="font-medium">{person.name}</span> <span className="text-muted-foreground">{person.idNumber} · {person.employer} · sedan {time(person.since)}</span></span>
            {access.others && !(locked || paused) && person.personId !== me.person?.id ? <Button variant="outline" disabled={busy} onClick={() => void check("OUT", person.personId, person.name)}><LogOut />Checka ut</Button> : null}
          </li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">Ingen är incheckad.</p>}
        </section> : null}

        {access.others && !(locked || paused || moduleOff) ? <Button variant="outline" onClick={() => setAdding(true)} data-testid="staff-register-add"><UserPlus />Checka in någon annan</Button> : null}
      </div>
    </Panel>

    {fixing ? <Modal open onOpenChange={(open) => { if (!open) setFixing(null); }} title={fixing.title} size="form">
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        // An unchanged field keeps the saved instant; a clock time that does not exist is refused (2026-10-21).
        const at = fromSwedishDateTimeInputKeeping(fixing.at, fixing.savedAt);
        if (fixing.kind !== "VOID" && !at) { setError(fixing.at ? NONEXISTENT_TIME_ERROR : "Välj datum och tid."); return; }
        void run(() => fixing.eventId
          ? post({ action: "correct", eventId: fixing.eventId, kind: fixing.kind, occurredAt: at?.toISOString(), reason: fixing.reason })
          : post({ action: "check", projectId, personId: fixing.personId === me.person?.id ? undefined : fixing.personId, kind: fixing.kind, occurredAt: at?.toISOString(), reason: fixing.reason }),
        fixing.eventId ? "Rättelsen är registrerad. Den ursprungliga raden finns kvar." : "Registreringen är gjord.").then((ok) => { if (ok) setFixing(null); });
      }}>
        <fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-xs font-medium text-muted-foreground">Händelse</legend>
          {(fixing.eventId ? ["IN", "OUT", "VOID"] as const : ["IN", "OUT"] as const).map((kind) => <Button key={kind} type="button" variant={fixing.kind === kind ? "default" : "outline"} aria-pressed={fixing.kind === kind} onClick={() => setFixing({ ...fixing, kind })}>{kind === "IN" ? "Incheckning" : kind === "OUT" ? "Utcheckning" : "Stryk raden"}</Button>)}
        </fieldset>
        {fixing.kind !== "VOID" ? <label className="block space-y-2 text-xs font-medium text-muted-foreground">Tidpunkt
          <Input type="datetime-local" value={fixing.at} max={toSwedishDateTimeInput(new Date())} onChange={(event) => setFixing({ ...fixing, at: event.target.value })} />
        </label> : null}
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Skäl
          <Input value={fixing.reason} maxLength={300} placeholder={fixing.eventId ? "Till exempel: fel tid, glömde checka ut" : "Till exempel: telefonen var urladdad"} onChange={(event) => setFixing({ ...fixing, reason: event.target.value })} />
        </label>
        <p className="text-xs text-muted-foreground">Inget skrivs över. {fixing.eventId ? "Rättelsen läggs till under den ursprungliga raden" : "Registreringen sparas"} med ditt namn och tiden nu.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setFixing(null)}>Avbryt</Button><Button type="submit" disabled={busy || !fixing.reason.trim()}>Spara</Button></div>
      </form>
    </Modal> : null}

    {adding ? <OtherPersonDialog status={status} busy={busy} onClose={() => setAdding(false)}
      onCheckIn={async (person) => { const ok = await run(async () => {
        const saved = person.id ? { id: person.id } : (await post<{ person: Person }>({ action: "save_person", person: person.input })).person;
        await post({ action: "check", projectId, personId: saved.id, kind: "IN" });
      }, "Personen är incheckad."); if (ok) setAdding(false); }} /> : null}

    {control ? <ControlView projectId={projectId} today={status.today} stamp={stamp} limited={control === "today"} canCorrect={control === "full" && access.others && !(locked || paused)} onClose={() => setControl(false)}
      onCorrect={(row) => setFixing({ eventId: row.id, kind: row.kind === "Ut" ? "OUT" : "IN", at: toSwedishDateTimeInput(row.occurredAt), savedAt: row.occurredAt, reason: "", title: `Rätta rad ${row.number}` })} /> : null}
  </div>;
}

type OtherInput = { name: string; idNumber: string; foreign: boolean; employerName: string; employerOrgNo: string; userId?: string };
function OtherPersonDialog({ status, busy, onClose, onCheckIn }: { status: Status; busy: boolean; onClose: () => void; onCheckIn: (person: { id?: string; input?: OtherInput }) => Promise<void> }) {
  const here = new Set(status.onSite.map((person) => person.personId));
  const known = status.people.filter((person) => !here.has(person.id) && person.id !== status.me.person?.id);
  const [pick, setPick] = useState(known[0]?.id ?? "new");
  const [input, setInput] = useState<OtherInput>({ name: "", idNumber: "", foreign: false, employerName: "", employerOrgNo: "" });
  const field = (key: "name" | "idNumber" | "employerName" | "employerOrgNo", label: string, extra: Partial<React.ComponentProps<typeof Input>> = {}) => <label className="block space-y-2 text-xs font-medium text-muted-foreground">{label}
    <Input value={input[key]} onChange={(event) => setInput({ ...input, [key]: event.target.value })} autoComplete="off" {...extra} />
  </label>;
  return <DialogPage pageKey="checka-in" size="form" panelTitle="Person" open onOpenChange={(open) => { if (!open) onClose(); }} title="Checka in någon annan">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onCheckIn(pick === "new" ? { input } : { id: pick }); }}>
      <label className="block space-y-2 text-xs font-medium text-muted-foreground">Person
        <select className="form-select w-full" value={pick} onChange={(event) => setPick(event.target.value)} data-testid="staff-register-person-pick">
          {known.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.idNumberMasked} · {person.employerName}</option>)}
          <option value="new">Ny person …</option>
        </select>
      </label>
      {pick === "new" ? <div className="field-group grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
        {field("name", "Namn", { maxLength: 120 })}
        {field("idNumber", input.foreign ? "Utländskt id-nummer" : "Personnummer eller samordningsnummer", { maxLength: 40, inputMode: input.foreign ? "text" : "numeric", placeholder: input.foreign ? "" : "ÅÅÅÅMMDD-NNNN" })}
        <label className="flex items-center gap-3 text-sm sm:col-span-2"><Checkbox checked={input.foreign} onCheckedChange={(value) => setInput({ ...input, foreign: value === true })} />Har inget svenskt personnummer eller samordningsnummer</label>
        {field("employerName", "Arbetsgivare", { maxLength: 160 })}
        {field("employerOrgNo", "Arbetsgivarens organisationsnummer", { maxLength: 20, inputMode: "numeric", placeholder: "NNNNNN-NNNN" })}
        <p className="text-xs text-muted-foreground sm:col-span-2">Till exempel en underentreprenörs personal eller inhyrd personal. En medarbetare i företaget skriver sitt eget personnummer på projektets sida.</p>
      </div> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Avbryt</Button><Button type="submit" disabled={busy}><LogIn />Checka in</Button></div>
    </form>
  </DialogPage>;
}

/**
 * The Kontrollvy (SKVFS 2015:6 13–14 §§): today at once, another day or period, one person; PDF and CSV in one tap.
 * `limited` is "Visa för Skatteverket": today only, no period, person or export (the server refuses them anyway).
 */
function ControlView({ projectId, today, stamp, limited = false, canCorrect, onClose, onCorrect }: { projectId: string; today: string; stamp: number; limited?: boolean; canCorrect: boolean; onClose: () => void; onCorrect: (row: ControlRow) => void }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [personId, setPersonId] = useState("");
  const [data, setData] = useState<Control | null>(null);
  const [error, setError] = useState("");
  const query = `projectId=${encodeURIComponent(projectId)}&from=${from}&to=${to}${personId ? `&personId=${encodeURIComponent(personId)}` : ""}`;
  useEffect(() => {
    let alive = true;
    api<Control>(`/api/staff-register?control=1&${query}`).then((next) => { if (alive) { setData(next); setError(""); } }).catch((issue) => { if (alive) setError((issue as Error).message); });
    return () => { alive = false; };
  }, [query, stamp]);
  const people = data ? [...new Map(data.rows.map((row) => [row.personId, row.name])).entries()] : [];
  return <DialogPage pageKey="kontrollvy" size="page" width="wide" panelTitle={limited ? "Dagens registreringar" : "Registreringar"} open onOpenChange={(open) => { if (!open) onClose(); }} title={limited ? "Visa för Skatteverket – personalliggare" : "Kontrollvy – personalliggare"}>
    <div className="space-y-4" data-testid="staff-register-control" data-limited={limited ? "true" : undefined}>
      {limited ? <p className="notice" data-testid="staff-register-onsite-notice">Dagens registreringar på byggarbetsplatsen ({today}). Andra dagar och export finns hos den som har rätt till kontrollvyn. Visningen sparas i företagets historik.</p> : <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Från<Input type="date" value={from} max={today} onChange={(event) => { setFrom(event.target.value); if (event.target.value > to) setTo(event.target.value); }} /></label>
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Till<Input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Person
          <select className="form-select" value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Alla</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </label>
        <div className="flex gap-2">
          <DownloadButton href={`/api/staff-register/export?format=pdf&${query}`} download data-testid="staff-register-pdf">PDF</DownloadButton>
          <DownloadButton href={`/api/staff-register/export?format=csv&${query}`} download data-testid="staff-register-csv">CSV</DownloadButton>
        </div>
      </div>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!data ? <p role="status" className="text-sm text-muted-foreground">Hämtar…</p> : <>
        <p className="text-sm">{data.company.name}{data.company.orgNo ? `, org.nr ${data.company.orgNo}` : ""} · Byggarbetsplatsens id-nr <span className="font-medium">{data.project.siteId}</span></p>
        <section aria-label="På plats nu">
          <h3 className="text-sm font-semibold">På plats nu ({data.onSite.length})</h3>
          {data.onSite.length ? <ul className="mt-2 divide-y rounded-xl border text-sm">{data.onSite.map((person) => <li key={person.personId} className="px-4 py-2"><span className="font-medium">{person.name}</span> {person.idNumber} · {person.employer}{person.employerOrgNo ? ` (${person.employerOrgNo})` : ""} · sedan {time(person.since)}</li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">Ingen är incheckad.</p>}
        </section>
        <section aria-label="Registreringar">
          <h3 className="text-sm font-semibold">Registreringar {data.from === data.to ? data.from : `${data.from} – ${data.to}`} ({data.rows.length})</h3>
          <div className="mt-2 max-h-[55vh] overflow-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="sticky top-0 bg-muted"><tr>{["Nr", "Namn", "Personnummer", "Arbetsgivare", "Händelse", "Tidpunkt", "Registrerad", "Rättelse / skäl", ""].map((label) => <th key={label} className="px-2 py-2 font-semibold">{label}</th>)}</tr></thead>
              <tbody className="divide-y">{data.rows.length ? data.rows.map((row) => <tr key={row.id} className={cn(row.corrected && "text-muted-foreground line-through")}>
                <td className="px-2 py-2">{row.number}</td><td className="px-2 py-2">{row.name}</td><td className="px-2 py-2 whitespace-nowrap">{row.idNumber}</td>
                <td className="px-2 py-2">{row.employer}{row.employerOrgNo ? `, ${row.employerOrgNo}` : ""}</td><td className="px-2 py-2">{row.kind}</td>
                <td className="px-2 py-2 whitespace-nowrap">{row.time}</td><td className="px-2 py-2">{row.registered}<span className="block">{row.registeredBy}</span></td>
                <td className="px-2 py-2">{row.corrects ? `Rättar rad ${row.corrects}${row.reason ? `: ${row.reason}` : ""}` : row.reason}</td>
                <td className="px-2 py-2">{canCorrect && !row.correctsId ? <Button variant="outline" size="sm" onClick={() => onCorrect(row)}>Rätta</Button> : null}</td>
              </tr>) : <tr><td colSpan={9} className="px-2 py-3 text-muted-foreground">Inga registreringar under perioden.</td></tr>}</tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Tider som ÅÅÅÅ:MM:DD TT:MM:SS. Rättelser står under raden de rättar; inget tas bort. Hämtad {swedishDayKey(new Date())} {time(new Date().toISOString())}.</p>
        </section>
      </>}
    </div>
  </DialogPage>;
}
