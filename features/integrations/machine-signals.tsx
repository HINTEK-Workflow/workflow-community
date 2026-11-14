"use client";
import { useCallback, useState } from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogPage } from "@/features/kfid/dialog-page";
import { Empty, RowsSkeleton } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { MachinePartSelect } from "@/features/maintenance/part-picker";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { SignalRules, type RuleRow } from "./machine-rules";
import { isCodeKey, MAX_SIGNAL_NAME_LENGTH, MAX_SIGNAL_UNIT_LENGTH, SIGNAL_KIND_LABELS, SIGNAL_STATUS_LABELS, SIGNAL_STATUSES, signalLabel, signalValueText, type SignalKind, type SignalStatus } from "@/lib/machine/signals";

/**
 * Integrationsmotorn E2 (2026-10-24, beslut 4): the source's signal page under Kopplingar → Maskiner – every value name
 * and code the source has sent, found by itself. A found signal changes nothing until the admin makes it Aktiv or gives it an
 * object; Ignorerad leaves it out (an ignored alarm code makes no order). Only the latest value is kept, no history (svar 2).
 * A page of its own (DialogPage, `page=signaler`); a signal is changed in its own row, never in a window over the page.
 */
/** Underhåll (2026-10-30): a signal's own machine part in the machine tree (never a customer's place). */
type Part = { id: string; name: string; path: string; isActive: boolean };
type Signal = {
  id: string; key: string; kind: SignalKind; status: SignalStatus; name: string; unit: string; partId: string | null; deadband: number | null; runHoursFeed: boolean;
  firstSeenAt: string; lastSeenAt: string; lastValue: unknown; lastValueAt: string | null; part: Part | null;
};
type SignalPage = { source: { id: string; name: string; ignoredSignals: number }; signals: Signal[]; rules: RuleRow[]; limits: { perSource: number; perCompany: number; companyCount: number } };

const STATUS_TONE: Record<SignalStatus, IndicatorTone> = { discovered: "info", active: "success", ignored: "neutral" };
const when = (value: string) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });

export function MachineSignalsPage({ source, open, onClose, notify }: { source: { id: string; name: string }; open: boolean; onClose: () => void; notify: (text: string, error?: boolean) => void }) {
  const [data, setData] = useState<SignalPage | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api<SignalPage>(`/api/machine-sources?sourceId=${encodeURIComponent(source.id)}&signals=1`, { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, [source.id]);
  useLoadEffect(load, open);
  return <DialogPage pageKey="signaler" size="page" open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={`Signaler – ${source.name}`} panelTitle="Signaler"
    description="Värden och koder som källan skickat. En upptäckt signal påverkar ingenting förrän du gör den aktiv eller ger den en maskindel.">
    <div className="space-y-3" data-testid="machine-signals">
      {data ? <p className="text-xs text-muted-foreground" data-testid="machine-signals-limits">
        {data.signals.length} av högst {data.limits.perSource} signaler för källan · {data.limits.companyCount} av högst {data.limits.perCompany} i företaget
        {data.source.ignoredSignals ? <span className="text-danger" data-testid="machine-signals-over"> · {data.source.ignoredSignals} {data.source.ignoredSignals === 1 ? "signal" : "signaler"} över gränsen ignorerades</span> : null}
      </p> : null}
      {error ? <p role="alert" className="notice text-destructive">{error}</p>
        : !data ? <RowsSkeleton rows={3} dense label="Hämtar signalerna…" />
        : !data.signals.length ? <Empty title="Inga signaler ännu" description="Signalerna dyker upp av sig själva när källan skickar värden eller koder." />
        : <ul className="divide-y rounded-lg border" aria-label="Signaler">{data.signals.map((signal) => <li key={signal.id} className="p-3 text-sm" data-testid="machine-signal">
          {editing === signal.id ? <SignalEditor signal={signal} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); notify("Signalen är sparad."); await load(); }} notify={notify} />
            : <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium" data-testid="machine-signal-name">{signalLabel(signal)}</span>
                  <Badge variant="outline" className={indicatorBadge(STATUS_TONE[signal.status])} data-testid="machine-signal-status">{SIGNAL_STATUS_LABELS[signal.status]}</Badge>
                  <span className="text-xs text-muted-foreground">{SIGNAL_KIND_LABELS[signal.kind]}{signal.name ? ` · ${signal.key}` : ""}</span></p>
                <p className="mt-0.5 text-xs text-muted-foreground" data-testid="machine-signal-facts">{[
                  signal.part ? `Del ${[signal.part.path, signal.part.name].filter(Boolean).join(" › ")}` : isCodeKey(signal.key) ? "Källans del" : "",
                  signal.runHoursFeed ? "Ger delens drifttimmar" : "",
                  signalValueText(signal) ? `Senaste värde ${signalValueText(signal)}` : "",
                  `senast sedd ${when(signal.lastSeenAt)}`,
                ].filter(Boolean).join(" · ")}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(signal.id)} data-testid="machine-signal-edit"><Pencil />Ändra</Button>
            </div>}
          {signal.status !== "ignored" ? <SignalRules signal={signal} rules={data.rules.filter((rule) => rule.signalId === signal.id)} onChanged={load} notify={notify} /> : null}
        </li>)}</ul>}
    </div>
  </DialogPage>;
}

function SignalEditor({ signal, onCancel, onSaved, notify }: { signal: Signal; onCancel: () => void; onSaved: () => Promise<void>; notify: (text: string, error?: boolean) => void }) {
  const [draft, setDraft] = useState({ name: signal.name, unit: signal.unit, status: signal.status, partId: signal.partId, deadband: signal.deadband === null ? "" : String(signal.deadband), runHours: signal.runHoursFeed });
  const [busy, setBusy] = useState(false);
  const id = `signal-${signal.id}`;
  const save = async () => {
    const deadband = draft.deadband.trim() === "" ? null : Number(draft.deadband.replace(",", "."));
    if (deadband !== null && !Number.isFinite(deadband)) { notify("Skriv dödbandet som ett tal.", true); return; }
    setBusy(true);
    try {
      await api("/api/machine-sources", { method: "POST", body: JSON.stringify({ action: "update_signal", signalId: signal.id, name: draft.name, unit: draft.unit, status: draft.status, partId: draft.partId, deadband, runHours: draft.runHours }) });
      await onSaved();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const label = "field-label text-xs font-medium";
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="machine-signal-editor">
    <p className="font-medium">{signal.key}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5"><label htmlFor={`${id}-name`} className={label}>Namn</label>
        <Input id={`${id}-name`} value={draft.name} maxLength={MAX_SIGNAL_NAME_LENGTH} placeholder={signalLabel({ key: signal.key, name: "" })} onChange={(event) => setDraft({ ...draft, name: event.target.value })} data-testid="machine-signal-name-input" /></div>
      <div className="grid gap-1.5"><label htmlFor={`${id}-status`} className={label}>Status</label>
        <select id={`${id}-status`} className="form-select" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as SignalStatus })} data-testid="machine-signal-status-select">
          {SIGNAL_STATUSES.map((status) => <option key={status} value={status}>{SIGNAL_STATUS_LABELS[status]}</option>)}
        </select></div>
      {signal.kind !== "code" ? <div className="grid gap-1.5"><label htmlFor={`${id}-unit`} className={label}>Enhet (valfritt)</label>
        <Input id={`${id}-unit`} value={draft.unit} maxLength={MAX_SIGNAL_UNIT_LENGTH} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></div> : null}
      {signal.kind === "number" ? <div className="grid gap-1.5"><label htmlFor={`${id}-deadband`} className={label}>Dödband (valfritt)</label>
        <Input id={`${id}-deadband`} inputMode="decimal" value={draft.deadband} onChange={(event) => setDraft({ ...draft, deadband: event.target.value })} /></div> : null}
      <MachinePartSelect id={`${id}-part`} label="Maskindel (valfritt)" emptyLabel="Källans del" value={draft.partId} onChange={(partId) => setDraft({ ...draft, partId })} testId="machine-signal-part" />
    </div>
    {signal.kind === "number" ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={draft.runHours} onChange={(event) => setDraft({ ...draft, runHours: event.target.checked })} data-testid="machine-signal-run-hours" />
      <span>Ger delens drifttimmar<span className="block text-xs text-muted-foreground">Kräver en egen maskindel. Planer på drifttimmar följer värdet. Ett lägre värde eller ett för stort hopp används inte, och syns på delen.</span></span></label> : null}
    <p className="text-xs text-muted-foreground">Utan egen del gäller källans. Workflow är inget larm- eller säkerhetssystem.</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>Avbryt</Button>
      <Button type="submit" size="sm" data-testid="machine-signal-save" busy={busy} busyLabel="Sparar…">Spara signalen</Button>
    </div>
  </form>;
}
