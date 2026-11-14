"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, CheckCircle2, Cog, Factory, ListChecks, MessageSquareWarning, Plus, Rows3, Send, ShieldAlert, type LucideIcon } from "lucide-react";
import { ListGroup, ListRow } from "@/components/native/list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/features/kfid/ui";
import { PhotoPicker } from "@/features/self-inspection/deviation-photos";
import { indicatorText } from "@/features/workflow/indicator-tone";
import { placeIcon, placeParentIds, PlaceTreeView, type PlaceTreeLevel } from "@/features/workflow/place-tree";
import type { FacilityItem } from "@/lib/workflow/customer-facility";
import type { DetailLevel } from "@/lib/workflow/detail-level";
import { formatSwedishTime } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { callsOnCall, NOT_AN_ALARM_SYSTEM, ON_CALL_NOTE, REPORT_PHOTO_LIMIT, REPORTER_NAME_MAX, REPORT_TEXT_MAX, SEVERITIES, SEVERITY_LABELS, SEVERITY_TONE, type Severity } from "@/lib/operator/rules";
import type { TroubleshootSuggestion } from "@/lib/operator/troubleshoot";
import { OperatorApiError, type OperatorApi, type OperatorMachine, type OperatorPageData, type SentReport } from "./operator-api";

/**
 * Felanmälan på operatörssidan (2026-10-30): välj maskin i underhållets maskinträd (bara de maskiner kontot ser,
 * eller öppnad från en QR-kod), orsak ur företagets lista, vad som hänt med frivilliga foton, hur allvarligt, och på ett
 * delat konto "Ditt namn". Every step stands in its own fixed place; nothing moves when a choice is made. Level 1 draws the
 * app's grouped rows with big touch targets; levels 2–3 the steps as panels with Jour, Mina felanmälningar and Mina maskiner
 * to the right. After Skicka the receipt takes the form's place (a big check, the number, whether the on-call person is
 * contacted and Ny felanmälan), so nobody sends twice by mistake. A QR link to a machine the account does not see says so.
 */
type TreeItem = FacilityItem & { node: OperatorMachine };
const machineIcon = (item: TreeItem, level: PlaceTreeLevel): LucideIcon => level === "address" && !item.node.reportable ? Factory : item.objectType === "Linje" ? Rows3 : placeIcon(item, level);
const asTreeItem = (node: OperatorMachine): TreeItem => ({ id: node.id, customerId: "", parentId: node.parentId, name: node.name, objectType: node.objectType, address: "", postalCode: "", city: "", description: "", isActive: true, node });

export function ReportView({ api, data, level, initialMachine, onReload, onLoggedOut }: {
  api: OperatorApi;
  data: OperatorPageData;
  level: DetailLevel;
  /** A machine opened from a QR code (`?maskin=`), when the account sees it. */
  initialMachine: string | null;
  onReload: (poll?: boolean) => Promise<void>;
  onLoggedOut: (message: string) => void;
}) {
  const app = level === 1;
  const machines = data.machines;
  const fromQr = Boolean(initialMachine && machines.some((node) => node.id === initialMachine && node.reportable));
  const receiptRef = useRef<HTMLDivElement>(null);
  const [machineId, setMachineId] = useState<string | null>(fromQr ? initialMachine : null);
  const [picking, setPicking] = useState(!fromQr && app);
  const treeItems = useMemo(() => machines.map(asTreeItem), [machines]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(placeParentIds(treeItems)));
  const [cause, setCause] = useState("");
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [severity, setSeverity] = useState<Severity | "">("");
  const [reporter, setReporter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<SentReport | null>(null);
  const IDLE = { state: "idle" as const, key: "", suggestions: [] as TroubleshootSuggestion[], note: "" };
  const [ai, setAi] = useState<{ state: "idle" | "busy" | "done" | "skipped"; key: string; suggestions: TroubleshootSuggestion[]; note: string }>(IDLE);
  const machine = machines.find((node) => node.id === machineId) ?? null;
  const qrOutside = Boolean(initialMachine && !fromQr && !machine);
  const onCall = severity ? callsOnCall(severity, new Date(), data.workday) : false;
  const missing = !machines.length ? "Du ser inga maskiner än. Kontakta din administratör." : !machine ? "Välj maskin först." : !cause ? "Välj orsak." : !severity ? "Välj hur allvarligt det är." : "";
  const toggle = (id: string) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const waiting = data.reports.some((report) => report.onCall.state === "waiting");

  // Väntar på kvittens: the page asks again now and then (not counted as activity).
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => { void onReload(true); }, 20_000);
    return () => clearInterval(timer);
  }, [waiting, onReload]);

  // The receipt replaces the form: the eye and a screen reader are taken to it, wherever Skicka stood on a long page.
  useEffect(() => { if (receipt) receiptRef.current?.focus(); }, [receipt]);

  const send = async () => {
    if (!machine || !severity || busy) return;
    setBusy(true); setError("");
    try {
      const sent = await api.send({ machineId: machine.id, cause, text, severity, reporterName: data.account.shared ? reporter : "", photos });
      setReceipt(sent);
      setCause(""); setText(""); setPhotos([]); setSeverity(""); setReporter(""); setAi(IDLE);
      await onReload();
    } catch (failure) {
      if (failure instanceof OperatorApiError && failure.status === 401) onLoggedOut("Du har loggats ut. Logga in igen.");
      else setError(failure instanceof Error ? failure.message : "Det gick inte att skicka. Försök igen.");
    } finally {
      setBusy(false);
    }
  };

  // The AI step (only when switched on): asked when the machine and the cause are both chosen; skippable. The newest question wins.
  const askAi = (machineValue: string | null, causeValue: string) => {
    if (!data.ai || !machineValue || !causeValue) { setAi(IDLE); return; }
    // Only the answer to the latest question is kept (the key is the machine and the cause).
    const key = `${machineValue}|${causeValue}`;
    setAi({ state: "busy", key, suggestions: [], note: "" });
    api.troubleshoot({ machineId: machineValue, cause: causeValue })
      .then((answer) => setAi((current) => current.state === "busy" && current.key === key ? { state: "done", key, suggestions: answer.suggestions, note: answer.note } : current))
      .catch(() => setAi((current) => current.state === "busy" && current.key === key ? { state: "done", key, suggestions: [], note: "" } : current));
  };
  const pick = (id: string) => { setMachineId(id); setPicking(false); setReceipt(null); askAi(id, cause); };
  const chooseCause = (value: string) => { setCause(value); askAi(machineId, value); };
  const choice = (label: string, chosen: boolean, onPick: () => void, tone: "info" | "neutral" | "warning" | "danger", testId: string) => app
    ? <ListRow key={label} title={label} onClick={onPick} chevron={false} pill={chosen ? { label: "Vald", tone } : null} testId={testId} ariaLabel={`${label}${chosen ? " (vald)" : ""}`} />
    : <Button key={label} type="button" role="radio" aria-checked={chosen} variant={chosen ? "default" : "outline"} onClick={onPick} data-testid={testId}>{label}</Button>;
  const choices = (label: string, children: ReactNode) => app ? children : <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">{children}</div>;

  const tree = machines.length ? <PlaceTreeView places={treeItems} open={open} onToggle={toggle} selected={machineId} icon={machineIcon}
    line={(item) => item.node.status.label} label="Välj maskin"
    onOpen={(item) => { if (item.node.reportable) pick(item.id); else toggle(item.id); }} testId="op-place-tree" />
    : <p className="p-3 text-sm text-muted-foreground" data-testid="op-no-machines">Du ser inga maskiner än. Kontakta din administratör.</p>;

  // Without a chosen machine the tree simply stands open and the row only names the step (it closed the tree it stood over,
  // user test B1); with one the row says what a tap does.
  const machineStep = app ? <>
    <ListGroup title="1. Maskin" testId="op-machine">
      {machine ? <ListRow type="tools" icon={Cog} title={machine.name} subtitle={`${machine.path}${fromQr && machine.id === initialMachine ? " · från QR-kod" : ""}`}
        value={picking ? "Stäng" : "Byt"} chevron={false} onClick={() => setPicking((value) => !value)} testId="op-pick" />
        : <ListRow type="tools" icon={Cog} title="Välj maskin" subtitle="Tryck på maskinen nedan" chevron={false} testId="op-pick" />}
    </ListGroup>
    {picking || !machine ? <div className="native-group p-2" data-testid="op-tree">{tree}</div> : null}
  </> : <Panel icon={Cog} title="1. Maskin">
    <p className="mb-2 min-h-5 text-sm" data-testid="op-machine">{machine ? <>Vald: <strong>{machine.path}</strong>{fromQr && machine.id === initialMachine ? " (från QR-kod)" : ""}</> : "Välj maskin i trädet."}</p>
    {/* A large plant has a long tree (2026-10-31): it scrolls in its own column, so the report beside it never moves down. */}
    <div className="md:max-h-[calc(100dvh-14rem)] md:overflow-y-auto md:overscroll-contain" data-testid="op-tree">{tree}</div>
  </Panel>;

  const causeStep = choices("Orsak", data.causes.map((item, index) => choice(item, cause === item, () => chooseCause(item), "info", `op-cause-${index}`)));
  const severityStep = choices("Hur allvarligt?", SEVERITIES.map((item) => choice(SEVERITY_LABELS[item], severity === item, () => setSeverity(item), SEVERITY_TONE[item], `op-severity-${item}`)));
  const textStep = <div className="space-y-3">
    <textarea aria-label="Vad hände?" className="form-textarea min-h-24" maxLength={REPORT_TEXT_MAX} placeholder="Kort, till exempel: droppar olja under pumpen" value={text} onChange={(event) => setText(event.target.value)} data-testid="op-text-input" />
    <PhotoPicker files={photos} onChange={(files) => setPhotos(files.slice(0, REPORT_PHOTO_LIMIT))} label="Foto (frivilligt)" />
    {data.account.shared ? <label className="grid gap-1.5 text-xs font-medium">Ditt namn (frivilligt)<Input className="font-normal" maxLength={REPORTER_NAME_MAX} value={reporter} onChange={(event) => setReporter(event.target.value)} placeholder="Så vet vi vem som anmälde" data-testid="op-reporter" /></label> : null}
  </div>;
  const onCallNote = <p className={cn("min-h-10 px-1 pt-1 text-xs", onCall ? "font-medium text-destructive" : "text-muted-foreground")} data-testid="op-oncall-note">
    {onCall ? "Jouren kontaktas när du skickar." : ON_CALL_NOTE}
  </p>;
  // AI-felsökning: only when the company and Workflow have switched it on; otherwise nothing at all is drawn.
  const aiStep = data.ai && machine && cause && ai.state !== "skipped" ? <div className="rounded-[var(--radius-panel)] border border-dashed p-3" data-testid="op-ai">
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Bot className="size-4" aria-hidden="true" />Förslag innan du skickar</p>
    {ai.state === "busy" ? <p className="mt-2 text-sm text-muted-foreground">Letar i maskinens historik …</p>
      : ai.suggestions.length ? <ul className="mt-2 space-y-2">{ai.suggestions.map((item) => <li key={item.text}><p className="text-sm">{item.text}</p><p className="text-xs text-muted-foreground">Underlag: {item.basis}</p></li>)}</ul>
      : <p className="mt-2 text-sm text-muted-foreground">Inget att föreslå för den här maskinen.</p>}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" className={app ? "h-11" : undefined} onClick={() => setAi({ ...IDLE, state: "skipped" })} data-testid="op-ai-skip">Hoppa över</Button>
      <span className="text-xs text-muted-foreground">{ai.note || "Bara ett förslag. Säkerhetsbeslut tas av en person."}</span>
    </div>
  </div> : null;
  const sendStep = <div className="space-y-2 pt-3">
    <Button type="button" className="h-12 w-full text-base" disabledReason={missing || null} disabled={busy} onClick={() => void send()} data-testid="op-send"><Send />{busy ? "Skickar …" : "Skicka felanmälan"}</Button>
    <p className={cn("min-h-5 px-1 text-xs", error ? "font-medium text-destructive" : "text-muted-foreground")} role={error ? "alert" : "status"} data-testid="op-send-status">
      {error || missing || (data.intake === "approval" ? "Går till godkännandelistan först, utom när jouren kontaktas." : "Blir en underhållspost i en ny arbetsorder.")}
    </p>
    <p className="flex items-start gap-1.5 px-1 text-xs text-muted-foreground"><ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{NOT_AN_ALARM_SYSTEM}</p>
  </div>;

  const newReport = () => { setReceipt(null); window.scrollTo({ top: 0 }); };
  const receiptStep = receipt ? <div ref={receiptRef} tabIndex={-1} role="status" className="scroll-mt-20 rounded-[var(--radius-panel)] border bg-card p-5 text-center outline-none" data-testid="op-receipt">
    <CheckCircle2 className={cn("mx-auto size-12", indicatorText("success"))} aria-hidden="true" />
    <p className="mt-2 text-lg font-semibold">Felanmälan skickad</p>
    <p className="mt-1 text-sm font-medium">{receipt.status === "pending" ? "Väntar på godkännande" : `Arbetsorder ${receipt.workOrder}`}</p>
    <p className={cn("mt-1 text-sm", receipt.onCall ? "font-medium text-destructive" : "text-muted-foreground")} data-testid="op-receipt-oncall">{receipt.onCall ? "Jouren kontaktas." : "Jouren kontaktas inte."}</p>
    <Button type="button" className="mt-4 h-12 w-full text-base" onClick={newReport} data-testid="op-new-report"><Plus />Ny felanmälan</Button>
  </div> : null;
  const qrNote = qrOutside ? <p className="notice" role="status" data-testid="op-qr-outside">Den här maskinen ingår inte i ditt konto. Kontakta arbetsledaren.</p> : null;

  const onCallReports = data.reports.filter((report) => report.onCall.state !== "none").slice(0, 3);
  const onCallRows = onCallReports.length ? onCallReports.map((report) => report.onCall.state === "acknowledged"
    ? <ListRow key={report.id} type="risk" icon={CheckCircle2} title={`Jouren har tagit emot · ${report.machine.split(" › ").pop()}`} subtitle={`Kvitterat ${formatSwedishTime(report.onCall.at)}`} pill={{ label: "Kvitterat", tone: "success" }} chevron={false} testId="op-acknowledged" />
    : <ListRow key={report.id} type="risk" icon={AlertTriangle} title={`Jouren kontaktas · ${report.machine.split(" › ").pop()}`} subtitle="Väntar på kvittens" pill={{ label: "Väntar", tone: "warning" }} chevron={false} testId="op-waiting" />)
    : <ListRow title="Ingen jour kontaktad" subtitle="Visas här när jouren kontaktas" chevron={false} />;
  const reportRows = data.reports.length ? data.reports.map((report) => <ListRow key={report.id} type="tools" icon={MessageSquareWarning} title={`${report.cause} · ${report.machine.split(" › ").pop()}`}
    subtitle={[formatSwedishTime(report.at, { dateStyle: "short", timeStyle: "short" }), report.severityLabel, report.workOrder, report.by].filter(Boolean).join(" · ")} pill={{ label: report.status, tone: report.tone }} chevron={false} />)
    : <ListRow title="Inga felanmälningar än" chevron={false} />;
  const statusRows = machines.filter((node) => node.reportable).length ? machines.filter((node) => node.reportable).map((node) => <ListRow key={node.id} title={node.name} subtitle={node.path} chevron={false} pill={{ label: node.status.label, tone: node.status.tone }} />)
    : <ListRow title="Inga maskiner" subtitle="Administratören väljer vilka du ser" chevron={false} />;

  if (app) return <div className="mx-auto w-full max-w-md space-y-1" data-testid="op-report">
    {qrNote}
    {receiptStep ?? <>
      {machineStep}
      <ListGroup title="2. Orsak" footer="Listan är företagets egen." testId="op-cause">{causeStep}</ListGroup>
      <ListGroup title="3. Vad hände?" testId="op-text"><div className="p-3">{textStep}</div></ListGroup>
      <ListGroup title="4. Hur allvarligt?" testId="op-severity">{severityStep}</ListGroup>
      {onCallNote}
      {aiStep}
      {sendStep}
    </>}
    <ListGroup title="Jour" testId="op-oncall">{onCallRows}</ListGroup>
    <ListGroup title="Mina felanmälningar" testId="op-reports">{reportRows}</ListGroup>
    <ListGroup title="Mina maskiner" testId="op-status">{statusRows}</ListGroup>
  </div>;

  // Maskinträdet i en egen spalt till vänster (2026-10-31), som Underhåll: trädet vänster, anmälan i mitten och Jour,
  // Mina felanmälningar och Mina maskiner till höger på en bred skärm (under anmälan på en platta).
  return <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_20rem] [&>*]:min-w-0" data-testid="op-report">
    {qrNote ? <div className="col-span-full">{qrNote}</div> : null}
    <div className="md:sticky md:top-4 md:row-span-2 xl:row-span-1">{machineStep}</div>
    {receiptStep ? <div>{receiptStep}</div> : <div className="space-y-6">
      <Panel icon={ListChecks} title="2. Orsak"><div data-testid="op-cause">{causeStep}</div></Panel>
      <Panel icon={MessageSquareWarning} title="3. Vad hände?"><div data-testid="op-text">{textStep}</div></Panel>
      <Panel icon={AlertTriangle} title="4. Hur allvarligt?"><div data-testid="op-severity">{severityStep}</div>{onCallNote}</Panel>
      {aiStep}
      {sendStep}
    </div>}
    <div className="space-y-6">
      <Panel icon={AlertTriangle} title="Jour"><div className="native-group" data-testid="op-oncall">{onCallRows}</div></Panel>
      <Panel icon={MessageSquareWarning} title="Mina felanmälningar"><div className="native-group" data-testid="op-reports">{reportRows}</div></Panel>
      <Panel icon={Cog} title="Mina maskiner"><div className="native-group" data-testid="op-status">{statusRows}</div></Panel>
    </div>
  </div>;
}
