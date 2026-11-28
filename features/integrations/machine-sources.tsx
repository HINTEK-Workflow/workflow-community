"use client";
import { useCallback, useState } from "react";
import { Ban, ChevronDown, CircleDot, Cpu, FileJson, KeyRound, ListTree, MapPin, Plus, RefreshCw, ScanSearch, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { ALARM_MODES, ALARM_MODE_LABELS, type AlarmMode } from "@/lib/machine/alarm-rules";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { DialogActions, Modal, Panel } from "../../features/kfid/ui";
import { api } from "../../features/kfid/api";
import { useConfirm } from "../../features/kfid/confirm";
import { KeyField } from "../../features/kfid/secret-field";
import { useLoadEffect } from "@/lib/use-load-effect";
import { useInstance } from "@/components/instance-provider";
import { AiMachineExplainSwitch } from "@/features/ai/sharing-policy-panel";
import { MachinePartSelect, partOptions, usePartOptions } from "@/features/maintenance/part-picker";
import { MachineSignalsPage } from "./machine-signals";
import { MachineProfilesSection, MachineSamplesPage, useProfiles } from "./machine-profiles";
import { MachineAlarmSection } from "./machine-alarm-responsibility";
import { KeyCard, KeyCardFoot, KeyCardGrid, KeyCardMore, KeyFields } from "./key-card";
import { MachineSimulatorButton } from "./machine-simulator-button";
import { useModules } from "@/features/workflow/use-modules";

/**
 * Maskiner (S2, 2026-10-19): the sources – a PLC through Node-RED, a Raspberry Pi with its own analysis, any program that can
 * send HTTPS – that may send alarms, running states and diagnoses to Workflow. One key per source, shown once. Here the admin
 * creates a source, replaces or revokes its key, tries it with a test event and reads what it has sent.
 */
type Source = {
  id: string; name: string; displayHint: string; status: "active" | "expired" | "revoked" | "inactive"; keyIssuedAt: string; keyExpiresAt: string | null;
  lastUsedAt: string | null; lastEventAt: string | null; events24h: number; alarmMode: AlarmMode; cooldownMinutes: number;
  /** Integrationsmotorn E1, since Underhåll (2026-10-30): the source's default machine part in the machine tree, or null. */
  part: { id: string; name: string; path: string; isActive: boolean } | null;
  /** K2.5 (2026-11-28): the machine parts the key may write events for; empty = all. */
  allowedParts?: { id: string; name: string; path: string; isActive: boolean }[];
  /** Integrationsmotorn E2: the source's signal catalogue in numbers. */
  signals?: { total: number; discovered: number; active: number; ignoredOverCap: number };
  /** E4: the format profile for the raw intake, and Fånga prov until. */
  profileId?: string | null; captureUntil?: string | null;
};
type Suggestion = { id: string; sourceName: string; scopeLabel?: string; kind: string; title: string; basis: string; explanation: string | null; createdAt: string };
type Waiting = { id: string; sourceName: string; code: string; severity: string; text: string; createdAt: string };
type MachineEventRow = {
  id: string; eventId: string; occurredAt: string; type: string; code: string; severity: string; state: string | null; text: string; basis: string | null;
  values: Record<string, number | boolean | string> | null;
};

const STATUS: Record<Source["status"], { label: string; tone: IndicatorTone }> = {
  active: { label: "Aktiv", tone: "success" }, expired: { label: "Nyckeln har gått ut", tone: "danger" },
  revoked: { label: "Nyckeln är återkallad", tone: "neutral" }, inactive: { label: "Avstängd", tone: "neutral" },
};
const TYPE_LABEL: Record<string, string> = { alarm: "Larm", state: "Driftläge", diagnosis: "Diagnos" };
const SEVERITY_TONE: Record<string, IndicatorTone> = { info: "neutral", warning: "warning", fault: "danger", critical: "danger" };
const SEVERITY_LABEL: Record<string, string> = { info: "Info", warning: "Varning", fault: "Fel", critical: "Kritiskt" };
const when = (value: string | null) => (value ? formatSwedish(value, { dateStyle: "medium", timeStyle: "short" }) : "");

const Pill = ({ tone, children, testId }: { tone: IndicatorTone; children: React.ReactNode; testId?: string }) =>
  <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium", indicatorBadge(tone))} data-testid={testId}>{children}</span>;

/**
 * `simulator` (2026-11-20): the PLC simulator is a demo function that shows how a machine connection works, not something
 * a company uses day to day – its button shows only in the demo and for the product owner, with a line saying so.
 */
export function MachineSourcesPanel({ notify, simulator = false }: { notify: (text: string, error?: boolean) => void; simulator?: boolean }) {
  const aiHere = useInstance().features.ai;
  const upkeepOn = useModules()("upkeep");
  const [sources, setSources] = useState<Source[] | null>(null);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<{ name: string; token: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [placing, setPlacing] = useState<Source | null>(null);
  const [limiting, setLimiting] = useState<Source | null>(null);
  const [signalsOf, setSignalsOf] = useState<Source | null>(null);
  const [samplesOf, setSamplesOf] = useState<Source | null>(null);
  const profiles = useProfiles();
  const [events, setEvents] = useState<Record<string, MachineEventRow[]>>({});
  const [confirm, confirmElement] = useConfirm();

  const load = useCallback(async () => {
    try {
      const result = await api<{ sources: Source[]; waiting: Waiting[]; suggestions: Suggestion[] }>("/api/machine-sources", { cache: "no-store" });
      setSources(result.sources);
      setWaiting(result.waiting);
      setSuggestions(result.suggestions);
      setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);

  const send = async <T,>(payload: Record<string, unknown>) => {
    setBusy(true);
    try { return await api<T>("/api/machine-sources", { method: "POST", body: JSON.stringify(payload) }); } finally { setBusy(false); }
  };
  const readEvents = async (id: string) => {
    try {
      const result = await api<{ events: MachineEventRow[] }>(`/api/machine-sources?sourceId=${encodeURIComponent(id)}`, { cache: "no-store" });
      setEvents((current) => ({ ...current, [id]: result.events }));
    } catch (cause) { notify((cause as Error).message, true); }
  };
  const toggleEvents = (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    void readEvents(id);
  };
  const create = async (name: string, expiresInDays: number) => {
    try {
      const result = await send<{ token: string }>({ action: "create", name, expiresInDays });
      setCreating(false);
      setShown({ name, token: result.token });
      await load();
    } catch (cause) { notify((cause as Error).message, true); }
  };
  const rotate = async (source: Source) => {
    if (!(await confirm({ title: "Byta nyckel?", message: `Den gamla nyckeln för ”${source.name}” slutar fungera direkt. Lägg in den nya där källan skickar från.`, confirmLabel: "Byt nyckel", tone: "danger" }))) return;
    try {
      const result = await send<{ token: string }>({ action: "rotate", id: source.id, expiresInDays: 365 });
      setShown({ name: source.name, token: result.token });
      await load();
    } catch (cause) { notify((cause as Error).message, true); }
  };
  const revoke = async (source: Source) => {
    if (!(await confirm({ title: "Återkalla nyckeln?", message: `”${source.name}” kan inte skicka fler händelser. Du kan byta nyckel för att börja om.`, confirmLabel: "Återkalla", tone: "danger" }))) return;
    try { await send({ action: "revoke", id: source.id }); notify("Nyckeln är återkallad."); await load(); } catch (cause) { notify((cause as Error).message, true); }
  };
  const remove = async (source: Source) => {
    if (!(await confirm({ title: "Ta bort källan?", message: `”${source.name}” och alla dess händelser raderas. Det går inte att ångra.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    try { await send({ action: "remove", id: source.id }); notify("Källan är borttagen."); if (open === source.id) setOpen(null); await load(); } catch (cause) { notify((cause as Error).message, true); }
  };
  const setAlarm = async (source: Source, alarmMode: AlarmMode) => {
    try { await send({ action: "set_alarm", id: source.id, alarmMode, cooldownMinutes: source.cooldownMinutes }); notify("Inställningen är sparad."); await load(); } catch (cause) { notify((cause as Error).message, true); }
  };
  const setPart = async (source: Source, partId: string | null) => {
    try {
      await send({ action: "set_part", id: source.id, partId });
      setPlacing(null);
      notify(partId ? "Källan är kopplad till maskindelen." : "Källan har ingen maskindel.");
      await load();
    } catch (cause) { notify((cause as Error).message, true); }
  };
  const setAllowed = async (source: Source, partIds: string[]) => {
    try {
      await send({ action: "set_allowed_parts", id: source.id, partIds });
      setLimiting(null);
      notify(partIds.length ? "Nyckeln får nu bara skriva för de valda maskinerna." : "Nyckeln får skriva för alla maskiner.");
      await load();
    } catch (cause) { notify((cause as Error).message, true); }
  };
  const setProfile = async (source: Source, profileId: string | null) => {
    try { await send({ action: "set_profile", id: source.id, profileId }); notify(profileId ? "Källan läser rådata med profilen." : "Källan har ingen formatprofil."); await Promise.all([load(), profiles.reload()]); } catch (cause) { notify((cause as Error).message, true); }
  };
  const setCapture = async (source: Source, on: boolean) => {
    try { await send({ action: "set_capture", id: source.id, on }); notify(on ? "Fånga prov är på i 24 timmar." : "Fånga prov är av."); await load(); } catch (cause) { notify((cause as Error).message, true); }
  };
  const decide = async (item: Waiting, action: "approve_order" | "dismiss_order") => {
    try { await send({ action, orderId: item.id }); notify(action === "approve_order" ? "Arbetsordern är skapad." : "Förslaget är avvisat."); await load(); } catch (cause) { notify((cause as Error).message, true); await load(); }
  };
  const answer = async (item: Suggestion, action: "dismiss_suggestion" | "acknowledge_suggestion") => {
    try { await send({ action, suggestionId: item.id }); notify(action === "dismiss_suggestion" ? "Förslaget är avvisat. Tröskeln för den här källan höjs." : "Noterat."); await load(); } catch (cause) { notify((cause as Error).message, true); await load(); }
  };
  // Analysera nu (2026-11-02): the admin need not wait for the hour or the night. Same observation, same one suggestion.
  const analyse = async () => {
    try {
      const { made } = await send<{ made: number }>({ action: "analyse_now" });
      notify(made ? (made === 1 ? "Ett nytt förslag." : `${made} nya förslag.`) : "Inga nya förslag.");
      await load();
    } catch (cause) { notify((cause as Error).message, true); }
  };
  const explain = async (item: Suggestion) => {
    try { await send({ action: "explain_suggestion", suggestionId: item.id }); await load(); } catch (cause) { notify((cause as Error).message, true); }
  };
  const test = async (source: Source) => {
    try {
      await send({ action: "test_event", id: source.id });
      notify("Testhändelsen är mottagen.");
      await load();
      if (open === source.id) await readEvents(source.id);
    } catch (cause) { notify((cause as Error).message, true); }
  };
  // The key is shown once: closing without the button asks first.
  const closeToken = async () => {
    if (await confirm({ title: "Stäng ändå?", message: "Nyckeln visas bara nu.", confirmLabel: "Stäng ändå", tone: "danger" })) setShown(null);
  };

  const [howOpen, setHowOpen] = useState(false);
  const address = typeof window === "undefined" ? "" : `${window.location.origin}/api/ingest/v1/events`;
  return <><Panel title="Maskiner" description="Källor som skickar larm, driftläge och diagnoser till Workflow. En nyckel per källa."
    icon={Cpu}
    actions={<><Button type="button" variant="outline" size="sm" disabled={busy} disabledReason={!upkeepOn ? "Underhåll är avstängt." : !sources?.length ? "Skapa en källa först." : null} onClick={() => void analyse()} data-testid="machine-analyse-now"><ScanSearch />Analysera nu</Button>{simulator ? <MachineSimulatorButton /> : null}<Button type="button" size="sm" onClick={() => setCreating(true)} data-testid="machine-new"><Plus />Ny källa</Button></>}>
    {confirmElement}
    {simulator ? <p className="mb-3 text-xs text-muted-foreground" data-testid="machine-simulator-note">Simulatorn är en demofunktion. Den visar hur en maskinkoppling fungerar och används inte i det dagliga arbetet.</p> : null}
    {suggestions.length ? <ul className="mb-3 divide-y rounded-lg border" aria-label="Förslag från analysen" data-testid="machine-suggestions">
      {suggestions.map((item) => <li key={item.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" data-testid="machine-suggestion">
        <div className="min-w-0 [overflow-wrap:anywhere]"><p className="font-medium">{item.sourceName}{item.scopeLabel ? ` · ${item.scopeLabel}` : ""}: {item.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.basis}</p>
          {item.explanation ? <p className="mt-2 whitespace-pre-line rounded-md bg-muted p-2 text-xs" data-testid="machine-explanation">{item.explanation}</p> : null}</div>
        <div className="flex flex-wrap gap-2">{item.explanation ? null : <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void explain(item)} data-testid="machine-explain">Förklara med AI</Button>}
          <Button type="button" size="sm" disabled={busy} onClick={() => void answer(item, "acknowledge_suggestion")} data-testid="machine-ack">Noterat</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void answer(item, "dismiss_suggestion")} data-testid="machine-suggestion-dismiss">Avvisa</Button></div>
      </li>)}
    </ul> : null}
    {waiting.length ? <ul className="mb-3 divide-y rounded-lg border" aria-label="Larmförslag som väntar" data-testid="machine-waiting">
      {waiting.map((item) => <li key={item.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="machine-waiting-item">
        <p className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium">{item.sourceName}: larm {item.code}</span>{item.text ? ` · ${item.text}` : ""}<span className="block text-xs text-muted-foreground">{when(item.createdAt)}</span></p>
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => void decide(item, "approve_order")} data-testid="machine-approve">Skapa arbetsorder</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void decide(item, "dismiss_order")} data-testid="machine-dismiss">Avvisa</Button></div>
      </li>)}
    </ul> : null}
    {error ? <p role="alert" className="notice text-destructive">{error}</p>
      : !sources ? <p className="text-sm text-muted-foreground">Hämtar källor…</p>
      : !sources.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="machine-empty">Inga källor ännu. Skapa en källa och lägg nyckeln i systemet som ska skicka.</p>
      : null}
    {samplesOf ? <MachineSamplesPage source={samplesOf} onClose={() => setSamplesOf(null)} notify={notify} /> : null}
    {signalsOf ? <MachineSignalsPage source={signalsOf} open onClose={() => { setSignalsOf(null); void load(); }} notify={notify} /> : null}
    {placing ? <PartDialog source={placing} busy={busy} onClose={() => setPlacing(null)} onSave={(partId) => void setPart(placing, partId)} /> : null}
    {limiting ? <AllowedPartsDialog source={limiting} busy={busy} onClose={() => setLimiting(null)} onSave={(partIds) => void setAllowed(limiting, partIds)} /> : null}
    {creating ? <CreateDialog busy={busy} onClose={() => setCreating(false)} onCreate={create} /> : null}
    <Modal open={Boolean(shown)} onOpenChange={(next) => { if (!next) void closeToken(); }} title="Kopiera nyckeln nu" size="compact">
      <KeyField id="machine-token" label="Källans nya nyckel" className="mt-1" hint={<>Nyckeln för ”{shown?.name}” visas bara nu. Lägg in den där källan skickar från.</>}>
        <Input id="machine-token" readOnly value={shown?.token ?? ""} className="min-w-0 flex-1 basis-56 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} data-testid="machine-issued-token" />
        <CopyButton value={shown?.token ?? ""} onCopied={() => notify("Nyckeln är kopierad.")} onFailed={() => notify("Markera och kopiera nyckeln själv.", true)} />
      </KeyField>
      <Button type="button" className="mt-4 w-full" onClick={() => setShown(null)} data-testid="machine-token-saved">Jag har sparat nyckeln</Button>
    </Modal>
    {/* Maskinanalys med AI (UX-granskningen C4, 2026-10-22): chosen here, where the machines are, instead of under Arbetssätt. */}
    {aiHere ? <section className="mt-5 space-y-2" aria-label="Maskinanalys med AI"><h4 className="text-xs font-semibold text-foreground">Maskinanalys med AI</h4><AiMachineExplainSwitch /></section> : null}
    {/* Mer (2026-11-12, the key cards' rule): how to send, folded at the card's foot under its one thin line – the key cards' own Mer and foot (2026-11-16). */}
    <KeyCardFoot><KeyCardMore open={howOpen} onOpenChange={setHowOpen} testId="machine-how">
      <p className="font-medium text-foreground">Så skickar du händelser</p>
      <p>Skicka en POST med nyckeln som Bearer och JSON. Högst 20 händelser per anrop. Varje händelse har ett eget eventId, så att samma händelse två gånger aldrig blir två poster.</p>
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{`POST ${address || "https://<din-adress>/api/ingest/v1/events"}
Authorization: Bearer <källans nyckel>
Content-Type: application/json

{ "schemaVersion": 1, "events": [
  { "eventId": "plc1-20261019-0001", "occurredAt": "2026-10-19T08:30:00Z",
    "type": "alarm", "code": "E12", "severity": "fault", "state": "raised",
    "text": "Motor 2 överström", "values": { "current_a": 12.4 } } ] }`}</pre>
      <p>Enhetens egen JSON (till exempel en router som skickar sina värden) går till rådata-intaget och läses med källans formatprofil. Nyckeln i Authorization eller i huvudet X-Hintek-Key, aldrig i adressen. Svaret är 200.</p>
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{`POST ${address ? address.replace(/events$/, "raw") : "https://<din-adress>/api/ingest/v1/raw"}
X-Hintek-Key: <källans nyckel>
Content-Type: application/json`}</pre>
    </KeyCardMore></KeyCardFoot>
  </Panel>
  {/* Egna kort (2026-11-12): every source is a card of its own, two per row where there is room, all its buttons in the
      card's one action row. */}
  {sources?.length ? <KeyCardGrid label="Maskinkällor" testId="machine-sources">
    {sources.map((source) => <li key={source.id} className="min-w-0" data-testid="machine-source">
      <SourceCard source={source} busy={busy} profiles={profiles.data?.profiles ?? null} open={open === source.id} events={events[source.id]}
        onTest={() => void test(source)} onSignals={() => setSignalsOf(source)} onRotate={() => void rotate(source)} onRevoke={() => void revoke(source)}
        onRemove={() => void remove(source)} onPlace={() => setPlacing(source)} onLimit={() => setLimiting(source)} onProfile={(profileId) => void setProfile(source, profileId)}
        onCapture={() => void setCapture(source, !source.captureUntil)} onSamples={() => setSamplesOf(source)}
        onAlarm={(mode) => void setAlarm(source, mode)} onToggleEvents={() => toggleEvents(source.id)} />
    </li>)}
  </KeyCardGrid> : null}
  {/* Integrationsmotorn E6: who is told of an alarm first, and when it goes further. */}
  {sources?.length ? <MachineAlarmSection notify={notify} /> : null}
  <MachineProfilesSection data={profiles.data} reload={profiles.reload} notify={notify} />
  </>;
}

/**
 * A machine source as a card of its own (2026-11-12, the key cards' build): the status in the header; what it has sent,
 * its machine part and its two choices in the card; every button in the one action row; Ta bort under Mer.
 */
function SourceCard({ source, busy, profiles, open, events, onTest, onSignals, onRotate, onRevoke, onRemove, onPlace, onLimit, onProfile, onCapture, onSamples, onAlarm, onToggleEvents }: {
  source: Source; busy: boolean; profiles: { id: string; name: string }[] | null; open: boolean; events: MachineEventRow[] | undefined;
  onTest: () => void; onSignals: () => void; onRotate: () => void; onRevoke: () => void; onRemove: () => void; onPlace: () => void; onLimit: () => void;
  onProfile: (profileId: string | null) => void; onCapture: () => void; onSamples: () => void; onAlarm: (mode: AlarmMode) => void; onToggleEvents: () => void;
}) {
  return <KeyCard icon={Cpu} title={source.name} status={STATUS[source.status]} statusTestId="machine-status"
    actions={<>
      <Button type="button" variant="outline" disabled={busy || source.status !== "active"} onClick={onTest} data-testid="machine-test"><Send />Skicka testhändelse</Button>
      <Button type="button" variant="outline" disabled={busy} aria-pressed={Boolean(source.captureUntil)} onClick={onCapture} data-testid="machine-capture"><CircleDot />{source.captureUntil ? `Fånga prov på till ${when(source.captureUntil)}` : "Fånga prov"}</Button>
      <Button type="button" variant="outline" onClick={onSamples} data-testid="machine-samples-open"><FileJson />Prov</Button>
      <Button type="button" variant="outline" onClick={onSignals} data-testid="machine-signals-open"><ListTree />Signaler{source.signals?.total ? ` (${source.signals.total})` : ""}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onRotate} data-testid="machine-rotate"><RefreshCw />Byt nyckel</Button>
      {source.status === "active" ? <Button type="button" variant="outline" disabled={busy} onClick={onRevoke} data-testid="machine-revoke"><Ban />Återkalla</Button> : null}
    </>}
    more={<Button type="button" variant="ghost" size="sm" className="w-fit text-destructive" disabled={busy} onClick={onRemove} data-testid="machine-remove"><Trash2 />Ta bort källan</Button>}
    moreTestId="machine-source-more">
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{source.displayHint}</code></p>
      <p data-testid="machine-heard">{source.lastEventAt ? `Senast hörd ${when(source.lastEventAt)} · ${source.events24h} ${source.events24h === 1 ? "händelse" : "händelser"} senaste dygnet` : "Har inte hörts av ännu"}</p>
      <p>Nyckel från {when(source.keyIssuedAt)} · {source.keyExpiresAt ? `gäller till ${when(source.keyExpiresAt)}` : "inget slutdatum"}</p>
    </div>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="machine-part">
      <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">Maskindel</span>
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]" data-testid="machine-part-name">{source.part ? `${[source.part.path, source.part.name].filter(Boolean).join(" › ")}${source.part.isActive ? "" : " (pausad)"}` : "Ingen – larmen gäller källan"}</span>
      <Button type="button" variant="ghost" size="sm" className="-my-1 text-primary touch:h-11" disabled={busy} onClick={onPlace} data-testid="machine-part-choose">{source.part ? "Byt del" : "Välj del"}</Button>
    </div>
    {/* Nyckel med minsta behörighet (K2.5): the machines the key may write for; all until the admin limits it. */}
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="machine-allowed">
      <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">Nyckeln får skriva för</span>
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]" data-testid="machine-allowed-names">{source.allowedParts?.length ? source.allowedParts.map((part) => part.name).join(", ") : "Alla maskiner"}</span>
      <Button type="button" variant="ghost" size="sm" className="-my-1 text-primary touch:h-11" disabled={busy} onClick={onLimit} data-testid="machine-allowed-choose">{source.allowedParts?.length ? "Ändra" : "Begränsa"}</Button>
    </div>
    <KeyFields>
      <div className="grid min-w-0 gap-1.5" data-testid="machine-raw"><label htmlFor={`machine-profile-${source.id}`} className="field-label text-xs font-medium">Formatprofil för rådata</label>
        <select id={`machine-profile-${source.id}`} className="form-select" value={source.profileId ?? ""} disabled={busy || !profiles} onChange={(event) => onProfile(event.target.value || null)} data-testid="machine-profile-select">
          <option value="">Ingen (bara händelser)</option>
          {profiles?.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select></div>
      <div className="grid min-w-0 gap-1.5"><label htmlFor={`machine-alarm-${source.id}`} className="field-label text-xs font-medium">Larm blir arbetsorder</label>
        <select id={`machine-alarm-${source.id}`} className="form-select" value={source.alarmMode} disabled={busy} onChange={(event) => onAlarm(event.target.value as AlarmMode)} data-testid="machine-alarm-mode">
          {ALARM_MODES.map((mode) => <option key={mode} value={mode}>{ALARM_MODE_LABELS[mode]}</option>)}
        </select></div>
    </KeyFields>
    <div>
      <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground touch:h-11" aria-expanded={open} onClick={onToggleEvents} data-testid="machine-events-toggle">
        <ChevronDown className={cn("transition-transform", !open && "-rotate-90")} />Senaste händelserna
      </Button>
      {open ? <div className="mt-1" data-testid="machine-events">
        {!events ? <p className="text-xs text-muted-foreground">Hämtar…</p>
          : !events.length ? <p className="text-xs text-muted-foreground">Inga händelser ännu.</p>
          : <ul className="divide-y rounded-md border text-xs">{events.map((item) => <li key={item.id} className="grid gap-1 p-2 @md:grid-cols-[9rem_6rem_minmax(0,1fr)]" data-testid="machine-event">
            <span className="tabular-nums text-muted-foreground">{when(item.occurredAt)}</span>
            <span className="flex flex-wrap items-center gap-1"><Pill tone={SEVERITY_TONE[item.severity] ?? "neutral"}>{SEVERITY_LABEL[item.severity] ?? item.severity}</Pill></span>
            <span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium">{TYPE_LABEL[item.type] ?? item.type} {item.code}</span>{item.state ? ` · ${item.state}` : ""}{item.text ? ` · ${item.text}` : ""}{item.basis ? ` · Grund: ${item.basis}` : ""}
              {item.values ? <span className="block text-muted-foreground">{Object.entries(item.values).map(([key, value]) => `${key}=${String(value)}`).join(" · ")}</span> : null}</span>
          </li>)}</ul>}
      </div> : null}
    </div>
  </KeyCard>;
}

function CreateDialog({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (name: string, expiresInDays: number) => Promise<void> }) {
  const [name, setName] = useState("");
  const [expires, setExpires] = useState(365);
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title="Ny källa" size="compact">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onCreate(name.trim(), expires); }}>
      <div className="grid gap-1.5"><label htmlFor="machine-name" className="field-label text-xs font-medium">Namn</label>
        <Input id="machine-name" value={name} required maxLength={80} placeholder="Till exempel PLC hall 1" onChange={(event) => setName(event.target.value)} data-testid="machine-name" />
      </div>
      <div className="grid gap-1.5"><label htmlFor="machine-expiry" className="field-label text-xs font-medium">Giltighet</label>
        <select id="machine-expiry" className="form-select" value={expires} onChange={(event) => setExpires(Number(event.target.value))}>
          {[90, 365, 730, 0].map((days) => <option key={days} value={days}>{days ? `${days} dagar` : "Inget slutdatum"}</option>)}
        </select>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="machine-new-off">Källan börjar på Av: larm blir ingen arbetsorder förrän du väljer det.</p>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Skapa källa", type: "submit", disabled: busy, disabledReason: !name.trim() ? "Skriv ett namn först." : null, testId: "machine-create" }} />
    </form>
  </Modal>;
}

/**
 * Nyckel med minsta behörighet (K2.5, 2026-11-28): the machine parts the source's key may write events for. None chosen is no
 * limit, as before; with a choice, an event that would land on another machine is refused by the intake ("machine_not_allowed").
 * Data only goes one way: the key can never read or send anything back to the machine.
 */
function AllowedPartsDialog({ source, busy, onClose, onSave }: { source: Source; busy: boolean; onClose: () => void; onSave: (partIds: string[]) => void }) {
  const [chosen, setChosen] = useState<string[]>(source.allowedParts?.map((part) => part.id) ?? []);
  const { parts, places } = usePartOptions();
  const options = partOptions(parts ?? [], null, places);
  const nameOf = (id: string) => options.find((option) => option.id === id)?.label ?? source.allowedParts?.find((part) => part.id === id)?.name ?? "Maskindel";
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={`Maskiner för ${source.name}`} size="compact">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(chosen); }} data-testid="machine-allowed-dialog">
      <p className="text-sm text-muted-foreground">Välj de maskiner som nyckeln får skriva händelser för. Väljer du ingen får den skriva för alla, som förut. Nyckeln kan bara skicka in, aldrig läsa eller styra något.</p>
      {chosen.length ? <ul className="flex flex-wrap gap-2" aria-label="Valda maskiner">
        {chosen.map((id) => <li key={id}><Button type="button" variant="outline" size="sm" onClick={() => setChosen((list) => list.filter((item) => item !== id))} aria-label={`Ta bort ${nameOf(id)}`}>{nameOf(id)}<X /></Button></li>)}
      </ul> : <p className="text-xs text-muted-foreground" data-testid="machine-allowed-all">Alla maskiner.</p>}
      <MachinePartSelect id="machine-allowed-add" label="Lägg till maskin" emptyLabel="Välj en maskin" value={null} onChange={(id) => { if (id) setChosen((list) => (list.includes(id) ? list : [...list, id])); }} testId="machine-allowed-select" />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: chosen.length ? "Spara begränsningen" : "Spara: alla maskiner", type: "submit", disabled: busy, testId: "machine-allowed-save" }} />
    </form>
  </Modal>;
}

/**
 * Integrationsmotorn E1 (2026-10-24), since Underhåll (2026-10-30) a part in the machine tree, never a customer's
 * place: the source's default machine part. An alarm from the source then becomes an order with a maintenance item on that
 * part (and the tree's customer), and two sources on the same part share one open order.
 */
function PartDialog({ source, busy, onClose, onSave }: { source: Source; busy: boolean; onClose: () => void; onSave: (partId: string | null) => void }) {
  const [partId, setPartId] = useState<string | null>(source.part?.id ?? null);
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={`Maskindel för ${source.name}`} size="compact">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(partId); }} data-testid="machine-part-dialog">
      <p className="text-sm text-muted-foreground">Larm från källan blir arbetsordrar på maskindelen. Varje del har högst en öppen automatisk arbetsorder åt gången.</p>
      <MachinePartSelect id="machine-part" value={partId} onChange={setPartId} testId="machine-part-select" />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: partId ? "Spara del" : source.part ? "Ta bort delen" : "Spara", type: "submit", disabled: busy || (!partId && !source.part), disabledReason: !partId && !source.part ? "Välj en del först." : null, testId: "machine-part-save" }} />
    </form>
  </Modal>;
}
