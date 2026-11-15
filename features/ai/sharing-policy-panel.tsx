"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { LoaderCircle, Sparkles, Eye, Wand2, Newspaper } from "lucide-react";
import { Panel, SwitchRow } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { useLoadEffect } from "@/lib/use-load-effect";
import { PageHeader } from "@/components/page-shell";
import { AdvancedFold } from "@/features/workflow/section-tabs";
import { AiProfileChoice } from "@/features/ai/ai-profile-choice";

type Policy = {
  enabled: boolean;
  shareChatContent: boolean;
  shareWork: boolean;
  shareCustomers: boolean;
  shareControls: boolean;
  shareDocuments: boolean;
  shareConversationHistory: boolean;
  dailyDigest?: boolean;
  shareMachines?: boolean;
  requireEu?: boolean;
  profile?: "standard" | "eu";
  allowedModules: "KFID"[];
  abilities?: Partial<Record<AbilityKey, boolean>>;
};
type AbilityKey = "chatProposals" | "moreToolCalls" | "teamOverview" | "riskTogether";
type ShareKey = "shareChatContent" | "shareWork" | "shareCustomers" | "shareDocuments" | "shareConversationHistory";
type Status = { conditions: { provider: { ready: boolean; reason?: string }; availableCredits: { available: boolean; balance: number } } };

// What AI may read, at Workflow's level rather than per task type (2026-10-01: Workflow began as Kontroll före
// idrifttagning and now has many kinds of tasks). Each choice governs its own sources on the server.
const reads: { key: ShareKey; title: string; help: string }[] = [
  { key: "shareChatContent", title: "Frågor i chatten", help: "Krävs för att frågor ska nå AI-modellen." },
  { key: "shareWork", title: "Uppgifter och projekt", help: "Rubrik, status, datum och antal – för den som frågar." },
  { key: "shareCustomers", title: "Kunder och anläggningar", help: "Det sökningen hittar, som källor till svaret." },
  { key: "shareDocuments", title: "Dokument och bilagor", help: "Filnamn, och filer någon själv låter AI analysera i Import." },
  { key: "shareConversationHistory", title: "Tidigare frågor i samma konversation", help: "Gör att följdfrågor förstås. Bara personens egna frågor." },
];

// Vad Workflow AI får göra (2026-10-09: "Vad AI får göra är en admin-inställning, men ju mer den kan desto
// bättre"): one switch per capability, all on from the start. The server checks each one at every call.
const abilities: { key: AbilityKey; title: string; help: string }[] = [
  { key: "chatProposals", title: "Förslag från chatten", help: "Arbetsordrar, material, tid, planering och offerter. Inget sparas förrän någon trycker på Använd." },
  { key: "moreToolCalls", title: "Fler steg när någon ber om arbete", help: "Upp till 5 saker i stället för 3 per svar, ungefär 2 öre mer." },
  { key: "teamOverview", title: "Lagöversikt", help: "Lagets förfallna och väntande arbetsordrar – bara det personen får se." },
  { key: "riskTogether", title: "Riskbedömning tillsammans", help: "Föreslår faror och skyddsåtgärder i den utökade riskbedömningen." },
];
const abilityOn = (policy: Policy, key: AbilityKey) => policy.abilities?.[key] !== false;
const normal = (value: Policy): Policy => ({ ...value, shareWork: value.shareWork || (value.shareControls && value.allowedModules.includes("KFID")) });

/** Loads the company's AI policy and saves every change at once (UX-granskningen C4, 2026-10-22: no Spara valen). */
function usePolicy() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/policy", { cache: "no-store" });
      if (!response.ok) throw new Error("AI-inställningarna kunde inte hämtas.");
      const data = await response.json() as { policy: Policy; canManage: boolean };
      setPolicy(normal(data.policy)); setCanManage(data.canManage);
      const statusResponse = await fetch("/api/ai/status", { cache: "no-store" });
      if (statusResponse.ok) setStatus(await statusResponse.json() as Status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI-inställningarna kunde inte hämtas.");
    }
  }, []);
  useLoadEffect(load);
  // One change, saved at once; on an error the switch goes back. The server logs every change in the administration history.
  async function change(next: Partial<Policy>) {
    if (!policy || !canManage) return;
    const before = policy;
    const wanted = { ...policy, ...next };
    setPolicy(wanted); setBusy(true); setError("");
    try {
      const response = await fetch("/api/ai/policy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...wanted, shareControls: wanted.shareWork, allowedModules: wanted.shareWork ? ["KFID"] : [] }) });
      const data = await response.json() as { policy?: Policy; error?: string };
      if (!response.ok || !data.policy) throw new Error(data.error || "AI-inställningarna kunde inte sparas.");
      setPolicy(normal(data.policy));
    } catch (cause) {
      setPolicy(before);
      setError(cause instanceof Error ? cause.message : "AI-inställningarna kunde inte sparas.");
    } finally { setBusy(false); }
  }
  return { policy, status, canManage, busy, error, change };
}

/**
 * Workflow AI under Inställningar → Arbetssätt (2026-10-01; a part of Arbetssätt since 2026-10-15; switches since
 * UX-granskningen C4, 2026-10-22): the main switch and the EU choice first; what AI may read and do and the nightly
 * summary only once AI is on, folded under Avancerat. Every choice is saved the moment it is made and checked again on the
 * server at each call; names, places and addresses are always sent as aliases (Hjälp → Workflow AI says how). Maskinanalys
 * is chosen under Kopplingar → Maskiner (`AiMachineExplainSwitch`).
 */
export function AiSharingPolicyPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { policy, status, canManage, busy, error, change } = usePolicy();
  const modelOn = Boolean(status?.conditions.provider.ready);
  const locked = !canManage || busy;
  return <div className="space-y-6" data-testid="ai-permissions">
    {embedded ? null : <PageHeader title="Workflow AI" description={<>Vad AI får läsa och göra i företaget. {canManage ? "Du är företagsadmin och bestämmer valen." : "Företagets admin bestämmer valen. Här ser du vad som gäller."}</>} />}
    {embedded && policy && !canManage ? <p className="text-sm text-muted-foreground">Företagets admin bestämmer valen. Här ser du vad som gäller.</p> : null}
    {!policy ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" /> Hämtar AI-inställningar…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="ai-permissions-status">
        <StatusTile label="Direkta svar ur Workflow" ok text="Alltid på – kostar inget" />
        <StatusTile label="Företagets AI" ok={policy.enabled && policy.shareChatContent} text={policy.enabled && policy.shareChatContent ? "På" : "Av"} />
        <StatusTile label="AI-modellen på servern" ok={modelOn} text={status ? (modelOn ? "Påslagen" : "Inte påslagen än") : "…"} hint={modelOn ? undefined : status?.conditions.provider.reason} />
        <StatusTile label="AI-krediter" ok={Boolean(status?.conditions.availableCredits.available)} text={status ? (status.conditions.availableCredits.available ? `${status.conditions.availableCredits.balance} kvar` : "Saknas – AI svarar inte") : "…"} />
      </div>

      <Panel icon={Sparkles} title="Använd Workflow AI" description="Av: inget skickas till AI-modellen, men direkta svar ur Workflow fungerar.">
        <div className="divide-y">
          <SwitchRow id="ai-enabled" testId="ai-enabled" title="Slå på Workflow AI för företaget" text="Frågor som kräver tolkning besvaras av AI-modellen och dras från krediterna."
            checked={policy.enabled} disabled={locked} onCheckedChange={(on) => void change({ enabled: on, ...(on ? { shareChatContent: true } : {}) })} />
          <SwitchRow id="ai-requireEu" testId="ai-requireEu" title="Uppgifterna måste behandlas inom EU" text="Då körs AI bara via Azure, med behandling i EU. Är Azure inte klar är AI avstängd."
            checked={Boolean(policy.requireEu)} disabled={locked} onCheckedChange={(on) => void change({ requireEu: on })} />
        </div>
      </Panel>
      <AiProfileChoice key={String(Boolean(policy.requireEu))} requireEu={Boolean(policy.requireEu)} locked={locked} onChoose={(profile) => change({ profile })} />

      {policy.enabled ? <AdvancedFold summary="Vad AI får läsa och göra, och dagsammanställningen" testId="ai-advanced">
        <Panel icon={Eye} title="Vad AI får läsa" description="AI får bara det den som frågar själv får se.">
          <div className="divide-y">
            {reads.map((item) => <SwitchRow key={item.key} id={`ai-${item.key}`} testId={`ai-${item.key}`} title={item.title} text={item.help}
              checked={policy[item.key]} disabled={locked || item.key === "shareChatContent"}
              reason={item.key === "shareChatContent" ? "Krävs när Workflow AI är på." : null}
              onCheckedChange={(on) => void change({ [item.key]: on })} />)}
          </div>
        </Panel>
        <Panel icon={Wand2} title="Vad Workflow AI får göra" description="Personens behörighet gäller alltid och inget sparas utan bekräftelse.">
          <div className="divide-y" data-testid="ai-abilities">
            {abilities.map((item) => <SwitchRow key={item.key} id={`ai-ability-${item.key}`} testId={`ai-ability-${item.key}`} title={item.title} text={item.help}
              checked={abilityOn(policy, item.key)} disabled={locked} onCheckedChange={(on) => void change({ abilities: { ...policy.abilities, [item.key]: on } })} />)}
          </div>
        </Panel>
        <Panel icon={Newspaper} title="Dagsammanställning" description="Det enda Workflow AI gör utan att någon använder Workflow.">
          <SwitchRow id="ai-dailyDigest" testId="ai-dailyDigest" title="Kort sammanställning av dagen varje natt" text="Visas på Översikt nästa morgon och kostar krediter som ett AI-svar."
            checked={Boolean(policy.dailyDigest)} disabled={locked || !policy.shareWork} reason={!policy.shareWork ? "Kräver Uppgifter och projekt under Vad AI får läsa." : null}
            onCheckedChange={(on) => void change({ dailyDigest: on })} />
        </Panel>
      </AdvancedFold> : null}

      <p className="text-xs leading-5 text-muted-foreground">Vad AI gör och aldrig gör, och hur namn byts mot alias: <Link href="/?view=help&step=ai#hjalp-ai" className="text-primary underline" data-testid="ai-rules-link">Hjälp → Workflow AI</Link>. Hur ofta tips visas väljer var och en under Mina inställningar.</p>
    </>}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}

/**
 * Maskinanalys (C4, 2026-10-22: under Kopplingar → Maskiner, where the machines are): whether AI may explain a rule's
 * observation when someone presses Förklara med AI. Saved at once; only while Workflow AI is on for the company.
 */
export function AiMachineExplainSwitch() {
  const { policy, canManage, busy, error, change } = usePolicy();
  if (!policy) return null;
  return <div data-testid="ai-machine-explain">
    <SwitchRow id="ai-shareMachines" testId="ai-shareMachines" title="Låt AI förklara en observation om en maskin" text="Först när någon trycker Förklara med AI; källans namn skickas aldrig."
      checked={Boolean(policy.shareMachines)} disabled={!canManage || busy || !policy.enabled} reason={!policy.enabled ? "Slå på Workflow AI under Arbetssätt först." : null}
      onCheckedChange={(on) => void change({ shareMachines: on })} />
    {/* The way there, not only its name (kundresa 2026-11-07, L50). */}
    {!policy.enabled && canManage ? <Link href="/?view=company_features&section=ai" className="mt-1 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline" data-testid="ai-machine-explain-settings">Öppna Arbetssätt → Workflow AI</Link> : null}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}

function StatusTile({ label, ok, text, hint }: { label: string; ok: boolean; text: string; hint?: string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="size-3.5 text-primary" />{label}</p><p className={cn("mt-1 text-sm font-semibold", ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>{text}</p>{hint ? <p className="mt-1 text-xs text-muted-foreground" data-testid="ai-model-reason">{hint}</p> : null}</div>;
}
