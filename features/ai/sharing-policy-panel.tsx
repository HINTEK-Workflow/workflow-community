"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check, LoaderCircle, Save, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";

type Policy = {
  enabled: boolean;
  shareChatContent: boolean;
  shareWork: boolean;
  shareCustomers: boolean;
  shareControls: boolean;
  shareDocuments: boolean;
  shareConversationHistory: boolean;
  dailyDigest?: boolean;
  allowedModules: "KFID"[];
};
type ShareKey = "shareChatContent" | "shareWork" | "shareCustomers" | "shareDocuments" | "shareConversationHistory";
type Status = { conditions: { provider: { ready: boolean; reason?: string }; availableCredits: { available: boolean; balance: number } } };

// What AI may read, at Workflow's level rather than per task type (2026-10-01: Workflow began as Kontroll före
// idrifttagning and now has many kinds of tasks). Each choice governs its own sources on the server.
const reads: { key: ShareKey; title: string; help: string; uses: string }[] = [
  { key: "shareChatContent", title: "Frågor i chatten", help: "Krävs för att en fråga ska kunna skickas till AI-modellen. Utan det svarar Workflow AI bara direkt ur Workflow.", uses: "Chatten" },
  { key: "shareWork", title: "Uppgifter och projekt", help: "Alla uppgiftstyper – arbetsordrar, riskbedömningar, kontroller och protokoll – och projekt: rubrik, status, datum och antal för den som frågar.", uses: "Chatten · tips · förslag · granskning" },
  { key: "shareCustomers", title: "Kunder och anläggningar", help: "Kunder och deras anläggningar som sökningen hittar för den som frågar, som källor till svaret.", uses: "Chatten" },
  { key: "shareDocuments", title: "Dokument och bilagor", help: "Filnamn i sökningen, och innehållet i en fil som någon själv väljer att låta AI analysera på sidan Import.", uses: "Chatten · import" },
  { key: "shareConversationHistory", title: "Tidigare frågor i samma konversation", help: "Gör att följdfrågor förstås. Bara personens egen konversation, aldrig andras.", uses: "Chatten" },
];

/**
 * Workflow AI – vad AI får göra (2026-10-01: "sidan där användaren anger vad AI:n får göra går inte att hitta"):
 * a tab of its own under Mitt företag, linked from the assistant's settings and from every answer that needs it.
 * The company admin chooses what may leave Workflow; everyone else reads what applies. Every choice is checked again on
 * the server at each call, and names, places and addresses are always sent as aliases.
 */
export function AiSharingPolicyPanel() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [saved, setSaved] = useState<Policy | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/policy", { cache: "no-store" });
      if (!response.ok) throw new Error("AI-inställningarna kunde inte hämtas.");
      const data = await response.json() as { policy: Policy; canManage: boolean };
      const loaded = { ...data.policy, shareWork: data.policy.shareWork || (data.policy.shareControls && data.policy.allowedModules.includes("KFID")) };
      setPolicy(loaded); setSaved(loaded); setCanManage(data.canManage);
      const statusResponse = await fetch("/api/ai/status", { cache: "no-store" });
      if (statusResponse.ok) setStatus(await statusResponse.json() as Status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI-inställningarna kunde inte hämtas.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!policy || !canManage) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai/policy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...policy, shareControls: policy.shareWork, allowedModules: policy.shareWork ? ["KFID"] : [] }) });
      const data = await response.json() as { policy?: Policy; error?: string };
      if (!response.ok || !data.policy) throw new Error(data.error || "AI-inställningarna kunde inte sparas.");
      const stored = { ...data.policy, shareWork: data.policy.shareWork || (data.policy.shareControls && data.policy.allowedModules.includes("KFID")) };
      setPolicy(stored); setSaved(stored);
      setNotice("Valen är sparade och loggade i administrationshistoriken.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI-inställningarna kunde inte sparas.");
    } finally { setBusy(false); }
  }

  const set = (next: Partial<Policy>) => setPolicy((current) => current ? { ...current, ...next } : current);
  const changed = JSON.stringify(policy) !== JSON.stringify(saved);
  const modelOn = Boolean(status?.conditions.provider.ready);
  return <div className="space-y-6" data-testid="ai-permissions">
    <div>
      <h1 className="page-title">Workflow AI</h1>
      <p className="page-description mt-2">Vad AI får läsa och göra i företaget. {canManage ? "Du är företagsadmin och bestämmer valen." : "Företagets admin bestämmer valen; här ser du vad som gäller."}</p>
    </div>
    {!policy ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" /> Hämtar AI-inställningar…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="ai-permissions-status">
        <StatusTile label="Direkta svar ur Workflow" ok text="Alltid på – kostar inget" />
        <StatusTile label="Företagets AI" ok={policy.enabled && policy.shareChatContent} text={saved?.enabled && saved.shareChatContent ? "På" : "Av"} />
        <StatusTile label="AI-modellen på servern" ok={modelOn} text={status ? (modelOn ? "Påslagen" : "Inte påslagen än") : "…"} hint={modelOn ? undefined : status?.conditions.provider.reason} />
        <StatusTile label="AI-krediter" ok={Boolean(status?.conditions.availableCredits.available)} text={status ? (status.conditions.availableCredits.available ? `${status.conditions.availableCredits.balance} kvar` : "Saknas – AI svarar inte") : "…"} />
      </div>

      <Panel title="Använd Workflow AI" description="Huvudbrytaren. Av betyder att inget skickas till AI-modellen; de direkta svaren ur Workflow fungerar ändå.">
        <label className="flex items-start gap-3 rounded-xl border p-4">
          <Checkbox checked={policy.enabled} disabled={!canManage || busy} onCheckedChange={(checked) => set({ enabled: checked === true, ...(checked === true ? { shareChatContent: true } : {}) })} data-testid="ai-enabled" />
          <span><span className="block text-sm font-medium">Slå på Workflow AI för företaget</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Frågor som kräver tolkning, sammanfattning eller analys besvaras då av AI-modellen och dras från företagets krediter. Kostnaden visas efter varje svar.</span></span>
        </label>
      </Panel>

      <Panel title="Vad AI får läsa" description="Varje del är ett eget val. Servern kontrollerar valen vid varje anrop, och AI får bara det den som frågar själv har behörighet att se.">
        <div className="grid gap-3 md:grid-cols-2">
          {reads.map((item) => <label key={item.key} className={cn("flex items-start gap-3 rounded-xl border p-4", !policy.enabled && "opacity-70", item.key === "shareChatContent" && "md:col-span-2")}>
            <Checkbox checked={policy[item.key]} disabled={!canManage || busy} data-testid={`ai-${item.key}`} onCheckedChange={(checked) => set({ [item.key]: checked === true })} />
            <span><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{item.title}<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{item.uses}</span></span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.help}</span></span>
          </label>)}
        </div>
      </Panel>

      <Panel title="Dagsammanställning" description="Det enda Workflow AI gör utan att någon använder Workflow.">
        <label className={cn("flex items-start gap-3 rounded-xl border p-4", (!policy.enabled || !policy.shareWork) && "opacity-70")}>
          <Checkbox checked={Boolean(policy.dailyDigest)} disabled={!canManage || busy || !policy.enabled || !policy.shareWork} data-testid="ai-dailyDigest" onCheckedChange={(checked) => set({ dailyDigest: checked === true })} />
          <span><span className="text-sm font-medium">Skriv en kort sammanställning av dagen varje natt</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Visas för teamet på Översikt nästa morgon: vad som blev klart, vad som pågår, vad som är försenat och hur projekten ligger till – antal och projektnamn, aldrig personer. Skrivs bara de dagar företaget har haft aktivitet och kostar då krediter som ett AI-svar. Kräver Uppgifter och projekt.</span></span>
        </label>
      </Panel>

      <Panel title="Vad AI gör – och aldrig gör" description="Detta gäller alltid och kan inte ändras.">
        <div className="grid gap-4 md:grid-cols-2">
          <ul className="space-y-2 text-sm">
            <Rule ok text="Svarar på frågor i Workflow AI-chatten." />
            <Rule ok text="Analyserar en fil på sidan Import, när personen själv bockar i AI-analys." />
            <Rule ok text="Resonerar kring nästa steg när någon trycker Fråga Workflow AI på ett tips i arbetsflödet." />
            <Rule ok text="Föreslår sammanfattning, arbetsorder, skyddsåtgärder och planering när någon ber om det. Inget skapas förrän personen har bekräftat, och det går att ångra." />
            <Rule ok text="Granskar ett sparat protokoll när någon trycker Granska med AI, och pekar på det som bör kontrolleras." />
            <Rule ok text="Tipsen under progressionslinjen bygger på regler i Workflow och använder ingen AI." />
          </ul>
          <ul className="space-y-2 text-sm">
            <Rule text="Skapar, ändrar, slutför eller signerar aldrig något på egen hand – det gör alltid en person." />
            <Rule text="Avgör aldrig om något är säkert, godkänt eller klart att ta i drift – det gör en behörig person." />
            <Rule text="Arbetar aldrig i bakgrunden, utom dagsammanställningen om företaget har valt den." />
            <Rule text="Ser aldrig hela sidan, bara det servern hämtar inom personens behörighet." />
            <Rule text="Får aldrig ett annat företags uppgifter." />
            <Rule text="Inget sparas hos AI-leverantören efter svaret." />
          </ul>
        </div>
      </Panel>

      <Panel title="Namn ersätts med alias" description="Grunduppgifter skickas aldrig i klartext till AI-modellen.">
        <p className="text-sm leading-6">Innan något lämnar Workflow byts namn på projekt, kunder, personer och anläggningar, adresser, postnummer, e-post, telefon- och personnummer mot platshållare. Svaret byts tillbaka innan det visas, så du läser de riktiga namnen.</p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3" aria-label="Exempel">
          {[["Strömgatan 5, 352 30 Växjö", "[Adress 1], [Postnummer 1]"], ["Elkraft i Småland AB", "[Kund 1]"], ["anna@exempel.se · 070-123 45 67", "[E-post 1] · [Telefon 1]"]].map(([real, alias]) => <div key={real} className="rounded-lg border bg-muted/30 p-2.5"><dt className="text-muted-foreground">{real}</dt><dd className="mt-1 font-mono text-[11px] font-medium">→ {alias}</dd></div>)}
        </dl>
      </Panel>

      <p className="text-xs leading-5 text-muted-foreground">Hur ofta tips visas i arbetsflödet väljer varje person själv under <Link href="/?view=settings" className="text-primary underline">Inställningar</Link>. Minnet för hur svar ska formuleras finns under Inställningar i Workflow AI-panelen.</p>

      {canManage ? <div className="flex flex-wrap items-center gap-3">
        <Button type="button" className="mobile-form-action" disabled={busy || !changed || (policy.enabled && !policy.shareChatContent)} onClick={() => void save()} data-testid="ai-permissions-save">{busy ? <LoaderCircle className="animate-spin" /> : <Save />} Spara valen</Button>
        {policy.enabled && !policy.shareChatContent ? <span className="text-xs text-amber-700 dark:text-amber-300">Frågor i chatten måste vara tillåtna när Workflow AI är på.</span> : changed ? <span className="text-xs text-muted-foreground">Ändringarna är inte sparade.</span> : null}
        {notice ? <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><ShieldCheck className="size-4" />{notice}</p> : null}
      </div> : null}
    </>}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}

function StatusTile({ label, ok, text, hint }: { label: string; ok: boolean; text: string; hint?: string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="size-3.5 text-primary" />{label}</p><p className={cn("mt-1 text-sm font-semibold", ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>{text}</p>{hint ? <p className="mt-1 text-xs text-muted-foreground" data-testid="ai-model-reason">{hint}</p> : null}</div>;
}

function Rule({ ok = false, text }: { ok?: boolean; text: string }) {
  return <li className="flex items-start gap-2"><span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300")}>{ok ? <Check className="size-3" /> : <Ban className="size-3" />}</span>{text}</li>;
}
