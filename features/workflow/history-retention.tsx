"use client";

import { plural } from "@/lib/plural";
import { useCallback, useState } from "react";
import { Check, Eye, History, ShieldAlert, ShieldCheck, ScrollText, Trash2, Info, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Panel } from "@/features/kfid/ui";
import { useInstance } from "@/components/instance-provider";
import { formatSwedish } from "@/lib/swedish-time";
import {
  countTotal,
  HISTORY_CATEGORIES,
  HISTORY_CATEGORY_KEYS,
  HISTORY_RETENTION_CHOICES,
  retentionLabel,
  type HistoryCategory,
  type HistoryCounts,
  type HistoryRetentionMonths,
} from "@/lib/workflow/history-retention";
import { useLoadEffect } from "@/lib/use-load-effect";
import { PageHeader } from "@/components/page-shell";
import { DEFAULT_LOG_RETENTION_YEARS, LOG_RETENTION_YEARS, logRetentionLabel, type LogRetentionYears } from "@/lib/traceability/log-retention";

type ChainStatus = { log: string; label: string; rows: number; verifiedAt: string | null; broken: null | { at: string; seq: number | null; text: string } };
type State = {
  months: HistoryRetentionMonths;
  pending: HistoryCounts | null;
  recent: { id: string; action: string; detail: string; createdAt: string }[];
  /** Lagringstid för loggar and the logs' chains (K3.1, K3.3, 2026-11-27); an older answer may lack it. */
  logs?: { years: LogRetentionYears; chains: ChainStatus[] };
};

const send = (input: unknown) => api<Record<string, unknown>>("/api/history-retention", { method: "POST", body: JSON.stringify(input) });
const aYearAgo = () => { const date = new Date(); date.setUTCFullYear(date.getUTCFullYear() - 1); return date.toISOString().slice(0, 10); };

/**
 * Historik och lagring (2026-09-30): the company admin chooses how long the work history is kept (the nightly
 * job removes what is older) and can delete older history by hand after seeing exactly how much goes. Since 2026-10-15
 * a part of Företaget (`embedded`): the page's group heading names it, and the reference cards (what counts as history,
 * the latest changes) start folded.
 */
export function HistoryRetention({ notify, embedded = false }: { notify: (text: string, error?: boolean) => void; embedded?: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [months, setMonths] = useState<HistoryRetentionMonths>(null);
  const [before, setBefore] = useState(aYearAgo);
  // Workflow AI and its chats exist only in Workflow's edition (ee/).
  const { features } = useInstance();
  const categories = HISTORY_CATEGORIES.filter((category) => category.key !== "ai" || features.ai);
  const [chosen, setChosen] = useState<Set<HistoryCategory>>(() => new Set(HISTORY_CATEGORY_KEYS.filter((key) => key !== "ai" || features.ai)));
  const [preview, setPreview] = useState<{ key: string; counts: HistoryCounts } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCard, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try {
      const next = await api<State>("/api/history-retention", { cache: "no-store" });
      setState(next); setMonths(next.months); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);
  const previewKey = `${before}|${[...chosen].sort().join(",")}`;
  const counts = preview?.key === previewKey ? preview.counts : null;

  // Lagringstiden sparas direkt när den väljs (kunder2 2026-10-18), med "Sparat" intill fältet. En kortare tid raderar
  // äldre historik i natt, så den frågar först.
  const [saved, setSaved] = useState(false);
  const saveRetention = async (next: HistoryRetentionMonths) => {
    const shortens = next !== null && (state?.months == null || next < state.months);
    if (shortens && !(await confirmCard({ title: "Ändra lagringstiden?", message: `Historik som är äldre än ${retentionLabel(next).toLowerCase()} raderas i natt.`, confirmLabel: "Ändra lagringstid", tone: "danger" }))) { setMonths(state?.months ?? null); return; }
    setBusy(true); setSaved(false);
    try { await send({ action: "retention", months: next }); setSaved(true); notify(`Lagringstiden är ${retentionLabel(next).toLowerCase()}.`); await load(); }
    catch (cause) { setMonths(state?.months ?? null); notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const showPreview = async () => {
    setBusy(true);
    try { const result = await send({ action: "preview", before, categories: [...chosen] }); setPreview({ key: previewKey, counts: result.counts as HistoryCounts }); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const purge = async () => {
    if (!counts || !countTotal(counts)) return;
    if (!(await confirmCard({ title: "Radera historiken?", message: `${plural(countTotal(counts), "post", "poster")} äldre än ${before} raderas permanent. Uppgifter, kontroller, projekt och planeringar finns kvar som de är nu. Det går inte att ångra.`, confirmLabel: "Radera historiken", tone: "danger" }))) return;
    setBusy(true);
    try {
      const result = await send({ action: "purge", before, categories: [...chosen], confirm: true });
      notify(`${plural(countTotal(result.counts as HistoryCounts), "post", "poster")} i historiken är raderade.`);
      setPreview(null); await load();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };

  const heading = embedded ? null : <PageHeader title="Historik och lagring" description="Välj hur länge historiken sparas och radera äldre historik för hand. Nuvarande innehåll i uppgifter, kontroller, projekt och planeringar påverkas aldrig." />;
  if (error) return <div className="space-y-6">{heading}<p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!state) return <div className="space-y-6">{heading}<p className="page-description">Hämtar historiken…</p></div>;
  return <div className="space-y-6" data-testid="history-retention">
    {confirmElement}
    {heading}
    <Panel icon={Info} title="Vad som räknas som historik" description="Bara arbetshistorik kan raderas." collapsible={embedded} defaultCollapsed={embedded}>
      <ul className="grid gap-2 text-sm sm:grid-cols-2">{categories.map((category) => <li key={category.key} className="rounded-lg border bg-muted/20 p-3"><p className="font-medium">{category.label}</p><p className="mt-1 text-xs text-muted-foreground">{category.note}</p></li>)}</ul>
      <p className="mt-3 flex gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 shrink-0 text-primary" />{features.billing || features.credits
        ? "Behålls alltid: projektens beslutslogg, godkända villkor, order, fakturor, betalningar, krediter och AI-körningarnas kostnadslogg – de är underlag för avtal och bokföring."
        : features.ai
          ? "Behålls alltid: projektens beslutslogg, godkända villkor och AI-körningarnas logg – de är underlag för avtal."
          : "Behålls alltid: projektens beslutslogg och godkända villkor – de är underlag för avtal."}</p>
    </Panel>
    <Panel icon={Hourglass} title="Lagringstid" description="Historik äldre än lagringstiden raderas varje natt, även rapporter i Rapportarkivet. Välj Tills vidare för att bara radera för hand.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Behåll historiken i<select className="form-select min-w-56" value={months ?? ""} disabled={busy} onChange={(event) => { const next = event.target.value ? Number(event.target.value) as HistoryRetentionMonths : null; setMonths(next); setSaved(false); void saveRetention(next); }} data-testid="retention-select">
          {HISTORY_RETENTION_CHOICES.map((choice) => <option key={choice ?? "forever"} value={choice ?? ""}>{retentionLabel(choice)}</option>)}
        </select></label>
        {saved && months === state.months ? <span className="inline-flex items-center gap-1 pb-2 text-xs text-muted-foreground" role="status" data-testid="retention-saved"><Check className="size-3.5" />Sparat</span> : null}
      </div>
      {state.months && state.pending ? <p className="mt-3 text-sm text-muted-foreground" data-testid="retention-pending">{countTotal(state.pending) ? `${plural(countTotal(state.pending), "post", "poster")} är äldre än lagringstiden och raderas i natt.` : "Ingen historik är äldre än lagringstiden."}</p> : null}
    </Panel>
    {state.logs ? <LogRetention logs={state.logs} busy={busy} setBusy={setBusy} confirm={confirmCard} notify={notify} onSaved={load} /> : null}
    <Panel icon={Trash2} title="Radera historik för hand" description="Välj datum och vad som ska raderas. Du ser antalet innan något raderas.">
      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <label className="grid content-start gap-1.5 text-xs font-medium text-muted-foreground">Radera historik äldre än<Input type="date" value={before} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setBefore(event.target.value)} data-testid="purge-before" /></label>
        <fieldset className="grid gap-2"><legend className="mb-1 text-xs font-medium text-muted-foreground">Vad som raderas</legend>
          {categories.map((category) => <label key={category.key} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={chosen.has(category.key)} onChange={(event) => setChosen((current) => { const next = new Set(current); if (event.target.checked) next.add(category.key); else next.delete(category.key); return next; })} />
            <span>{category.label}{counts ? <span className="ml-2 text-xs text-muted-foreground" data-testid={`purge-count-${category.key}`}>{counts[category.key]} st</span> : null}</span></label>)}
        </fieldset>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy || !chosen.size} onClick={() => void showPreview()}><Eye />Visa vad som raderas</Button>
        <Button type="button" variant="destructive" disabled={busy || !counts || !countTotal(counts)} onClick={() => void purge()} data-testid="purge-confirm"><Trash2 />Radera historiken</Button>
        {counts ? <span className="text-sm text-muted-foreground" data-testid="purge-total">{countTotal(counts) ? `${plural(countTotal(counts), "post", "poster")} raderas.` : "Inget att radera före datumet."}</span> : null}
      </div>
    </Panel>
    <Panel icon={History} title="Senaste ändringar" description="Varje ändring av lagringstiden och varje radering loggas med antal, aldrig med innehåll." collapsible={embedded} defaultCollapsed={embedded}>
      {state.recent.length ? <ul className="divide-y rounded-lg border text-sm">{state.recent.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 p-3"><span className="flex gap-2"><History className="mt-0.5 size-4 shrink-0 text-muted-foreground" />{event.detail}</span><time className="text-xs text-muted-foreground" dateTime={event.createdAt}>{formatSwedish(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time></li>)}</ul>
        : <p className="text-sm text-muted-foreground">Inga ändringar ännu.</p>}
    </Panel>
  </div>;
}

/**
 * Lagringstid för loggar (K3.3, 2026-11-27): how long the security, administration and change logs are kept – 1, 2, 5
 * or 10 years – saved when chosen, as Lagringstid; a shorter time asks first (rows go tonight) and the server asks for a fresh
 * sign-in. Under it each log's chain (K3.1): checked every night, or the break the check found. The logs are never removed by
 * hand: a tamper-evident log is removed only by its retention time.
 */
function LogRetention({ logs, busy, setBusy, confirm, notify, onSaved }: {
  logs: NonNullable<State["logs"]>; busy: boolean; setBusy: (busy: boolean) => void;
  confirm: ReturnType<typeof useConfirm>[0]; notify: (text: string, error?: boolean) => void; onSaved: () => Promise<void>;
}) {
  const [years, setYears] = useState<LogRetentionYears>(logs.years ?? DEFAULT_LOG_RETENTION_YEARS);
  const [saved, setSaved] = useState(false);
  const save = async (next: LogRetentionYears) => {
    if (next < logs.years && !(await confirm({ title: "Ändra lagringstiden för loggarna?", message: `Loggrader som är äldre än ${logRetentionLabel(next)} raderas i natt. Det går inte att ångra.`, confirmLabel: "Ändra lagringstid", tone: "danger" }))) { setYears(logs.years); return; }
    setBusy(true); setSaved(false);
    try { await send({ action: "log_retention", years: next }); setSaved(true); notify(`Loggarna sparas i ${logRetentionLabel(next)}.`); await onSaved(); }
    catch (cause) { setYears(logs.years); notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const broken = logs.chains.filter((chain) => chain.broken);
  return <Panel icon={ScrollText} title="Lagringstid för loggar" description="Säkerhetsloggen, administrationsloggen och ändringshistoriken. Äldre rader raderas varje natt.">
    <div className="space-y-4" data-testid="log-retention">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Behåll loggarna i<select className="form-select min-w-40" value={years} disabled={busy} onChange={(event) => { const next = Number(event.target.value) as LogRetentionYears; setYears(next); setSaved(false); void save(next); }} data-testid="log-retention-select">
          {LOG_RETENTION_YEARS.map((choice) => <option key={choice} value={choice}>{logRetentionLabel(choice)}{choice === DEFAULT_LOG_RETENTION_YEARS ? " (förval)" : ""}</option>)}
        </select></label>
        {saved && years === logs.years ? <span className="inline-flex items-center gap-1 pb-2 text-xs text-muted-foreground" role="status" data-testid="log-retention-saved"><Check className="size-3.5" />Sparat</span> : null}
      </div>
      {broken.length ? <div role="alert" className="notice border-destructive/40 text-sm text-destructive" data-testid="log-chain-broken">
        <p className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4 shrink-0" />{broken.length === 1 ? `${broken[0].label} stämmer inte.` : "Loggarna stämmer inte."}</p>
        <ul className="mt-1 space-y-0.5 text-xs">{broken.map((chain) => <li key={chain.log}>{chain.label}: {chain.broken!.text}{chain.broken!.seq ? ` Rad ${chain.broken!.seq}.` : ""} Upptäcktes {formatSwedish(chain.broken!.at, { dateStyle: "medium" })}.</li>)}</ul>
        <p className="mt-1 text-xs">Loggarna rensas inte medan kedjan är bruten. Installationens administratör har fått ett larm.</p>
      </div> : null}
      {logs.chains.length ? <ul className="divide-y rounded-lg border text-sm" data-testid="log-chains">{logs.chains.map((chain) => <li key={chain.log} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2">{chain.broken ? <ShieldAlert className="size-4 shrink-0 text-destructive" /> : <ShieldCheck className="size-4 shrink-0 text-primary" />}{chain.label}</span>
        <span className="text-xs text-muted-foreground" data-testid="log-chain-state">{chain.broken ? "Bruten" : chain.verifiedAt ? `Hel · kontrollerad ${formatSwedish(chain.verifiedAt, { dateStyle: "medium", timeStyle: "short" })}` : "Kontrolleras i natt"}</span>
      </li>)}</ul> : null}
      <p className="flex gap-2 text-xs text-muted-foreground"><Info className="size-4 shrink-0" />Varje rad i loggarna bär ett kontrollvärde från raden före. Kedjan kontrolleras varje natt, så att en ändrad eller borttagen rad syns.</p>
    </div>
  </Panel>;
}
