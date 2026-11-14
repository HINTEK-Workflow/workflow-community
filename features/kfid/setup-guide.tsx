"use client";

import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Building2, Check, ChevronDown, FileText, LoaderCircle, Minus, MonitorSmartphone, Rocket, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceCard } from "@/components/ui/choice-card";
import { LegalDocumentContent } from "@/components/legal-document";
import { cn } from "@/lib/utils";
import { legalVersionLabel } from "@/lib/legal-version";
import { AI_CHOICES, aiChoiceOf, aiChoiceTitle, policyFor, retentionSummary, SETUP_CLOUD_LINK, SETUP_MODULES_LINK, setupRecap, setupStartLinks, setupStepStatus, setupStepsFor, SKIPPED_SUMMARY, type AiChoice, type AiPolicy, type SetupOutcome, type SetupOutcomes, type SetupStep, type SetupStepKey } from "@/lib/setup-guide";
import { choiceHint, choiceLevel, choiceName, DEVICE_LABEL, DEVICE_LEVELS, DEVICE_THIS, type DetailLevel, type DeviceClass } from "@/lib/workflow/detail-level";
import { HISTORY_RETENTION_CHOICES, retentionLabel, type HistoryRetentionMonths } from "@/lib/workflow/history-retention";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import type { MenuAccess } from "@/lib/workflow/menu-items";
import { WORK_AREA_LABEL, WORK_AREAS, WORK_PROFILE, workProfileFirstSteps, type WorkArea, type WorkProfile } from "@/lib/workflow/work-profile";
import { MODULE_KEYS, modulePackageChanges, moduleTitle } from "@/lib/workflow/modules";
import { ModulesContext } from "@/features/workflow/use-modules";
import { workProfileHint, WorkProfileOptions, WorkProfileTitleSearch } from "./work-profile-options";
import { Field, Panel } from "./ui";
import { CompanyDetailsFields, CompanyGapsNote, companyDetailsOf, type CompanyDetailsValue } from "./company-details-form";
import { companyDocumentGaps } from "@/lib/kfid/company";
import { api, action } from "./api";
import { useLoadEffect } from "@/lib/use-load-effect";
import { PageHeader } from "@/components/page-shell";

type LegalDocument = { id: string; type: string; title: string; version: string; content: string; contentHash: string; validFrom: string | null; acceptedAt: string | null; canAccept: boolean; acceptHelp: string | null; required: boolean };
type Done = (outcome: SetupOutcome) => Promise<void>;

const ICONS: Record<SetupStepKey, LucideIcon> = { legal: FileText, profile: BriefcaseBusiness, display: MonitorSmartphone, company: Building2, security: ShieldCheck, ai: Sparkles, start: Rocket };
const SKIPPED: SetupOutcome = { status: "skipped", summary: SKIPPED_SUMMARY };

/**
 * Ställ in Workflow (2026-10-02): the first time a company admin signs in, five steps with a progress line – the
 * agreements as one plain checkbox, the company, security, Workflow AI and where to start. Only the agreements are
 * required; everything else can be skipped and changed later under Inställningar. A member meets the agreements and Visning, and Yrkesprofil when the admin chose none.
 *
 * Polished 2026-10-07 (2026-10-07): a calmer page – the progress line with its connecting line, one step at a
 * time as a panel with its status (Krävs, Valfritt, Klart, Hoppades över), little text, whole rows and cards that can be
 * tapped, and a last page that recaps how each step went. The decisions are the same; the rules are in lib/setup-guide.ts.
 */
export function SetupGuide({ admin, companyName, contactEmail, organizationNumber = "", profile, aiAvailable, gate, local = false, cloudPath = false, askProfile = admin, workProfile = null, workAreas = [], access = null, onModulesSaved, onSaveProfile, display, notify, onLegalAccepted, onClose }: {
  admin: boolean; companyName: string; contactEmail: string; organizationNumber?: string; aiAvailable: boolean; gate: boolean; local?: boolean;
  /** The company's saved Företagsuppgifter, so the Företaget step starts from what Skapa konto already collected. */
  profile?: unknown;
  /** This installation sells Cloud: the last page in Local leads there. */
  cloudPath?: boolean;
  /** Whether the Yrkesprofil step is part of this guide, and the choices it starts from. */
  askProfile?: boolean; workProfile?: WorkProfile | null; workAreas?: readonly WorkArea[];
  /** What the person may use, for the first steps on the last page. */
  access?: MenuAccess | null;
  /** The admin confirmed a package of modules: the menu and Hem come from the server's page, so it is read again. */
  onModulesSaved?: () => void;
  onSaveProfile?: (profile: WorkProfile) => Promise<boolean>;
  /** Visning (plan 1P): the device at hand, its level now, and the save of a new level (applied when the guide closes). */
  display: { device: DeviceClass; level: DetailLevel; save: (level: DetailLevel) => Promise<unknown> };
  notify: (text: string, error?: boolean) => void; onLegalAccepted: () => Promise<void> | void;
  /** The guide is done. `leaving`: a link on its last page is taking the person on, so the page must not choose where to go. */
  onClose: (leaving?: boolean) => Promise<void> | void;
}) {
  // Under the agreements the server sends no preferences, so whether a new member is to choose a profile is known only once they
  // are accepted: the step can then join the list. It never leaves it: a profile chosen on the way must not take its own step away.
  const [profileAsked, setProfileAsked] = useState(askProfile);
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<SetupOutcomes>({});
  const [savedAreas, setSavedAreas] = useState<readonly WorkArea[] | null>(null);
  const steps = setupStepsFor(admin, profileAsked, Boolean(workProfile));
  const step = steps[index];
  if (askProfile && !profileAsked) {
    setProfileAsked(true);
    // The preferences may come after the guide has moved past the agreements: the person goes to the new step, never past it.
    const joined = setupStepsFor(admin, true, Boolean(workProfile));
    setIndex(Math.min(joined.findIndex((item) => item.key === step.key), joined.findIndex((item) => item.key === "profile")));
  }
  /** A step is done: remember how it went and move on; the last step closes the guide. */
  const [chosen, setChosen] = useState<DetailLevel | null>(null);
  const chosenLevel = useRef<DetailLevel | null>(null);
  // The display level chosen on the way takes effect when the guide ends, so the guide itself is not redrawn halfway through.
  const saveChosenLevel = async () => { if (chosenLevel.current !== null && chosenLevel.current !== display.level) await display.save(chosenLevel.current); };
  const finish: Done = async (outcome) => {
    setOutcomes((current) => ({ ...current, [step.key]: outcome }));
    if (index === steps.length - 1) {
      await saveChosenLevel();
      await onClose();
      return;
    }
    setIndex(index + 1);
  };
  /** A link on the last page ends the guide as Klar does, and the link itself decides where the person goes. */
  const leave = async () => { await saveChosenLevel(); await onClose(true); };
  const skip = () => finish(SKIPPED);
  const outcome = outcomes[step.key];
  return <div className="space-y-6" data-testid="setup-guide">
    <PageHeader title="Ställ in Workflow" description={admin ? "Bara avtalet krävs. Resten kan du hoppa över och ändra senare under Inställningar." : "Godkänn avtalet så kan du börja."} />
    {steps.length > 1 ? <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Steg i guiden" data-testid="setup-progress">
      {steps.map((item, position) => {
        const result = outcomes[item.key];
        const current = position === index;
        return <li key={item.key} className="relative" data-state={current ? "current" : result ? result.status : "upcoming"}>
          {/* The line to the next step: behind the circles, which cover its ends. */}
          {position < steps.length - 1 ? <span aria-hidden="true" className={cn("absolute left-1/2 top-6 h-0.5 w-full -translate-y-1/2 max-lg:top-[1.625rem]", result?.status === "saved" ? "bg-emerald-600/70" : "bg-border")} /> : null}
          <button type="button" disabled={(gate && position > 0) || (position > index && !result)} onClick={() => setIndex(position)} aria-current={current ? "step" : undefined}
            aria-label={`Steg ${position + 1}: ${item.label}${result ? ` – ${result.status === "saved" ? "klart" : "hoppades över"}` : ""}`}
            className="relative flex w-full flex-col items-center gap-1.5 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
            <span className={cn("flex size-10 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors max-lg:size-11",
              current ? "border-primary bg-primary text-primary-foreground ring-4 ring-primary/15" : result?.status === "saved" ? "border-emerald-600 bg-emerald-600 text-white" : result ? "border-border bg-muted text-muted-foreground" : "border-border bg-card text-muted-foreground")}>
              {current ? position + 1 : result?.status === "saved" ? <Check className="size-4" /> : result ? <Minus className="size-4" /> : position + 1}
            </span>
            <span className={cn("text-[11px] leading-tight sm:text-xs", current ? "font-semibold text-foreground" : "text-muted-foreground", !current && "max-sm:hidden")}>{item.label}</span>
          </button>
        </li>;
      })}
    </ol> : null}
    {step.key === "legal" ? <LegalStep step={step} outcome={outcome} notify={notify} onDone={async (result) => { await onLegalAccepted(); await finish(result); }} last={steps.length === 1} />
      : step.key === "profile" ? <ProfileStep step={step} outcome={outcome} admin={admin} areas={savedAreas ?? workAreas} current={workProfile} notify={notify} onSave={onSaveProfile} onAreasSaved={setSavedAreas} onModulesSaved={onModulesSaved} onDone={finish} onSkip={skip} />
      : step.key === "display" ? <DisplayStep step={step} outcome={outcome} device={display.device} current={chosen ?? display.level} onDone={(level) => { chosenLevel.current = level; setChosen(level); return finish({ status: "saved", summary: `${DEVICE_LABEL[display.device]}: ${choiceName(display.device, level)}` }); }} onSkip={skip} />
      : step.key === "company" ? <CompanyStep step={step} outcome={outcome} companyName={companyName} contactEmail={contactEmail} organizationNumber={organizationNumber} profile={profile} billing={cloudPath} notify={notify} onDone={finish} onSkip={skip} />
      : step.key === "security" ? <SecurityStep step={step} outcome={outcome} local={local} notify={notify} onDone={finish} onSkip={skip} />
      : step.key === "ai" ? <AiStep step={step} outcome={outcome} available={aiAvailable} local={local} notify={notify} onDone={finish} onSkip={skip} />
      : <StartStep step={step} outcome={outcome} local={local} cloudPath={cloudPath} admin={admin} profile={workProfile} access={access} recap={setupRecap(steps, outcomes)} onLeave={leave} onDone={() => finish({ status: "saved", summary: "" })} />}
    {admin && !gate && index < steps.length - 1 ? <div className="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}><ArrowLeft />Tillbaka</Button>
      <Button type="button" variant="ghost" onClick={() => void onClose()} data-testid="setup-skip">Hoppa över guiden</Button>
    </div> : null}
  </div>;
}

/** One step as a panel: its icon, name and short line, and on the right what it asks of you or how it went. */
function StepPanel({ step, outcome, description, children }: { step: SetupStep; outcome?: SetupOutcome; description?: string; children: ReactNode }) {
  const Icon = ICONS[step.key];
  const status = setupStepStatus(step, outcome);
  // The last page has no status; "Valfritt" is left out on a phone, where the line above already says what is required.
  return <Panel title={step.label} description={description ?? step.description}
    icon={Icon}
    actions={step.key === "start" ? undefined : <Badge variant="outline" className={cn(indicatorBadge(status.tone), status.label === "Valfritt" && "max-sm:hidden")} data-testid="setup-step-status">{status.label}</Badge>}>
    <div data-testid={`setup-step-${step.key}`}>{children}</div>
  </Panel>;
}

function StepActions({ busy, onSkip, label = "Spara och fortsätt", disabled = false, onSave }: { busy: boolean; onSkip?: () => void; label?: string; disabled?: boolean; onSave: () => void }) {
  return <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-5">
    <Button type="button" className="mobile-form-action" disabled={busy || disabled} onClick={onSave} data-testid="setup-next">{busy ? <LoaderCircle className="animate-spin" /> : null}{label}</Button>
    {onSkip ? <Button type="button" variant="outline" className="mobile-form-action" disabled={busy} onClick={onSkip}>Hoppa över</Button> : null}
  </div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-5 text-muted-foreground">{children}</p>;
}

function LegalStep({ step, outcome, notify, onDone, last }: { step: SetupStep; outcome?: SetupOutcome; notify: (text: string, error?: boolean) => void; onDone: Done; last: boolean }) {
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
      await onDone({ status: "saved", summary: "Godkända" });
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  // Agreements already accepted say Klart, not Krävs (kundresa 2026-11-07, L18).
  const accepted = documents !== null && !pending.length;
  return <StepPanel step={step} outcome={outcome ?? (accepted ? { status: "saved", summary: "Godkända" } : undefined)}>
    {documents === null ? <p className="text-sm text-muted-foreground">Hämtar…</p> : !pending.length ? <>
      <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><Check className="size-4" />{documents.length ? "Avtalen är godkända." : "Inga avtal att godkänna."}</p>
      <StepActions busy={busy} label={last ? "Klart" : "Fortsätt"} onSave={() => void onDone({ status: "saved", summary: "Godkända" })} />
    </> : <>
      {/* The documents, one tap away: the version each acceptance is saved against stands under its name. */}
      <ul className="divide-y rounded-lg border" aria-label="Avtal" data-testid="setup-legal-list">
        {pending.map((item) => <li key={item.id}>
          <button type="button" aria-expanded={open === item.id} aria-controls={`setup-doc-${item.id}`} onClick={() => setOpen(open === item.id ? null : item.id)}
            className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{item.title}</span><span className="block text-xs text-muted-foreground" data-testid="legal-version">{legalVersionLabel(item)}</span></span>
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground", open !== item.id && "-rotate-90")} aria-hidden="true" />
          </button>
          {open === item.id ? <div id={`setup-doc-${item.id}`} className="max-h-80 overflow-y-auto border-t bg-muted/30 p-4"><LegalDocumentContent content={item.content} /></div> : null}
        </li>)}
      </ul>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-sm" data-testid="setup-legal-agree">
        <Checkbox className="mt-0.5" checked={agreed} onCheckedChange={(value) => setAgreed(value === true)} />
        <span>Jag har läst och godkänner {pending.length > 1 ? "avtalen" : "avtalet"} ovan.</span>
      </label>
      <Note>Godkännandet sparas mot exakt den version du ser. Avtalen finns kvar under Inställningar.</Note>
      {blocked.length ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{blocked.map((item) => item.acceptHelp || `${item.title} godkänns av företagets administratör.`).join(" ")}</p> : null}
      <StepActions busy={busy} label={last ? "Godkänn" : "Godkänn och fortsätt"} disabled={!agreed || pending.length === blocked.length} onSave={() => void accept()} />
    </>}
  </StepPanel>;
}

/**
 * Yrkesprofil (2026-11-01), one step: an admin says what the company works with (several choices; a company may mix every
 * profile, they are per person) and chooses an own profile, a member only the profile. Nothing chosen is the same as skipping.
 */
function ProfileStep({ step, outcome, admin, areas, current, notify, onSave, onAreasSaved, onModulesSaved, onDone, onSkip }: { step: SetupStep; outcome?: SetupOutcome; admin: boolean; areas: readonly WorkArea[]; current: WorkProfile | null; onModulesSaved?: () => void; notify: (text: string, error?: boolean) => void; onSave?: (profile: WorkProfile) => Promise<boolean>; onAreasSaved: (areas: readonly WorkArea[]) => void; onDone: Done; onSkip: () => Promise<void> }) {
  const [chosenAreas, setChosenAreas] = useState<readonly WorkArea[]>(areas);
  const [profile, setProfile] = useState<WorkProfile | null>(current);
  const [busy, setBusy] = useState(false);
  // Företagets moduler (0.39.0): what the company works with proposes a package, and only the admin's own yes changes any module.
  const proposed = admin ? modulePackageChanges(chosenAreas) : null;
  const [usePackage, setUsePackage] = useState(false);
  const proposedOn = proposed ? MODULE_KEYS.filter((key) => proposed[key]) : [];
  const proposedOff = proposed ? MODULE_KEYS.filter((key) => !proposed[key]) : [];
  const save = async () => {
    setBusy(true);
    try {
      if (admin) { await action({ action: "work_areas", areas: chosenAreas }); onAreasSaved(chosenAreas); }
      if (proposed && usePackage) { await action({ action: "modules", data: proposed }); onModulesSaved?.(); }
      if (profile && profile !== current && onSave && !(await onSave(profile))) return;
      const parts = [profile ? WORK_PROFILE[profile].label : "", admin && chosenAreas.length ? chosenAreas.map((area) => WORK_AREA_LABEL[area]).join(", ") : ""].filter(Boolean);
      if (parts.length) await onDone({ status: "saved", summary: parts.join(" · ") }); else await onSkip();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <StepPanel step={step} outcome={outcome}>
    <div className="space-y-5">
      {admin ? <fieldset className="space-y-2" data-testid="setup-work-areas">
        <legend className="mb-2 text-xs font-medium">Vad arbetar företaget med?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {WORK_AREAS.map((area) => <label key={area} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2 text-sm">
            <Checkbox checked={chosenAreas.includes(area)} onCheckedChange={(value) => setChosenAreas((list) => value === true ? [...list, area] : list.filter((item) => item !== area))} />
            <span className="min-w-0">{WORK_AREA_LABEL[area]}</span>
          </label>)}
        </div>
      </fieldset> : null}
      {proposed ? <div className="space-y-2 rounded-lg border p-3.5 text-sm" data-testid="setup-module-package">
        <p className="text-xs font-medium">Förslag på moduler</p>
        <p data-testid="setup-module-package-on">{proposedOn.map(moduleTitle).join(", ")}</p>
        {proposedOff.length ? <p className="text-xs text-muted-foreground" data-testid="setup-module-package-off">Av: {proposedOff.map(moduleTitle).join(", ")}</p> : null}
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <Checkbox checked={usePackage} onCheckedChange={(value) => setUsePackage(value === true)} data-testid="setup-module-package-confirm" />
          <span className="min-w-0">Använd förslaget</span>
        </label>
        <Note>Väljer du inte förslaget är allt på. Du kan ändra under Inställningar → Arbetssätt, och inget raderas.</Note>
      </div> : null}
      <div className="max-w-sm space-y-2">
        <label htmlFor="setup-work-profile" className="block text-xs font-medium">{admin ? "Din yrkesprofil" : "Yrkesprofil"}</label>
        <WorkProfileTitleSearch onPick={setProfile} />
        <select id="setup-work-profile" className="form-select" data-testid="setup-work-profile" value={profile ?? ""} onChange={(event) => setProfile((event.target.value || null) as WorkProfile | null)}>
          <WorkProfileOptions none="Ingen just nu" areas={chosenAreas} />
        </select>
        {profile ? <Note>{workProfileHint(profile)}</Note> : null}
      </div>
    </div>
    <Note>Profilen väljs per person och låser inget. Den ställer bara in vad som visas först, och du kan byta under Mina inställningar.</Note>
    <StepActions busy={busy} onSave={() => void save()} onSkip={() => void onSkip()} />
  </StepPanel>;
}

function CompanyStep({ step, outcome, companyName, contactEmail, organizationNumber, profile, billing, notify, onDone, onSkip }: { step: SetupStep; outcome?: SetupOutcome; companyName: string; contactEmail: string; organizationNumber: string; profile?: unknown; billing: boolean; notify: (text: string, error?: boolean) => void; onDone: Done; onSkip: () => Promise<void> }) {
  // The shared Företagsuppgifter fields (2026-11-04): what Skapa konto left out – address, säte, bankgiro or plusgiro, VAT
  // number and F-skatt – is asked here, after the first sign-in. The number fetches name and address from SCB, the street searches
  // Lantmäteriet where the installation offers it; the step can be skipped and the gaps then stay shown on the Företag page.
  const [value, setValue] = useState<CompanyDetailsValue>(() => { const saved = companyDetailsOf(companyName, profile); return { ...saved, organizationNumber: saved.organizationNumber || organizationNumber, email: saved.email || contactEmail }; });
  const [busy, setBusy] = useState(false);
  const gaps = companyDocumentGaps({ ...(profile && typeof profile === "object" ? profile : {}), ...value });
  const save = async () => {
    setBusy(true);
    try {
      await action({ action: "settings", data: {
        companyName: value.name.trim(), contactEmail: value.email.trim(), companyType: value.companyType, organizationNumber: value.organizationNumber.trim(), address: value.address.trim(), postalCode: value.postalCode.trim(), city: value.city.trim(),
        vatNumber: value.vatNumber.trim(), fSkatt: value.fSkatt, contactName: value.contactName.trim(), phone: value.phone.trim(), ...(billing ? { billingEmail: value.billingEmail.trim() } : {}),
        registeredOffice: value.registeredOffice.trim(), bankgiro: value.bankgiro.trim(), plusgiro: value.plusgiro.trim(), suggestions: {},
      } });
      await onDone({ status: "saved", summary: value.name.trim() });
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <StepPanel step={step} outcome={outcome}>
    <CompanyDetailsFields idPrefix="setup" value={value} onChange={setValue} billingEmail={billing} />
    <CompanyGapsNote gaps={gaps} testId="setup-company-gaps" className="mt-4" />
    <Note>Logotyp och rapportfärger väljer du senare under Inställningar → Företag.</Note>
    <StepActions busy={busy} disabled={!value.name.trim()} onSave={() => void save()} onSkip={() => void onSkip()} />
  </StepPanel>;
}
const SAFETY_FACTS = [
  "Nya medlemmar börjar utan åtkomst. Ge rättigheter under Användare.",
  "Varje person ser bara det hen har rätt till, kontrollerat på servern.",
  "Byts ett lösenord loggas alla gamla inloggningar ut.",
  "Företagets uppgifter är skilda från alla andra företags.",
];
/** Local (kundresa 2026-11-07, L21): the work is in a file on the computer, so the Cloud lines do not hold there. */
const LOCAL_SAFETY_FACTS = [
  "Arbetsytan sparas i en fil på din dator, inte på servern.",
  "Ta en kopia av filen ibland, till exempel på ett USB-minne.",
  "Byts ett lösenord loggas alla gamla inloggningar ut.",
];

function SecurityStep({ step, outcome, local = false, notify, onDone, onSkip }: { step: SetupStep; outcome?: SetupOutcome; local?: boolean; notify: (text: string, error?: boolean) => void; onDone: Done; onSkip: () => Promise<void> }) {
  const [months, setMonths] = useState<HistoryRetentionMonths | undefined>(undefined);
  // A Local company keeps its history in its own file: there is no retention to choose here.
  const [retention, setRetention] = useState<"loading" | "available" | "none">("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ months: HistoryRetentionMonths }>("/api/history-retention").then((result) => { setMonths(result.months); setRetention("available"); }).catch(() => setRetention("none")); }, []);
  const save = async () => {
    if (retention !== "available") { await onDone({ status: "saved", summary: "Gäller alltid" }); return; }
    setBusy(true);
    try { await api("/api/history-retention", { method: "POST", body: JSON.stringify({ action: "retention", months: months ?? null }) }); await onDone({ status: "saved", summary: retentionSummary(months ?? null) }); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <StepPanel step={step} outcome={outcome}>
    <ul className="space-y-2.5 text-sm">
      {(local ? LOCAL_SAFETY_FACTS : SAFETY_FACTS).map((text) => <li key={text} className="flex gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />{text}</li>)}
    </ul>
    {retention === "available" ? <div className="mt-5 border-t pt-5">
      <div className="max-w-sm">
        <Field id="setup-retention" label="Hur länge historiken sparas" value={String(months)} onChange={(value) => setMonths(value === "null" ? null : Number(value) as HistoryRetentionMonths)}
          options={HISTORY_RETENTION_CHOICES.map(String)} optionLabels={Object.fromEntries(HISTORY_RETENTION_CHOICES.map((choice) => [String(choice), retentionLabel(choice)]))} />
        <Note>Avtal, godkännanden, fakturor och krediter raderas aldrig.</Note>
      </div>
    </div> : null}
    <StepActions busy={busy} disabled={retention === "loading"} onSave={() => void save()} onSkip={() => void onSkip()} />
  </StepPanel>;
}

/** Visning (plan 1P): Enkel – app, Lagom or Allt for the device at hand; the first choice is the one for its width. */
function DisplayStep({ step, outcome, device, current, onDone, onSkip }: { step: SetupStep; outcome?: SetupOutcome; device: DeviceClass; current: DetailLevel; onDone: (level: DetailLevel) => Promise<void>; onSkip: () => Promise<void> }) {
  // A phone offers the app with Visa allt off or on (A2); a saved 2 there reads as on.
  const start = choiceLevel(device, current);
  const [level, setLevel] = useState<DetailLevel>(start);
  const [busy, setBusy] = useState(false);
  return <StepPanel step={step} outcome={outcome} description={`Hur mycket som visas på ${DEVICE_THIS[device]}.`}>
    <div className="grid gap-2.5" role="radiogroup" aria-label="Visning" data-testid="setup-display-choices">
      {DEVICE_LEVELS[device].map((option) => <ChoiceCard key={option} name="setup-display" value={String(option)} checked={level === option} onChange={() => setLevel(option)}
        title={device === "phone" ? choiceName(device, option) : `${option} · ${choiceName(device, option)}`} description={choiceHint(device, option)} badge={start === option && option === level ? "Förval" : undefined} />)}
    </div>
    <Note>Du kan byta när som helst under Inställningar → Mina inställningar.</Note>
    <StepActions busy={busy} onSave={() => { setBusy(true); void onDone(level).finally(() => setBusy(false)); }} onSkip={() => void onSkip()} />
  </StepPanel>;
}

function AiStep({ step, outcome, available, local = false, notify, onDone, onSkip }: { step: SetupStep; outcome?: SetupOutcome; available: boolean; local?: boolean; notify: (text: string, error?: boolean) => void; onDone: Done; onSkip: () => Promise<void> }) {
  const [policy, setPolicy] = useState<AiPolicy | null>(null);
  const [choice, setChoice] = useState<AiChoice>("off");
  const [requireEu, setRequireEu] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const result = await api<{ policy: AiPolicy }>("/api/ai/policy"); setPolicy(result.policy); setChoice(aiChoiceOf(result.policy)); setRequireEu(Boolean(result.policy.requireEu)); } catch { setPolicy(null); }
  }, []);
  useLoadEffect(load, available);
  if (!available) return <StepPanel step={step} outcome={outcome} description={local ? "Workflow AI ingår med serverlagring." : "AI finns inte i den här installationen."}>
    <p className="text-sm text-muted-foreground">{local ? "Allt sparas i en egen fil och inget skickas till AI. Vill du ha AI senare väljer du Cloud." : "De direkta svaren ur Workflow fungerar ändå och kostar inget."}</p>
    <StepActions busy={false} label="Fortsätt" onSave={() => void onDone({ status: "skipped", summary: local ? "Finns med serverlagring" : "Inte tillgänglig" })} />
  </StepPanel>;
  const save = async () => {
    if (!policy) { await onDone({ status: "saved", summary: aiChoiceTitle(choice) }); return; }
    setBusy(true);
    try { await api("/api/ai/policy", { method: "POST", body: JSON.stringify({ ...policyFor(choice, policy), requireEu }) }); await onDone({ status: "saved", summary: aiChoiceTitle(choice) }); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <StepPanel step={step} outcome={outcome}>
    <div className="grid gap-2.5" role="radiogroup" aria-label="Workflow AI">
      {AI_CHOICES.map((option) => <ChoiceCard key={option.value} name="setup-ai" value={option.value} checked={choice === option.value} onChange={() => setChoice(option.value)} title={option.title} description={option.text} />)}
    </div>
    {choice !== "off" ? <div className="mt-4" data-testid="setup-ai-eu">
      <p className="mb-2 text-sm font-medium">Måste datan bearbetas inom EU?</p>
      <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Behandling inom EU">
        <ChoiceCard name="setup-ai-eu" value="no" checked={!requireEu} onChange={() => setRequireEu(false)} title="Nej" description="AI får användas via OpenAI. Det räknas inte som behandling i EU." />
        <ChoiceCard name="setup-ai-eu" value="yes" checked={requireEu} onChange={() => setRequireEu(true)} title="Ja" description="AI körs bara via Azure, med behandling i EU. Är Azure inte klar är AI avstängd." />
      </div>
    </div> : null}
    <ul className="mt-4 space-y-1 text-xs leading-5 text-muted-foreground">
      <li>Namn, adresser och kontaktuppgifter byts mot platshållare innan något lämnar Workflow.</li>
      <li>AI föreslår bara; inget skapas eller ändras förrän en person bekräftar.</li>
      <li>AI-svar kostar krediter. De direkta svaren ur Workflow är alltid gratis.</li>
    </ul>
    <StepActions busy={busy} disabled={!policy} onSave={() => void save()} onSkip={() => void onSkip()} />
  </StepPanel>;
}

function StartStep({ step, outcome, local = false, cloudPath = false, admin = true, profile = null, access = null, recap, onLeave, onDone }: { step: SetupStep; outcome?: SetupOutcome; local?: boolean; cloudPath?: boolean; admin?: boolean; profile?: WorkProfile | null; access?: MenuAccess | null; recap: ReturnType<typeof setupRecap>; onLeave: () => Promise<void>; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const modules = useContext(ModulesContext);
  const firstSteps = workProfileFirstSteps(profile, access ? { ...access, modules } : null);
  const links = setupStartLinks(local, modules, { admin, steps: firstSteps });
  // A new member starts without rights until the admin gives them: then there is no page to send the person to yet.
  const waiting = !admin && !firstSteps.length;
  return <StepPanel step={step} outcome={outcome}>
    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Det här är inställt</p>
    <ul className="mt-2 divide-y rounded-lg border text-sm" aria-label="Det här är inställt" data-testid="setup-recap">
      {recap.map((item) => <li key={item.key} className="flex items-center gap-3 px-3.5 py-2.5" data-status={item.status}>
        <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", item.status === "saved" ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground")} aria-hidden="true">{item.status === "saved" ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}</span>
        <span className="w-24 shrink-0 font-medium">{item.label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={item.summary}>{item.summary}</span>
      </li>)}
    </ul>
    <p className="mt-6 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{profile ? `Börja här som ${WORK_PROFILE[profile].label}` : "Börja här"}</p>
    {waiting ? <p className="mt-2 text-sm" data-testid="setup-start-waiting">Administratören ger dig rättigheter. Sedan står dina jobb här.</p> : null}
    {/* Short titles: three side by side from a wide screen, otherwise one under the other – a title never breaks. */}
    {waiting ? null : <ul className="mt-2 grid gap-3 xl:grid-cols-3" data-testid="setup-start-links">
      {links.map((link) => <li key={link.href + link.title}><Link href={link.href} onClick={() => void onLeave()} className="workflow-card tap-card block h-full p-3.5">
        <span className="flex items-center justify-between gap-2 text-sm font-medium"><span className="min-w-0 truncate" title={link.title} data-card-title="">{link.title}</span><ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" /></span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{link.text}</span>
      </Link></li>)}
    </ul>}
    {profile ? <Note>Profilen ställer bara in vad som visas först. Allt annat finns kvar, och du ändrar det under Inställningar → Mina inställningar.</Note> : null}
    {/* Moduler (kundresa 2026-11-07, M41): everything is on from the start; the last page leads to where functions are chosen. */}
    {admin && !local ? <Link href={SETUP_MODULES_LINK.href} onClick={() => void onLeave()} className="workflow-card tap-card mt-3 block p-3.5" data-testid="setup-modules-link">
      <span className="flex items-center justify-between gap-2 text-sm font-medium"><span className="min-w-0 truncate" title={SETUP_MODULES_LINK.title} data-card-title="">{SETUP_MODULES_LINK.title}</span><ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" /></span>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{SETUP_MODULES_LINK.text}</span>
    </Link> : null}
    {local && cloudPath ? <Link href={SETUP_CLOUD_LINK.href} onClick={() => void onLeave()} className="workflow-card tap-card mt-3 block p-3.5" data-testid="setup-cloud-link">
      <span className="flex items-center justify-between gap-2 text-sm font-medium"><span className="min-w-0 truncate" title={SETUP_CLOUD_LINK.title} data-card-title="">{SETUP_CLOUD_LINK.title}</span><ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" /></span>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{SETUP_CLOUD_LINK.text}</span>
    </Link> : null}
    <StepActions busy={busy} label="Klar" onSave={() => { setBusy(true); void onDone().finally(() => setBusy(false)); }} />
  </StepPanel>;
}
