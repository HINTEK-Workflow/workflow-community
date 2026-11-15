"use client";
import { AiCreditSettingsPanel } from "@/features/ai/credit-settings-panel";
import { OpenAiModelsPanel } from "@/features/ai/openai-models-panel";
import { AdvancedFold } from "@/features/workflow/section-tabs";

import { useCallback, useState } from "react";
import { LoaderCircle, Play, ServerCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/features/kfid/ui";
import { useInstance } from "@/components/instance-provider";
import { useLoadEffect } from "@/lib/use-load-effect";

type Status = {
  provider: {
    adapter: string; architecture: string; enabled: boolean; requested: boolean;
    evalEnabled: boolean; configured: boolean; dpaApproved: boolean;
    processingMode: "GLOBAL" | "EU"; euDataControlsApproved: boolean;
    providerEvalApproved: boolean; processingRegion: "GLOBAL" | "EU";
    providerStateStored: false;
  };
  routes: { taskKind: string; label: string; model: string }[];
};
type EvalStatus = { ready: boolean; normalProviderDisabled: boolean };
type EvalResult = { model: string; result: "PASS"; inputTokens: number; outputTokens: number };

/**
 * Workflow AI:s leverantör i Installation (C6, 2026-10-21: every key in one place). part="service": the EU
 * provider (Azure, with its key) and the technical status with the eval suite, on Tjänster och nycklar beside the OpenAI
 * card, which holds the OpenAI key itself (ProviderKeyPanel). part="cost": what an AI answer costs, under Priser → Avancerat.
 */
export function ProviderAdministration({ part = "service" }: { part?: "service" | "cost" }) {
  return part === "cost" ? <AiCostPart /> : <ProviderServicePart />;
}

function AiCostPart() {
  // The price of an AI answer belongs to Workflow's credit system; without it AI is paid for on the OpenAI account.
  const { features } = useInstance();
  return features.credits ? <AiCreditSettingsPanel /> : null;
}

function ProviderServicePart() {
  const [status, setStatus] = useState<Status | null>(null);
  const [evalStatus, setEvalStatus] = useState<EvalStatus | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [statusResponse, evalResponse] = await Promise.all([
        fetch("/api/ai/status?details=admin", { cache: "no-store" }),
        fetch("/api/ai/evals", { cache: "no-store" }),
      ]);
      if (!statusResponse.ok || !evalResponse.ok) throw new Error("Teknisk AI-status kunde inte hämtas.");
      setStatus(await statusResponse.json() as Status);
      setEvalStatus(await evalResponse.json() as EvalStatus);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Teknisk AI-status kunde inte hämtas."); }
  }, []);
  useLoadEffect(load);

  async function runEval() {
    setBusy(true); setError(""); setResults([]);
    try {
      const response = await fetch("/api/ai/evals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "run_suite" }) });
      const data = await response.json() as { results?: EvalResult[]; error?: string };
      if (!response.ok || !data.results) throw new Error(data.error || "Provsviten kunde inte köras.");
      setResults(data.results);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Provsviten kunde inte köras."); }
    finally { setBusy(false); }
  }

  return <AdvancedFold title="Mer om AI" summary="OpenAI:s modeller och priser, provsviten, modellval" testId="ai-technical"><OpenAiModelsPanel /><Panel icon={ServerCog} title="AI-leverantör och modellval">
    {!status || !evalStatus ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" /> Hämtar leverantörens status…</p> : <div className="grid gap-4 lg:grid-cols-2">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-xl border p-4 text-xs">
        <dt className="text-muted-foreground">Adapter</dt><dd>{status.provider.adapter}</dd>
        <dt className="text-muted-foreground">Arkitektur</dt><dd>{status.provider.architecture}</dd>
        <dt className="text-muted-foreground">Behandlingsläge</dt><dd>{status.provider.processingMode}</dd>
        <dt className="text-muted-foreground">DPA/rättslig grund</dt><dd>{status.provider.dpaApproved ? "Bekräftad" : "Inte bekräftad"}</dd>
        <dt className="text-muted-foreground">Nyckel</dt><dd>{status.provider.configured ? "Finns" : "Saknas"}</dd>
        <dt className="text-muted-foreground">Normalt leverantörsläge</dt><dd>{status.provider.enabled ? "Aktivt" : "Avstängt"}</dd>
        <dt className="text-muted-foreground">Provider-eval</dt><dd>{status.provider.providerEvalApproved ? "Godkänd" : "Inte godkänd"}</dd>
        <dt className="text-muted-foreground">Providerlagring</dt><dd>{status.provider.providerStateStored ? "På" : "store:false"}</dd>
      </dl>
      <div className="rounded-xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div><p className="flex items-center gap-2 text-sm font-medium"><ServerCog className="size-4" /> Syntetisk providersvit</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Kör bara provsviten när provläget är redo och normalt leverantörsläge är av.</p></div>
          <Button type="button" variant="outline" size="sm" disabled={busy || !evalStatus.ready} onClick={() => void runEval()}>{busy ? <LoaderCircle className="animate-spin" /> : <Play />} Kör provsviten</Button>
        </div>
        {results.length ? <ul className="mt-3 space-y-1 border-t pt-3 text-xs" aria-label="Resultat av provsviten">{results.map((result) => <li key={result.model} className="flex justify-between gap-3"><span>{result.model}</span><span className="text-emerald-700">{result.result}</span></li>)}</ul> : null}
      </div>
      <div className="lg:col-span-2"><p className="mb-2 text-xs font-medium">Serverstyrd modellrouting</p><ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{status.routes.map((route) => <li key={route.taskKind} className="flex justify-between gap-3 rounded-lg border px-3 py-2 text-xs"><span>{route.label}</span><span className="text-muted-foreground">{route.model}</span></li>)}</ul></div>
    </div>}
    {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
  </Panel></AdvancedFold>;
}
