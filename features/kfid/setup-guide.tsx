"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, Check, FileText, LoaderCircle, Rocket, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LegalDocumentContent } from "@/components/legal-document";
import { cn } from "@/lib/utils";
import { HISTORY_RETENTION_CHOICES, retentionLabel, type HistoryRetentionMonths } from "@/lib/workflow/history-retention";
import { Field, Panel } from "./ui";
import { api, action } from "./api";

type LegalDocument = { id: string; type: string; title: string; version: string; content: string; contentHash: string; acceptedAt: string | null; canAccept: boolean; acceptHelp: string | null; required: boolean };
type AiPolicy = { enabled: boolean; shareChatContent: boolean; shareWork: boolean; shareCustomers: boolean; shareControls: boolean; shareDocuments: boolean; shareConversationHistory: boolean; dailyDigest: boolean; allowedModules: string[] };
type AiChoice = "off" | "basic" | "full";

const STEPS = [
  { key: "legal", label: "Avtal", icon: FileText },
  { key: "company", label: "Företaget", icon: Building2 },
  { key: "security", label: "Säkerhet", icon: ShieldCheck },
  { key: "ai", label: "Workflow AI", icon: Sparkles },
  { key: "start", label: "Kom igång", icon: Rocket },
] as const;

const aiChoiceOf = (policy: AiPolicy): AiChoice => !policy.enabled ? "off" : policy.shareCustomers || policy.shareDocuments || policy.shareControls ? "full" : "basic";
const policyFor = (choice: AiChoice, current: AiPolicy): AiPolicy => choice === "off"
  ? { ...current, enabled: false }
  : { ...current, enabled: true, shareChatContent: true, shareWork: true, ...(choice === "full" ? { shareCustomers: true, shareControls: true, shareDocuments: true } : { shareCustomers: false, shareControls: false, shareDocuments: false }) };

/**
 * Kom igång (2026-10-02): the first time a company admin signs in, five steps with a progress line – the
 * agreements as one plain checkbox, the company, security, Workflow AI and where to start. Only the agreements are
 * required; everything else can be skipped and changed later under Inställningar. A member only meets the agreements.
 */
export function SetupGuide({ admin, companyName, contactEmail, aiAvailable, gate, local = false, notify, onLegalAccepted, onClose }: {
  admin: boolean; companyName: string; contactEmail: string; aiAvailable: boolean; gate: boolean; local?: boolean;
  notify: (text: string, error?: boolean) => void; onLegalAccepted: () => Promise<void> | void; onClose: () => Promise<void> | void;
}) {
  const steps = admin ? STEPS : STEPS.slice(0, 1);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const step = steps[index];
  const next = async () => {
    setDone((current) => new Set(current).add(step.key));
    if (index === steps.length - 1) { await onClose(); return; }
    setIndex(index + 1);
  };
  return <div className="mx-auto max-w-3xl space-y-5" data-testid="setup-guide">
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Kom igång</p>
      <h1 className="page-title mt-2">{admin ? "Ställ in Workflow" : "Välkommen till Workflow"}</h1>
      <p className="page-description mt-2">{admin ? "Fem korta steg. Bara avtalet krävs; resten kan du hoppa över och ändra senare under Inställningar." : "Godkänn avtalet så kan du börja."}</p>
    </div>
    {steps.length > 1 ? <ol className="grid grid-cols-5 gap-1" aria-label="Steg i guiden" data-testid="setup-progress">
      {steps.map((item, position) => {
        const complete = done.has(item.key) || position < index;
        const current = position === index;
        return <li key={item.key} className="flex flex-col items-center gap-1.5 text-center">
          <button type="button" disabled={gate && position > 0 || position > index && !complete} onClick={() => setIndex(position)} aria-current={current ? "step" : undefined}
            className={cn("flex size-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors disabled:cursor-default",
              current ? "border-primary bg-primary text-primary-foreground" : complete ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-card text-muted-foreground")}
            aria-label={`Steg ${position + 1}: ${item.label}`}>
            {complete && !current ? <Check className="size-4" /> : position + 1}
          </button>
          <span className={cn("text-[11px] leading-tight sm:text-xs", current ? "font-semibold text-foreground" : "text-muted-foreground", !current && "hidden sm:block")}>{item.label}</span>
        </li>;
      })}
    </ol> : null}
    {step.key === "legal" ? <LegalStep notify={notify} onDone={async () => { await onLegalAccepted(); await next(); }} last={steps.length === 1} />
      : step.key === "company" ? <CompanyStep companyName={companyName} contactEmail={contactEmail} notify={notify} onDone={next} />
      : step.key === "security" ? <SecurityStep notify={notify} onDone={next} />
      : step.key === "ai" ? <AiStep available={aiAvailable} local={local} notify={notify} onDone={next} />
      : <StartStep local={local} onDone={next} />}
    {admin && !gate ? <div className="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}><ArrowLeft />Tillbaka</Button>
      <Button type="button" variant="ghost" onClick={() => void onClose()} data-testid="setup-skip">Hoppa över guiden</Button>
    </div> : null}
  </div>;
}

function StepActions({ busy, onSkip, label = "Spara och fortsätt", disabled = false, onSave }: { busy: boolean; onSkip?: () => void; label?: string; disabled?: boolean; onSave: () => void }) {
  return <div className="mt-5 flex flex-wrap items-center gap-2">
    <Button type="button" className="mobile-form-action" disabled={busy || disabled} onClick={onSave} data-testid="setup-next">{busy ? <LoaderCircle className="animate-spin" /> : null}{label}<ArrowRight /></Button>
    {onSkip ? <Button type="button" variant="outline" className="mobile-form-action" disabled={busy} onClick={onSkip}>Hoppa över</Button> : null}
  </div>;
}

function LegalStep({ notify, onDone, last }: { notify: (text: string, error?: boolean) => void; onDone: () => Promise<void>; last: boolean }) {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void api<{ documents: LegalDocument[] }>("/api/legal").then((result) => setDocuments(result.documents.filter((item) => item.required))).catch(() => setDocuments([])); }, []);
  const pending = documents?.filter((item) => !item.acceptedAt) ?? [];
  const blocked = pending.filter((item) => !item.canAccept);
  const accept = async () => {
    setBusy(true);
    try {
      for (const document of pending.filter((item) => item.canAccept))
        await api("/api/legal", { method: "POST", body: JSON.stringify({ action: "accept", documentId: document.id, contentHash: document.contentHash }) });
      await onDone();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Panel title="Avtal" description="Det enda som krävs för att använda Workflow.">
    {documents === null ? <p className="text-sm text-muted-foreground">Hämtar…</p> : !pending.length ? <>
      <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><Check className="size-4" />Avtalen är godkända.</p>
      <StepActions busy={busy} label={last ? "Klart" : "Fortsätt"} onSave={() => void onDone()} />
    </> : <>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" data-testid="setup-legal-agree">
        <Checkbox className="mt-0.5" checked={agreed} onCheckedChange={(value) => setAgreed(value === true)} />
        <span>Jag har läst och godkänner {pending.map((item, position) => <span key={item.id}>{position ? (position === pending.length - 1 ? " och " : ", ") : ""}<button type="button" className="font-medium text-primary underline underline-offset-4" onClick={(event) => { event.preventDefault(); setOpen(open === item.id ? null : item.id); }}>{item.title.toLowerCase()}</button></span>)}.</span>
      </label>
      {open ? <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border bg-muted/30 p-4"><LegalDocumentContent content={pending.find((item) => item.id === open)?.content ?? ""} /></div> : null}
      <p className="mt-2 text-xs text-muted-foreground">Godkännandet sparas mot exakt den version du ser. Avtalen finns kvar under Inställningar → Företag och användare.</p>
      {blocked.length ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{blocked.map((item) => item.acceptHelp || `${item.title} godkänns av företagets administratör.`).join(" ")}</p> : null}
      <StepActions busy={busy} label={last ? "Godkänn" : "Godkänn och fortsätt"} disabled={!agreed || pending.length === blocked.length} onSave={() => void accept()} />
    </>}
  </Panel>;
}

function CompanyStep({ companyName, contactEmail, notify, onDone }: { companyName: string; contactEmail: string; notify: (text: string, error?: boolean) => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState(companyName);
  const [email, setEmail] = useState(contactEmail);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await action({ action: "settings", data: { companyName: name.trim(), contactEmail: email.trim(), suggestions: {} } }); await onDone(); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Panel title="Företaget" description="Namnet och kontaktadressen som står i rapporter och utskick.">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="setup-company-name" label="Företagets namn" value={name} onChange={setName} required />
      <Field id="setup-contact-email" label="Kontakt-e-post" type="email" value={email} onChange={setEmail} />
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Logotyp och rapportfärger väljer du senare under Inställningar → Rapporter och logotyp.</p>
    <StepActions busy={busy} disabled={!name.trim()} onSave={() => void save()} onSkip={() => void onDone()} />
  </Panel>;
}

function SecurityStep({ notify, onDone }: { notify: (text: string, error?: boolean) => void; onDone: () => Promise<void> }) {
  const [months, setMonths] = useState<HistoryRetentionMonths | undefined>(undefined);
  // A Local company keeps its history in its own file: there is no retention to choose here.
  const [retention, setRetention] = useState<"loading" | "available" | "none">("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ months: HistoryRetentionMonths }>("/api/history-retention").then((result) => { setMonths(result.months); setRetention("available"); }).catch(() => setRetention("none")); }, []);
  const save = async () => {
    if (retention !== "available") { await onDone(); return; }
    setBusy(true);
    try { await api("/api/history-retention", { method: "POST", body: JSON.stringify({ action: "retention", months: months ?? null }) }); await onDone(); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Panel title="Säkerhet" description="Så skyddas företagets uppgifter. Det här gäller alltid.">
    <ul className="space-y-2 text-sm">
      {["Nya medlemmar börjar utan åtkomst. Du ger rättigheter under Inställningar → Företag och användare.",
        "Varje person ser bara det hen har rätt till, och servern kontrollerar det vid varje anrop.",
        "Byts ett lösenord loggas alla gamla inloggningar ut.",
        "Företagets uppgifter är skilda från alla andra företags."].map((text) => <li key={text} className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />{text}</li>)}
    </ul>
    {retention === "available" ? <div className="mt-4 max-w-sm">
      <Field id="setup-retention" label="Hur länge historiken sparas" value={String(months)} onChange={(value) => setMonths(value === "null" ? null : Number(value) as HistoryRetentionMonths)}
        options={HISTORY_RETENTION_CHOICES.map(String)} optionLabels={Object.fromEntries(HISTORY_RETENTION_CHOICES.map((choice) => [String(choice), retentionLabel(choice)]))} />
      <p className="mt-1 text-xs text-muted-foreground">Avtal, godkännanden, fakturor och krediter raderas aldrig.</p>
    </div> : null}
    <StepActions busy={busy} disabled={retention === "loading"} onSave={() => void save()} onSkip={() => void onDone()} />
  </Panel>;
}

function AiStep({ available, local = false, notify, onDone }: { available: boolean; local?: boolean; notify: (text: string, error?: boolean) => void; onDone: () => Promise<void> }) {
  const [policy, setPolicy] = useState<AiPolicy | null>(null);
  const [choice, setChoice] = useState<AiChoice>("off");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const result = await api<{ policy: AiPolicy }>("/api/ai/policy"); setPolicy(result.policy); setChoice(aiChoiceOf(result.policy)); } catch { setPolicy(null); }
  }, []);
  useEffect(() => { if (available) void load(); }, [available, load]);
  if (!available) return <Panel title="Workflow AI" description={local ? "Workflow AI ingår i Cloud." : "AI finns inte i den här installationen."}><p className="text-sm text-muted-foreground">{local ? "Ditt företag sparar allt i en egen fil, så inget skickas till någon AI. Vill du ha AI och dela arbetet med kollegor senare väljer du Cloud." : "De direkta svaren ur Workflow fungerar ändå och kostar inget."}</p><StepActions busy={false} label="Fortsätt" onSave={() => void onDone()} /></Panel>;
  const save = async () => {
    if (!policy) { await onDone(); return; }
    setBusy(true);
    try { await api("/api/ai/policy", { method: "POST", body: JSON.stringify(policyFor(choice, policy)) }); await onDone(); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const options: { value: AiChoice; title: string; text: string }[] = [
    { value: "off", title: "Av", text: "Inget skickas till AI-modellen. Du kan slå på det när som helst." },
    { value: "basic", title: "På – frågor och arbete", text: "AI får läsa frågor i chatten och företagets uppgifter och projekt." },
    { value: "full", title: "På – även kunder, kontroller och dokument", text: "AI får dessutom läsa kunder, kontroller och bifogade dokument." },
  ];
  return <Panel title="Workflow AI" description="Bestäm om AI ska få hjälpa till. Du kan ändra det under Inställningar → Workflow AI.">
    <div className="grid gap-2" role="radiogroup" aria-label="Workflow AI">
      {options.map((option) => <label key={option.value} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 text-sm", choice === option.value && "border-primary bg-secondary/50")}>
        <input type="radio" name="setup-ai" className="mt-1" checked={choice === option.value} onChange={() => setChoice(option.value)} />
        <span><span className="block font-medium">{option.title}</span><span className="block text-xs text-muted-foreground">{option.text}</span></span>
      </label>)}
    </div>
    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
      <li>Namn, adresser och kontaktuppgifter byts mot platshållare innan något lämnar Workflow.</li>
      <li>AI föreslår bara; inget skapas eller ändras förrän en person bekräftar.</li>
      <li>AI-svar kostar krediter. De direkta svaren ur Workflow är alltid gratis.</li>
    </ul>
    <StepActions busy={busy} disabled={!policy} onSave={() => void save()} onSkip={() => void onDone()} />
  </Panel>;
}

function StartStep({ local = false, onDone }: { local?: boolean; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const links = local ? [
    { href: "/?view=stats", title: "Skapa din arbetsyta", text: "Workflow sparar i en fil på din dator. Välj Skapa ny (eller en mapp) på Översikten." },
    { href: "/?view=new_task", title: "Gör en kontroll eller arbetsorder", text: "Välj bland HINTEK:s kontroller när arbetsytan är öppen." },
    { href: "/?view=customers", title: "Lägg in en kund", text: "Kundregistret sparas i samma fil." },
  ] : [
    { href: "/?view=administration", title: "Bjud in kollegor", text: "Under Företag och användare. De börjar utan åtkomst tills du ger dem rättigheter." },
    { href: "/?view=new_project", title: "Skapa ett projekt", text: "Projektet är ramen för uppgifter, tid och planering." },
    { href: "/?view=new_task", title: "Gör en kontroll eller arbetsorder", text: "Välj bland HINTEK:s kontroller eller bygg en egen." },
  ];
  return <Panel title="Kom igång" description="Klart! Här är tre bra första steg.">
    <ul className="grid gap-2 sm:grid-cols-3">
      {links.map((link) => <li key={link.href}><Link href={link.href} className="workflow-card tap-card block h-full p-3.5"><span className="flex items-center justify-between gap-2 font-medium">{link.title}<ArrowRight className="size-4 shrink-0 text-primary" /></span><span className="mt-1 block text-xs text-muted-foreground">{link.text}</span></Link></li>)}
    </ul>
    <StepActions busy={busy} label="Klar" onSave={() => { setBusy(true); void onDone().finally(() => setBusy(false)); }} />
  </Panel>;
}
