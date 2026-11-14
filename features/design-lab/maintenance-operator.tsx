"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, Cog, Factory, ListChecks, MessageSquareWarning, QrCode, Rows3, Send, ShieldAlert, type LucideIcon } from "lucide-react";
import { ListGroup, ListRow } from "@/components/native/list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/features/kfid/ui";
import { PhotoPicker } from "@/features/self-inspection/deviation-photos";
import type { IndicatorTone } from "@/features/workflow/indicator-tone";
import { placeIcon, placeParentIds, PlaceTreeView, type PlaceTreeLevel } from "@/features/workflow/place-tree";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { useProposalLevel } from "./proposal-level";
import { FAULT_CAUSES, MACHINES, MY_REPORTS, SEVERITIES, type FaultReport, type MachineItem, type Part, type Severity } from "./maintenance-data";

/**
 * Operatör (2026-10-30): the machine's operator reports a fault – phone first, in the app's level-1 look (grouped
 * rows, big touch targets). Every step stands in its own fixed place on the one screen; nothing moves when a choice is made.
 * The result is an underhållspost (Felanmält filled) in a new work order on the part, or the company's approval list.
 */

const machineIcon = (item: MachineItem, level: PlaceTreeLevel): LucideIcon => level === "address" ? Factory : item.objectType === "Linje" ? Rows3 : placeIcon(item, level);
const SEVERITY_TONE = { Låg: "neutral", Normal: "info", Hög: "warning", Akut: "danger" } as const;
const STATUS_TONE = { Mottagen: "info", Pågår: "warning", Åtgärdad: "success" } as const;

/** The machine tree an account may see: its parts and the nodes above them (the maintenance module's tree, never the customer's places). */
export function machinesFor(partIds: readonly string[]): MachineItem[] {
  const byId = new Map(MACHINES.map((item) => [item.id, item]));
  const keep = new Set<string>();
  for (const item of MACHINES) if (item.part && partIds.includes(item.part)) {
    let current: MachineItem | undefined = item;
    while (current && !keep.has(current.id)) { keep.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined; }
  }
  return MACHINES.filter((item) => keep.has(item.id));
}

export function OperatorView({ parts, terminal = false }: {
  /** The parts the signed-in operator account may see. */
  parts: Part[];
  /** A shared terminal account ("Press 4"): each report asks for the reporter's name. */
  terminal?: boolean;
}) {
  const level = useProposalLevel();
  const machines = machinesFor(parts.map((item) => item.id));
  const [reporter, setReporter] = useState("");
  const [partId, setPartId] = useState<string | null>(null);
  const [fromQr, setFromQr] = useState(false);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(placeParentIds(machinesFor(parts.map((item) => item.id)))));
  const [cause, setCause] = useState("");
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [severity, setSeverity] = useState<Severity | "">("");
  const [offHours, setOffHours] = useState(true);
  const [aiSkipped, setAiSkipped] = useState(false);
  const [reports, setReports] = useState<FaultReport[]>(MY_REPORTS);
  const [onCall, setOnCall] = useState<"" | "waiting" | "acknowledged">("");
  const [nextOrder, setNextOrder] = useState(1070);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const part = parts.find((item) => item.id === partId) ?? null;
  const partLabel = part ? `${part.path} › ${part.name}` : "";
  const callsOnCall = severity === "Akut" || (severity === "Hög" && offHours);
  const missing = !part ? "Välj maskin först." : !cause ? "Välj orsak." : !severity ? "Välj hur allvarligt det är." : "";
  const toggle = (id: string) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const send = () => {
    if (!part || !severity) return;
    const order = `AO-${nextOrder}`;
    setNextOrder((value) => value + 1);
    setReports((list) => [{ id: `f-${Date.now()}`, part: partLabel, cause, severity, at: terminal && reporter.trim() ? `nu · ${reporter.trim()}` : "nu", order, status: "Mottagen" }, ...list]);
    announce(`Felanmälan skickad – arbetsorder ${order}`);
    setCause(""); setText(""); setPhotos([]); setSeverity(""); setAiSkipped(false); setReporter("");
    if (callsOnCall) {
      setOnCall("waiting");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOnCall("acknowledged"), 2500);
    } else setOnCall("");
  };

  const app = level === 1;
  const choice = (label: string, chosen: boolean, onPick: () => void, tone: IndicatorTone) => app
    ? <ListRow key={label} title={label} onClick={onPick} chevron={false} pill={chosen ? { label: "Vald", tone } : null} />
    : <Button key={label} type="button" role="radio" aria-checked={chosen} variant={chosen ? "default" : "outline"} onClick={onPick}>{label}</Button>;
  const choices = (label: string, children: ReactNode) => app ? children : <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">{children}</div>;
  const tree = <PlaceTreeView places={machines} open={open} onToggle={toggle} selected={MACHINES.find((item) => item.part === partId)?.id ?? null} icon={machineIcon}
    line={(item) => item.part ? parts.find((row) => row.id === item.part)?.status ?? "" : ""} label="Välj maskin"
    onOpen={(item) => { if (item.part) { setPartId(item.part); setFromQr(false); setPicking(false); } else toggle(item.id); }} testId="op-place-tree" />;
  const qrShown = parts.some((item) => item.id === "pump");
  const pickQr = () => { setPartId("pump"); setFromQr(true); setPicking(false); };

  const machineStep = app ? <>
    <ListGroup title="1. Maskin" testId="op-machine">
      <ListRow type="tools" icon={Cog} title={part ? part.name : "Välj maskin"} subtitle={part ? `${part.path}${fromQr ? " · Öppnad från QR-kod" : ""}` : "I underhållets maskinträd"}
        onClick={() => setPicking((value) => !value)} testId="op-pick" />
      {qrShown ? <ListRow type="neutral" icon={QrCode} title="Öppnad från QR-kod" subtitle="Exempel: Press 4 › Hydraulpump" onClick={pickQr} testId="op-qr" /> : null}
    </ListGroup>
    {picking ? <div className="native-group p-2" data-testid="op-tree">{tree}</div> : null}
  </> : <Panel icon={Cog} title="1. Maskin" actions={qrShown ? <Button type="button" variant="outline" onClick={pickQr} data-testid="op-qr"><QrCode />Öppnad från QR-kod</Button> : undefined}>
    <p className="mb-2 text-sm" data-testid="op-machine">{part ? <>Vald: <strong>{part.path} › {part.name}</strong>{fromQr ? " (från QR-kod)" : ""}</> : "Välj maskin i trädet."}</p>
    <div data-testid="op-tree">{tree}</div>
  </Panel>;
  const textStep = <div className="space-y-3">
    <textarea aria-label="Vad hände?" className="form-textarea min-h-24" maxLength={500} placeholder="Kort, till exempel: droppar olja under pumpen" value={text} onChange={(event) => setText(event.target.value)} />
    <PhotoPicker files={photos} onChange={setPhotos} label="Foto (frivilligt)" />
    {terminal ? <label className="grid gap-1.5 text-xs font-medium">Ditt namn (frivilligt)<Input className="font-normal" value={reporter} onChange={(event) => setReporter(event.target.value)} placeholder="Så vet vi vem som anmälde" data-testid="op-reporter" /></label> : null}
  </div>;
  const offHoursBox = <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="size-5" checked={offHours} onChange={(event) => setOffHours(event.target.checked)} />Utanför arbetstid (exempel)</label>;
  const onCallNote = <p className={cn("min-h-10 px-1 pt-1 text-xs", callsOnCall ? "font-medium text-destructive" : "text-muted-foreground")} data-testid="op-oncall-note">
    {callsOnCall ? "Jouren (Elis Berg) kontaktas när du skickar." : "Jouren kontaktas vid Akut, och vid Hög utanför arbetstid."}
  </p>;
  // Kommer senare: AI looks for the cause first. Marked clearly as a later step and a suggestion only.
  const aiStep = <div className={cn("rounded-[var(--radius-panel)] border border-dashed p-3", aiSkipped && "opacity-60")} data-testid="op-ai">
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Bot className="size-4" aria-hidden="true" />Kommer senare: AI felsöker först</p>
    <p className="mt-2 text-sm">Förslag: kontrollera filtret. De senaste 3 gångerna var det igensatt.</p>
    <p className="mt-1 text-xs text-muted-foreground">Underlag: AO-1031, AO-1019, AO-1004 och oljetemperaturen senaste dygnet.</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" className={app ? "h-11" : undefined} disabled={aiSkipped} onClick={() => setAiSkipped(true)}>Hoppa över</Button>
      <span className="text-xs text-muted-foreground">Bara ett förslag. Säkerhetsbeslut tas av en person.</span>
    </div>
  </div>;
  const sendStep = <div className="space-y-2 pt-3">
    <Button type="button" className="h-12 w-full text-base" disabledReason={missing} onClick={send} data-testid="op-send"><Send />Skicka felanmälan</Button>
    <p className="min-h-5 px-1 text-xs text-muted-foreground">{missing || "Blir en underhållspost på delen i en ny arbetsorder – eller i godkännandelistan om företaget valt det."}</p>
    <p className="flex items-start gap-1.5 px-1 text-xs text-muted-foreground"><ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />Workflow är inget larm- eller säkerhetssystem. Vid fara: följ företagets rutin.</p>
  </div>;
  const onCallRows = onCall === "waiting" ? <ListRow type="risk" icon={AlertTriangle} title="Jouren (Elis Berg) kontaktas" subtitle="Väntar på kvittens" pill={{ label: "Väntar", tone: "warning" }} chevron={false} />
    : onCall === "acknowledged" ? <ListRow type="risk" icon={AlertTriangle} title="Jouren (Elis Berg) har tagit emot" subtitle="Kvitterat 02:14" pill={{ label: "Kvitterat", tone: "success" }} chevron={false} testId="op-acknowledged" />
    : <ListRow title="Ingen jour kontaktad" subtitle="Visas här när jouren kontaktas" chevron={false} />;
  const reportRows = reports.map((report) => <ListRow key={report.id} type="tools" icon={MessageSquareWarning} title={`${report.cause} · ${report.part.split(" › ").pop()}`}
    subtitle={`${report.at} · ${report.severity} · ${report.order}`} pill={{ label: report.status, tone: STATUS_TONE[report.status] }} chevron={false} />);
  const statusRows = parts.map((item) => <ListRow key={item.id} title={item.name} subtitle={item.path} chevron={false}
    pill={{ label: item.status, tone: item.status === "Ur drift" ? "danger" : item.status === "Service snart" ? "warning" : "success" }} />);

  if (app) return <div className="mx-auto w-full max-w-md space-y-1" data-testid="mm-operator">
    {machineStep}
    <ListGroup title="2. Orsak" footer="Listan är företagets egen." testId="op-cause">{FAULT_CAUSES.map((item) => choice(item, cause === item, () => setCause(item), "info"))}</ListGroup>
    <ListGroup title="3. Vad hände?" testId="op-text"><div className="p-3">{textStep}</div></ListGroup>
    <ListGroup title="4. Hur allvarligt?" testId="op-severity" footer={offHoursBox}>{SEVERITIES.map((item) => choice(item.text, severity === item.id, () => setSeverity(item.id), SEVERITY_TONE[item.id]))}</ListGroup>
    {onCallNote}
    {aiStep}
    {sendStep}
    <ListGroup title="Jour" testId="op-oncall">{onCallRows}</ListGroup>
    <ListGroup title="Mina felanmälningar" testId="op-reports">{reportRows}</ListGroup>
    <ListGroup title="Mina maskiner" testId="op-status">{statusRows}</ListGroup>
  </div>;

  // Levels 2–3: the steps as panels to the left, Jour, the own reports and the machines' status to the right.
  return <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] [&>*]:min-w-0" data-testid="mm-operator">
    <div className="space-y-6">
      {machineStep}
      <Panel icon={ListChecks} title="2. Orsak"><div data-testid="op-cause">{choices("Orsak", FAULT_CAUSES.map((item) => choice(item, cause === item, () => setCause(item), "info")))}</div></Panel>
      <Panel icon={MessageSquareWarning} title="3. Vad hände?"><div data-testid="op-text">{textStep}</div></Panel>
      <Panel icon={AlertTriangle} title="4. Hur allvarligt?">
        <div data-testid="op-severity">{choices("Hur allvarligt?", SEVERITIES.map((item) => choice(item.text, severity === item.id, () => setSeverity(item.id), SEVERITY_TONE[item.id])))}</div>
        <div className="mt-2">{offHoursBox}</div>
        {onCallNote}
      </Panel>
      {aiStep}
      {sendStep}
    </div>
    <div className="space-y-6">
      <Panel icon={AlertTriangle} title="Jour"><div className="native-group" data-testid="op-oncall">{onCallRows}</div></Panel>
      <Panel icon={MessageSquareWarning} title="Mina felanmälningar"><div className="native-group" data-testid="op-reports">{reportRows}</div></Panel>
      <Panel icon={Cog} title="Mina maskiner"><div className="native-group" data-testid="op-status">{statusRows}</div></Panel>
    </div>
  </div>;
}
