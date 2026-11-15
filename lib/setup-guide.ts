import { retentionLabel, type HistoryRetentionMonths } from "./workflow/history-retention";
import { moduleInList } from "./workflow/modules";

/**
 * Ställ in Workflow (2026-10-02, polished 2026-10-07): the six steps a new company administrator meets, the
 * choices in the AI step and the three first things to do. Pure rules without React, shared by the guide and its tests.
 * Only the agreements are required; every other step can be skipped and changed later under Inställningar. A member
 * meets the agreements and Visning (plan 1P, 2026-10-11: the display level for the device at hand, saved when the
 * guide closes and changeable at any time under Inställningar). Yrkesprofil (2026-11-01) is one combined step: an admin says
 * what the company works with and chooses an own profile; a member chooses a profile when the admin has chosen none. It can
 * be skipped, and nothing chosen behaves as before. A member with a profile (2026-11-04) also ends on Kom igång, with the
 * profile's first steps: the guide then says what to do next for that work.
 */
export type SetupStepKey = "legal" | "profile" | "display" | "company" | "security" | "ai" | "start";
export type SetupStep = { key: SetupStepKey; label: string; required: boolean; description: string };

export const SETUP_STEPS: readonly SetupStep[] = [
  { key: "legal", label: "Avtal", required: true, description: "Det enda som krävs för att använda Workflow." },
  { key: "profile", label: "Yrkesprofil", required: false, description: "Vad som visas först. Ger inga behörigheter." },
  { key: "display", label: "Visning", required: false, description: "Hur mycket som visas på den här enheten." },
  { key: "company", label: "Företaget", required: false, description: "Namn och kontaktadress i rapporter och utskick." },
  { key: "security", label: "Säkerhet", required: false, description: "Så skyddas företagets uppgifter." },
  { key: "ai", label: "Workflow AI", required: false, description: "Välj om AI får hjälpa till. Du kan ändra det senare." },
  { key: "start", label: "Klart", required: false, description: "Så här börjar du." },
];
export const setupStepsFor = (admin: boolean, askProfile = admin, hasProfile = false): readonly SetupStep[] => admin ? SETUP_STEPS : SETUP_STEPS.filter((step) => step.key === "legal" || step.key === "display" || (askProfile && step.key === "profile") || (hasProfile && step.key === "start"));

/** How a step went: saved (or already in place) or skipped, with one short line about it for the last page. */
export type SetupOutcome = { status: "saved" | "skipped"; summary: string };
export type SetupOutcomes = Partial<Record<SetupStepKey, SetupOutcome>>;
export const SKIPPED_SUMMARY = "Hoppades över";

/** The chip on a step: what is asked of it, or how it went. */
export function setupStepStatus(step: Pick<SetupStep, "required">, outcome?: SetupOutcome): { label: string; tone: "success" | "warning" | "neutral" } {
  if (outcome) return outcome.status === "saved" ? { label: "Klart", tone: "success" } : { label: SKIPPED_SUMMARY, tone: "neutral" };
  return step.required ? { label: "Krävs", tone: "warning" } : { label: "Valfritt", tone: "neutral" };
}

/** The finished steps before the last one, in order, for the recap on the last page. */
export function setupRecap(steps: readonly SetupStep[], outcomes: SetupOutcomes) {
  return steps.filter((step) => step.key !== "start").map((step) => ({ key: step.key, label: step.label, status: outcomes[step.key]?.status ?? "skipped", summary: outcomes[step.key]?.summary ?? SKIPPED_SUMMARY }));
}

/** The line about how long the history is kept, for the Säkerhet step's recap. */
export const retentionSummary = (months: HistoryRetentionMonths) => months === null ? "Historiken raderas bara för hand" : `Historik sparas ${retentionLabel(months)}`;

export type AiPolicy = { enabled: boolean; shareChatContent: boolean; shareWork: boolean; shareCustomers: boolean; shareDocuments: boolean; shareControls: boolean; shareConversationHistory: boolean; dailyDigest: boolean; shareMachines?: boolean; requireEu?: boolean; allowedModules: string[] };
export type AiChoice = "off" | "basic" | "full";
export const AI_CHOICES: readonly { value: AiChoice; title: string; text: string }[] = [
  { value: "off", title: "Av", text: "Inget skickas till AI-modellen. Du kan slå på det när som helst." },
  { value: "basic", title: "På – frågor och arbete", text: "AI får läsa frågor i chatten och företagets uppgifter och projekt." },
  { value: "full", title: "På – även kunder och dokument", text: "AI får dessutom läsa kunder, kontroller och bifogade dokument." },
];
export const aiChoiceTitle = (choice: AiChoice) => AI_CHOICES.find((item) => item.value === choice)?.title ?? "Av";
export const aiChoiceOf = (policy: AiPolicy): AiChoice => !policy.enabled ? "off" : policy.shareCustomers || policy.shareDocuments || policy.shareControls ? "full" : "basic";
export const policyFor = (choice: AiChoice, current: AiPolicy): AiPolicy => choice === "off"
  ? { ...current, enabled: false }
  : { ...current, enabled: true, shareChatContent: true, shareWork: true, ...(choice === "full" ? { shareCustomers: true, shareControls: true, shareDocuments: true } : { shareCustomers: false, shareControls: false, shareDocuments: false }) };

/**
 * The way from a free company in Local to what Workflow sells (2026-11-01): Skapa konto starts in Local while the installation
 * sells Cloud, so the last page says what Local lacks and leads to where Cloud is ordered (Företag, ?view=credits).
 */
export const SETUP_CLOUD_LINK: SetupStartLink = { href: "/?view=credits", title: "Arbeta ihop med serverlagring", text: "Kollegor, offerter, fakturaunderlag och AI kräver Cloud. Filen från Local kan läsas in där." };

/** Välj funktioner (kundresa 2026-11-07, M41): all modules are on from the start; an administrator chooses under Arbetssätt. */
export const SETUP_MODULES_LINK: SetupStartLink = { href: "/?view=company_features", title: "Välj funktioner", text: "Stäng av det företaget inte använder. Inget raderas." };

/** The three first things to do, by what the company stores where. Short titles: they stand side by side on a wide screen. */
export type SetupStartLink = { href: string; title: string; text: string };
const SETUP_INVITE_LINK: SetupStartLink = { href: "/?view=administration", title: "Bjud in kollegor", text: "De börjar utan åtkomst tills du ger dem behörigheter." };
export function setupStartLinks(local: boolean, modules?: readonly string[] | null, profile?: { admin: boolean; steps: readonly SetupStartLink[] }): SetupStartLink[] {
  // The yrkesprofil's first steps (2026-11-04); an admin first sets up the company, so inviting the colleagues stays first there.
  if (!local && profile?.steps.length) return profile.admin ? [SETUP_INVITE_LINK, ...profile.steps.slice(0, 2)] : profile.steps.slice(0, 3);
  // A module the admin just turned off is no first step (0.39.0).
  return local ? [
    { href: "/?view=stats", title: "Skapa din arbetsyta", text: "Allt sparas i en fil på din dator. Välj Skapa ny på Översikten." },
    { href: "/?view=new_task", title: "Kontroll eller arbetsorder", text: "Starta en kontroll eller en arbetsorder när filen är skapad." },
    ...(moduleInList(modules, "customers") ? [{ href: "/?view=customers", title: "Lägg in en kund", text: "Kundregistret sparas i samma fil." }] : []),
  ] : [
    SETUP_INVITE_LINK,
    ...(moduleInList(modules, "projects") ? [{ href: "/?view=new_project", title: "Skapa ett projekt", text: "Ramen för uppgifter, tid och planering." }] : []),
    { href: "/?view=new_task", title: "Kontroll eller arbetsorder", text: "Välj bland Workflows kontroller eller bygg en egen." },
  ];
}
