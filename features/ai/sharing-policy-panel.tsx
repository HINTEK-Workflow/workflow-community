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
import { AiUsagePanel } from "@/features/ai/ai-usage-panel";
import { CompanyKeyPanel } from "@/features/ai/company-key-panel";
import { useInstance } from "@/components/instance-provider";

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
type Status = { conditions: { provider: { ready: boolean; reason?: string; companyKey?: boolean }; availableCredits: { available: boolean; balance: number } }; weeklyQuota?: { usedPercent: number; warn: boolean; full: boolean; quota: boolean } };

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
// Förslag från chatten and Riskbedömning tillsammans are built-in agents (2026-11-21: "alla sådana AI-funktioner ska vara
// redigerbara agenter"): they are switched under Agenter; what is left here is what the company's AI may do as a whole.
const abilities: { key: AbilityKey; title: string; help: string }[] = [
  { key: "moreToolCalls", title: "Fler steg när någon ber om arbete", help: "Upp till 5 saker i stället för 3 per svar. Det tar lite mer av veckans kvot." },
  { key: "teamOverview", title: "Lagöversikt", help: "Lagets förfallna och väntande arbetsordrar – bara det personen får se." },
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
  // Credits are Cloud's (2026-11-20): without Workflow's credit system the panel never mentions them.
  const credits = useInstance().features.credits;
  const modelOn = Boolean(status?.conditions.provider.ready);
  const quota = status?.weeklyQuota?.quota ? status.weeklyQuota : null;
  const locked = !canManage || busy;
  return <div className="space-y-6" data-testid="ai-permissions">
    {embedded ? null : <PageHeader title="Workflow AI" description={<>Vad AI får läsa och göra i företaget. {canManage ? "Du är företagsadmin och bestämmer valen." : "Företagets admin bestämmer valen. Här ser du vad som gäller."}</>} />}
    {embedded && policy && !canManage ? <p className="text-sm text-muted-foreground">Företagets admin bestämmer valen. Här ser du vad som gäller.</p> : null}
    {!policy ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" /> Hämtar AI-inställningar…</p> : <>
      {/* One chat (2026-11-21): no tile tells direct answers from AI answers; the week's quota stands where credits stood. */}
      <div className={cn("grid gap-3 sm:grid-cols-2", quota ? "xl:grid-cols-3" : "xl:grid-cols-2")} data-testid="ai-permissions-status">
        <StatusTile label="Företagets AI" ok={policy.enabled && policy.shareChatContent} text={policy.enabled && policy.shareChatContent ? "På" : "Av"} />
        <StatusTile label={status?.conditions.provider.companyKey ? "Företagets egen AI-nyckel" : "AI-modellen på servern"} ok={modelOn} text={status ? (modelOn ? "Påslagen" : "Inte påslagen än") : "…"} hint={modelOn ? undefined : status?.conditions.provider.reason} />
        {quota ? <StatusTile label="Veckans kvot" ok={!quota.warn} text={quota.full ? "Slut – öppnar måndag 00:00" : `${quota.usedPercent} % använd`} /> : null}
      </div>

      <Panel icon={Sparkles} title="Använd Workflow AI" description="När det är av skickas inget till AI-modellen. Chatten svarar ändå på enkla frågor om Workflow.">
        <div className="divide-y">
          <SwitchRow id="ai-enabled" testId="ai-enabled" title="Slå på Workflow AI för företaget" text={credits ? "Vanliga frågor och förslag ingår i abonnemanget upp till veckans kvot." : "Frågor som kräver tolkning besvaras av AI-modellen."}
            checked={policy.enabled} disabled={locked} onCheckedChange={(on) => void change({ enabled: on, ...(on ? { shareChatContent: true } : {}) })} />
          <SwitchRow id="ai-requireEu" testId="ai-requireEu" title="Uppgifterna måste behandlas inom EU" text="Då används bara AI-modeller i EU. Med egen AI-nyckel gäller bara företagets egen Azure-resurs som du intygat ligger i EU. Finns ingen sådan är AI avstängd."
            checked={Boolean(policy.requireEu)} disabled={locked} onCheckedChange={(on) => void change({ requireEu: on })} />
        </div>
      </Panel>
      <AiProfileChoice key={String(Boolean(policy.requireEu))} requireEu={Boolean(policy.requireEu)} locked={locked} onChoose={(profile) => change({ profile })} />
      {/* Använd företagets egen AI-nyckel (2026-11-27): the admin's own card; it reads the EU choice again when that changes. */}
      {canManage ? <CompanyKeyPanel key={`own-key-${Boolean(policy.requireEu)}`} /> : null}
      {/* Användning (2026-11-21): the one place to follow Workflow AI; ?section=ai-usage leads here from the chat. */}
      {quota || credits ? <div id="ai-usage"><AiUsagePanel /></div> : null}

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
      </AdvancedFold> : null}
      {/* De inbyggda agenterna (2026-11-21): förslagen, Skriv och Granska med AI, importen, dagsammanställningen, maskinanalysen
          och tipsen är agenter som ändras under Agenter, inte fasta brytare här. */}
      <div data-testid="ai-agents-link"><Panel icon={Newspaper} title="Agenter" link description="Förslagen, Skriv med AI, Granska med AI, dagsammanställningen och tipsen i arbetsflödet är agenter. Under Agenter ser du dem, slår av eller på dem och ändrar vad de ska tänka på.">
        <Link href="/?view=agents" className="stretched-link text-sm font-medium text-primary underline-offset-4 hover:underline">Öppna Agenter</Link>
      </Panel></div>

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
    <SwitchRow id="ai-shareMachines" testId="ai-shareMachines" title="Låt AI förklara en observation om en maskin" text="Observationen skickas först när någon trycker på Förklara med AI. Källans namn skickas aldrig."
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
