"use client";

import { useCallback, useEffect, useState } from "react";
import { formatSwedish, SWEDISH_TIME_ZONE } from "@/lib/swedish-time";
import {
  Activity,
  Bot,
  Building2,
  Coins,
  LoaderCircle,
  RefreshCw,
  Users,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/features/kfid/ui";

type Usage = {
  days: number;
  bucket: "day" | "month";
  contentIncluded: false;
  summary: {
    runs: number; completed: number; failed: number; active: number;
    activeOrganizations: number; activeUsers: number; chargedCredits: number;
    providerCostOre: number; inputTokens: number; cachedInputTokens: number; outputTokens: number;
  };
  series: { date: string; runs: number; completed: number; failed: number; chargedCredits: number; providerCostOre: number }[];
  companies: {
    organizationId: string; name: string; isInternal: boolean; aiEnabled: boolean;
    runs: number; completed: number; failed: number; activeUsers: number;
    chargedCredits: number; providerCostOre: number; latestRunAt: string; creditBalance: number;
  }[];
  models: { model: string; runs: number; chargedCredits: number; providerCostOre: number; inputTokens: number; outputTokens: number }[];
  /** Per place in Workflow (chat, tip, summary, import); older runs have no place and show their agent. */
  surfaces?: { surface: string; agentId: string; runs: number; chargedCredits: number; providerCostOre: number; inputTokens: number; cachedInputTokens: number; outputTokens: number }[];
};

const SURFACE_LABELS: Record<string, string> = { chat: "Chatten", "chat-page": "Chatten på en sida", tip: "Fråga Workflow AI från ett tips", summary: "Skriv med AI (sammanfattning)", import: "Import", "proposal-work-order": "Föreslå arbetsorder", "proposal-risk-measures": "Föreslå åtgärder", "proposal-planning": "Föreslå planering", review: "Granska med AI", digest: "Dagsammanställning" };
const AGENT_LABELS: Record<string, string> = { "workflow-assistant": "Chatten (äldre körningar)", "document-import": "Import (äldre körningar)", "kfid-control-review": "Kontrollgranskning" };
/** How much of the input the provider read from its cache, in whole percent. */
const cachedShare = (cached: number, input: number) => (input ? Math.round((cached / input) * 100) : 0);

const integer = new Intl.NumberFormat("sv-SE");
const sek = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" });
const date = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short", timeZone: SWEDISH_TIME_ZONE });
const percent = (completed: number, failed: number) => {
  const finished = completed + failed;
  return finished ? Math.round(completed / finished * 100) : 0;
};

function Kpi({ icon, label, value, help }: { icon: React.ReactNode; label: string; value: string; help: string }) {
  return <div className="rounded-xl border bg-card p-4">
    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{icon}{label}</div>
    <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
    <p className="mt-1 text-xs text-muted-foreground">{help}</p>
  </div>;
}

export function AiUsageAdministration() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/superadmin/ai-usage?days=${days}`, { cache: "no-store" });
      const result = await response.json() as Usage & { error?: string };
      if (!response.ok) throw new Error(result.error || "AI-statistiken kunde inte hämtas.");
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI-statistiken kunde inte hämtas.");
    } finally { setBusy(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const maxRuns = Math.max(1, ...(data?.series.map((item) => item.runs) ?? []));
  return <Panel title="AI-användning" description="Innehållsfri statistik från Workflows egen kredit- och körningsledger. Frågor, svar och konversationstitlar visas aldrig här.">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <label htmlFor="ai-usage-window" className="mb-1 block text-xs font-medium text-muted-foreground">Period</label>
        <select id="ai-usage-window" className="form-select w-auto" value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>7 dagar</option><option value={30}>30 dagar</option><option value={90}>90 dagar</option><option value={365}>12 månader</option>
        </select>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load()}>{busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Uppdatera</Button>
    </div>
    {error ? <p className="mt-4 text-sm text-destructive" role="alert">{error}</p> : null}
    {!data && busy ? <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" /> Hämtar AI-användning…</p> : null}
    {data ? <div className="mt-5 space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi icon={<Activity className="size-4 text-violet-600" />} label="AI-körningar" value={integer.format(data.summary.runs)} help={`${integer.format(data.summary.completed)} klara · ${integer.format(data.summary.failed)} fel`} />
        <Kpi icon={<Building2 className="size-4 text-sky-600" />} label="Aktiva företag" value={integer.format(data.summary.activeOrganizations)} help={`${integer.format(data.summary.activeUsers)} aktiva användare`} />
        <Kpi icon={<Coins className="size-4 text-amber-600" />} label="Debiterade krediter" value={integer.format(data.summary.chargedCredits)} help={`${integer.format(data.summary.active)} reserverade eller pågående`} />
        <Kpi icon={<WalletCards className="size-4 text-emerald-600" />} label="Leverantörskostnad" value={sek.format(data.summary.providerCostOre / 100)} help="Faktisk slutreglerad kostnad" />
        <Kpi icon={<Bot className="size-4 text-violet-600" />} label="Lyckandegrad" value={`${percent(data.summary.completed, data.summary.failed)} %`} help="Av avslutade körningar" />
        <Kpi icon={<Users className="size-4 text-sky-600" />} label="Tokens" value={integer.format(data.summary.inputTokens + data.summary.outputTokens)} help={`${integer.format(data.summary.cachedInputTokens)} cachelagrade inputtokens`} />
      </div>

      <section aria-labelledby="ai-usage-trend">
        <div className="flex items-center justify-between gap-3"><h3 id="ai-usage-trend" className="text-sm font-medium">Körningar över tid</h3><span className="text-xs text-muted-foreground">{data.bucket === "month" ? "Per månad" : "Per dag"}</span></div>
        {data.series.length ? <div className="mt-3 flex h-36 items-end gap-1 overflow-x-auto rounded-xl border bg-muted/20 px-3 pb-3 pt-5" aria-label="Diagram över AI-körningar">
          {data.series.map((item) => <div key={item.date} className="group flex min-w-2 flex-1 flex-col items-center justify-end" title={`${formatSwedish(item.date, { dateStyle: "short" })}: ${item.runs} körningar`}>
            <div className="w-full min-w-1.5 rounded-t bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(4, item.runs / maxRuns * 96)}px` }} />
          </div>)}
        </div> : <p className="mt-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Inga AI-körningar under perioden.</p>}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <section aria-labelledby="ai-usage-companies" className="min-w-0">
          <h3 id="ai-usage-companies" className="text-sm font-medium">Användning per företag</h3>
          <div className="mt-3 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Företag</th><th className="px-3 py-2 font-medium">Körningar</th><th className="px-3 py-2 font-medium">Användare</th><th className="px-3 py-2 font-medium">Krediter</th><th className="px-3 py-2 font-medium">Kostnad</th><th className="px-3 py-2 font-medium">Lyckade</th><th className="px-3 py-2 font-medium">Senast</th></tr></thead>
              <tbody>{data.companies.map((company) => <tr key={company.organizationId} className="border-t">
                <td className="px-3 py-3"><span className="font-medium">{company.name}</span><span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">{company.isInternal ? "Internt" : "Kund"} · AI {company.aiEnabled ? "på" : "av"} · saldo {integer.format(company.creditBalance)}</span></td>
                <td className="px-3 py-3">{integer.format(company.runs)}</td><td className="px-3 py-3">{integer.format(company.activeUsers)}</td><td className="px-3 py-3">{integer.format(company.chargedCredits)}</td><td className="px-3 py-3">{sek.format(company.providerCostOre / 100)}</td><td className="px-3 py-3">{percent(company.completed, company.failed)} %</td><td className="whitespace-nowrap px-3 py-3">{date.format(new Date(company.latestRunAt))}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>
        <section aria-labelledby="ai-usage-models">
          <h3 id="ai-usage-models" className="text-sm font-medium">Modeller</h3>
          <div className="mt-3 space-y-2">{data.models.map((model) => <div key={model.model} className="rounded-xl border p-3 text-xs">
            <div className="flex items-center justify-between gap-3"><span className="font-medium">{model.model}</span><span>{integer.format(model.runs)} körningar</span></div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground"><span>{integer.format(model.chargedCredits)} krediter</span><span>{sek.format(model.providerCostOre / 100)}</span><span>{integer.format(model.inputTokens + model.outputTokens)} tokens</span></div>
          </div>)}{!data.models.length ? <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">Ingen modellanvändning ännu.</p> : null}</div>
          <h3 id="ai-usage-surfaces" className="mt-6 text-sm font-medium">Ställen i Workflow</h3>
          <div className="mt-3 space-y-2" aria-labelledby="ai-usage-surfaces">{(data.surfaces ?? []).map((item) => <div key={`${item.surface}:${item.agentId}`} className="rounded-xl border p-3 text-xs" data-testid="ai-usage-surface">
            <div className="flex items-center justify-between gap-3"><span className="font-medium">{item.surface ? SURFACE_LABELS[item.surface] ?? item.surface : AGENT_LABELS[item.agentId] ?? item.agentId}</span><span>{integer.format(item.runs)} körningar</span></div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground"><span>{integer.format(item.chargedCredits)} krediter</span><span>{sek.format(item.providerCostOre / 100)}</span><span>{integer.format(item.inputTokens + item.outputTokens)} tokens</span><span>{cachedShare(item.cachedInputTokens, item.inputTokens)} % ur cache</span></div>
          </div>)}{!(data.surfaces ?? []).length ? <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">Ingen användning ännu.</p> : null}</div>
        </section>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Källa: Workflows innehållsfria AI-ledger. OpenAI:s organisationskostnader är inte inkopplade här och kan senare användas för separat ekonomisk avstämning.</p>
    </div> : null}
  </Panel>;
}
