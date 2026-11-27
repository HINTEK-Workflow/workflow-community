import { moduleTitle, isModuleKey } from "@/lib/workflow/modules";
import {
  cleanRecipients, EVENT_NEEDS, FEEDBACK_LABEL, MAX_MISSIONS, missionDraftSchema, missionScheduleText, nextMissionRun, NAME_MAX, POST_CHANNEL_LABEL, PUBLISH_LABEL, runTimeText,
  type MissionDraft, type PostChannel,
} from "./model";
import { resolveRecipients, type Colleague, type RecipientChoice } from "./recipients";
import { agentTemplate, costClass } from "./templates";
import { agentToolAllowed, deniedActionsIn, isUndoableTool, READ_TOOLS, toolsForOwner, toolTitle } from "./tool-policy";

/**
 * Kontrollera (2026-11-21: "hur verifierar AI att det kommer vara ok och fungerar?"): the rules every mission passes before
 * it may be saved switched on – from the chat's Auto and from the Agenter page alike, after every edit. No AI and no cost. Each
 * problem names its field and says, in plain Swedish, how to fix it; a mission with a problem cannot be switched on. The facts are
 * read on the server in the owner's own rights (lib/agents/facts-server.ts); this file only judges them.
 */
export type MissionFacts = {
  now: Date;
  /** The company keeps its data on Workflow's server (not in its own .hwf file). */
  server: boolean;
  ownerActive: boolean;
  admin: boolean;
  /** The company's modules that are on. */
  modulesOn: readonly string[];
  /** The owner's rights as "subject:action" (admins have all). */
  rights: readonly string[];
  /** Other missions in the company that are not removed. */
  missionCount: number;
  ai: { ready: boolean; reason: string | null };
  credits: { system: boolean; balance: number };
  connections: Record<PostChannel, { connected: boolean; publishing: boolean; name: string | null }>;
  /** Interna nyheter exists in this build (lib/agents/news-target.ts). */
  news: boolean;
  /** Readable projects and rounds, id → name. */
  projects: Readonly<Record<string, string>>;
  rounds: Readonly<Record<string, string>>;
  /** Fler mottagare: the company's active members with their rights (left out: not known, e.g. the demo), and the owner's id. */
  members?: readonly Colleague[];
  ownerId?: string;
};

/** Kontrollera's plain words when Workflow AI is off (2026-11-23). */
export const AI_OFF_TEXT = "Utan Workflow AI blir det bara en lista, ingen bedömning eller text.";

export type MissionField = "general" | "name" | "instruction" | "schedule" | "scope" | "target" | "channels" | "feedback" | "recipients" | "owner";
export type MissionProblem = { field: MissionField; message: string };
export type MissionCheck = {
  ok: boolean;
  problems: MissionProblem[];
  /** Things to know that do not stop the mission (no credits right now). */
  notes: string[];
  /** What may turn Publicera automatiskt into a draft. */
  cautions: string[];
  nextRunAt: string | null;
  scheduleText: string | null;
  cost: { kind: "rules" | "ai"; text: string };
  /** Så här kommer agenten att arbeta. */
  summary: string[];
  /** The catalog's tools the mission will use (reading and changing), for Kontrollera. */
  tools?: { name: string; title: string; writes: boolean; undoable: boolean }[];
  /** Fler mottagare: who gets the result by e-mail besides the owner, and who is left out and why. */
  recipients?: RecipientChoice;
};

const has = (facts: MissionFacts, right: string) => facts.admin || facts.rights.includes(right);
const RIGHT_TEXT: Record<string, string> = {
  "work-order:read": "läsa arbetsordrar", "work-order:create": "skapa arbetsordrar", "quotes:read": "läsa offerter", "quotes:edit": "redigera offerter",
  "team:read": "se Teamet", "projects:read": "läsa projekt", "invoicing:read": "se fakturor",
};

/**
 * Vid varje körning (säkerhetsgranskningen 2026-11-24, F-06): the template's role and rights checked again against the owner
 * now – centrally, not only when the mission was saved. A reason pauses the mission; null: the owner still may. (A module that
 * is off is each template's own skip, which passes by itself.)
 */
export function ownerStillMeets(template: { needs: { admin?: boolean; rights?: readonly string[] } }, target: { kind: string }, owner: { admin: boolean; rights: readonly string[] }): string | null {
  if ((template.needs.admin || target.kind === "post" || target.kind === "news") && !owner.admin) return "Ägaren är inte längre administratör. Det här uppdraget gäller hela företaget, så en administratör kan ta över det.";
  const right = (template.needs.rights ?? []).find((item) => !owner.admin && !owner.rights.includes(item));
  if (right) return `Ägaren saknar nu behörighet att ${RIGHT_TEXT[right] ?? "läsa underlaget"}.`;
  return null;
}

export function costText(kind: "rules" | "ai", credits: { system: boolean }) {
  if (kind === "rules") return "Ingår. Agenten räknar och listar med Workflows egna regler och kostar inget.";
  return credits.system ? "Drar AI-krediter när Workflow AI skriver texten, oftast 1–3 krediter per körning." : "Workflow AI skriver texten med företagets egen AI-nyckel.";
}

/** Judges a mission (raw input from the page or the chat) against the facts. `creating`: a new mission counts against the limit. */
export function checkMission(raw: unknown, facts: MissionFacts, options: { creating: boolean }): MissionCheck & { draft: MissionDraft | null } {
  const problems: MissionProblem[] = [];
  const notes: string[] = [];
  const cautions: string[] = [];
  const parsed = missionDraftSchema.safeParse(raw);
  const fallbackCost = { kind: "rules" as const, text: costText("rules", facts.credits) };
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = String(issue?.path[0] ?? "general");
    const field: MissionField = (["name", "instruction", "schedule", "scope", "target", "feedback", "recipients"] as const).find((item) => item === path) ?? "general";
    return { ok: false, problems: [{ field, message: issue?.message && !/^Invalid/.test(issue.message) ? issue.message : "Uppgiften stämmer inte. Kontrollera fältet." }], notes, cautions, nextRunAt: null, scheduleText: null, cost: fallbackCost, summary: [], draft: null };
  }
  const recipients = cleanRecipients(parsed.data.recipients);
  const draft: MissionDraft = { ...parsed.data, recipients };
  if (!recipients) delete draft.recipients;
  const template = agentTemplate(draft.templateKey);
  if (!template) return { ok: false, problems: [{ field: "general", message: "Mallen finns inte. Välj en mall eller skriv med egna ord." }], notes, cautions, nextRunAt: null, scheduleText: null, cost: fallbackCost, summary: [], draft };

  if (!facts.server) problems.push({ field: "general", message: "Agenter behöver Workflows server och fungerar inte när företagets uppgifter sparas i en egen fil." });
  if (options.creating && facts.missionCount >= MAX_MISSIONS) problems.push({ field: "general", message: `Företaget har redan ${MAX_MISSIONS} uppdrag, som är det högsta antalet. Ta bort ett uppdrag du inte behöver först.` });
  if (!facts.ownerActive) problems.push({ field: "owner", message: "Ägaren är inte längre aktiv i företaget. En administratör kan ta över uppdraget." });
  if (!draft.name.trim()) problems.push({ field: "name", message: "Ge uppdraget ett namn." });
  else if (draft.name.length > NAME_MAX) problems.push({ field: "name", message: `Namnet får vara högst ${NAME_MAX} tecken.` });
  if (draft.templateKey === "custom" && draft.instruction.trim().length < 10) problems.push({ field: "instruction", message: "Skriv med några ord vad agenten ska göra." });

  // När
  const next = nextMissionRun(draft.schedule, facts.now);
  if (!next && draft.schedule.kind === "once") problems.push({ field: "schedule", message: "Datumet och klockslaget har redan varit, eller ligger mer än ett år fram. Välj en tid som kommer." });
  else if (!next && draft.schedule.kind !== "event") problems.push({ field: "schedule", message: "Schemat ger ingen körning. Välj dag och klockslag." });
  // Fler händelser: the owner must be allowed to read the event's own record, and its part of Workflow must be on.
  if (draft.schedule.kind === "event") {
    const needs = EVENT_NEEDS[draft.schedule.event];
    if (needs?.admin && !facts.admin) problems.push({ field: "schedule", message: "Den här händelsen gäller hela företaget, så ägaren måste vara administratör." });
    for (const key of needs?.modules ?? []) if (isModuleKey(key) && !facts.modulesOn.includes(key)) problems.push({ field: "schedule", message: `${moduleTitle(key)} är avstängt för företaget. Slå på det under Inställningar › Arbetssätt.` });
    for (const right of needs?.rights ?? []) if (!has(facts, right)) problems.push({ field: "schedule", message: `Du saknar behörighet att ${RIGHT_TEXT[right] ?? "läsa det händelsen gäller"}. Be en administratör om behörigheten.` });
  }

  // What no agent ever does (lib/agents/tool-policy.ts): refused with its reason, whatever the words or the tools say.
  for (const denied of deniedActionsIn(`${draft.name} ${draft.instruction}`)) problems.push({ field: "instruction", message: denied.reason });
  const tools = draft.target.tools ?? [];
  for (const tool of tools) { const allowed = agentToolAllowed(tool); if (!allowed.ok) problems.push({ field: "target", message: allowed.reason }); }
  const usable = new Set<string>(toolsForOwner(facts));
  for (const tool of tools.filter((name) => agentToolAllowed(name).ok && !usable.has(name))) problems.push({ field: "target", message: `Du har inte behörighet att ${toolTitle(tool).toLowerCase()}, eller så är den delen av Workflow avstängd.` });
  if (draft.target.kind === "actions" && !tools.length) problems.push({ field: "target", message: "Säg vad agenten ska ändra, till exempel skapa arbetsordrar, sätta ansvarig eller boka." });
  const uses = draft.templateKey === "custom" ? [...READ_TOOLS.filter((name) => usable.has(name)), ...tools] : tools;

  // Vad agenten skapar
  if (!template.targets.includes(draft.target.kind)) problems.push({ field: "target", message: `${template.name} kan inte skapa det. Välj ${template.targets.map((kind) => TARGET_WORD[kind]).join(" eller ")}.` });
  for (const key of template.needs.modules) if (isModuleKey(key) && !facts.modulesOn.includes(key)) problems.push({ field: "target", message: `${moduleTitle(key)} är avstängt för företaget. Slå på det under Inställningar › Arbetssätt.` });
  if (draft.target.kind === "post" && !facts.modulesOn.includes("web_posts")) problems.push({ field: "target", message: "Webb och inlägg är avstängt för företaget. Slå på det under Inställningar › Arbetssätt." });
  const needsAdmin = template.needs.admin || draft.target.kind === "post" || draft.target.kind === "news";
  if (needsAdmin && !facts.admin) problems.push({ field: "owner", message: "Det här uppdraget gäller hela företaget, så ägaren måste vara administratör. Be en administratör skapa det." });
  for (const right of template.needs.rights ?? []) if (!has(facts, right)) problems.push({ field: "scope", message: `Du saknar behörighet att ${RIGHT_TEXT[right] ?? "läsa underlaget"}. Be en administratör om behörigheten.` });
  // Utan Workflow AI (2026-11-23): a report still comes as the rules' list, and Kontrollera says so plainly; a text or a change needs it.
  const listOnly = template.writes === "ai" && !facts.ai.ready && draft.target.kind === "report";
  if (template.writes === "ai" && !facts.ai.ready) {
    notes.push(AI_OFF_TEXT);
    if (!listOnly) problems.push({ field: "general", message: facts.ai.reason ?? "Workflow AI är inte påslaget för företaget. Mallen behöver AI för att skriva texten." });
  }
  if (template.writes === "ai" && facts.ai.ready && facts.credits.system && facts.credits.balance < 1) notes.push("Företaget har inga AI-krediter just nu. Körningen stoppas med ett besked tills det finns krediter.");

  // Underlag
  if (template.needs.round) {
    if (!draft.scope.roundScheduleId) problems.push({ field: "scope", message: "Välj vilken driftrond agenten ska hålla koll på." });
    else if (!facts.rounds[draft.scope.roundScheduleId]) problems.push({ field: "scope", message: "Ronden finns inte längre, eller så får du inte läsa den. Välj en annan rond." });
  }
  const unknownProject = draft.scope.projectIds.find((projectId) => !facts.projects[projectId]);
  if (unknownProject) problems.push({ field: "scope", message: "Ett av projekten finns inte längre, eller så får du inte läsa det. Ta bort det ur underlaget." });

  // Var det publiceras
  if (draft.target.kind === "post") {
    if (draft.target.publish === "auto" && !draft.target.channels.length) problems.push({ field: "channels", message: "Välj var inlägget ska publiceras: Facebook, Instagram eller LinkedIn." });
    for (const channel of draft.target.channels) {
      const connection = facts.connections[channel];
      if (!connection.connected) problems.push({ field: "channels", message: `${POST_CHANNEL_LABEL[channel]} är inte kopplat. Koppla det under Inställningar › Kopplingar › Webb och sociala medier.` });
      else if (draft.target.publish === "auto" && !connection.publishing) problems.push({ field: "channels", message: `Publicering till ${POST_CHANNEL_LABEL[channel]} är avstängd. Slå på den under Inställningar › Kopplingar › Webb och sociala medier.` });
    }
  }
  if (draft.target.kind === "news" && !facts.news) problems.push({ field: "target", message: "Bara en administratörs uppdrag kan publicera interna nyheter, och Nyheter måste vara påslaget för företaget. Välj Bara en rapport, eller be en administratör skapa uppdraget." });
  if ((draft.target.kind === "post" || draft.target.kind === "news") && draft.target.publish === "auto") {
    cautions.push("Första körningen sparas alltid som utkast, även efter att du ändrat vad agenten gör, var den publicerar eller underlaget.");
    cautions.push("Agenten sparar också ett utkast i stället och säger varför, om texten nämner kunder eller personuppgifter, tar upp priser, elsäkerhet eller gränsvärden, lovar något om arbetet eller bygger på ett tunt eller osäkert underlag.");
  }

  // Så får du resultatet
  if (!draft.feedback.length) problems.push({ field: "feedback", message: "Välj minst ett sätt att få resultatet: e-post, notis eller chatten." });
  // Fler mottagare: only active members who may read what the mission reads; the others are left out, with the reason.
  const chosen = facts.members && draft.recipients ? resolveRecipients(draft, facts.members, facts.ownerId ?? "") : undefined;
  if (chosen) {
    if (chosen.included.length) notes.push(`Resultatet skickas också som e-post till ${chosen.included.length === 1 ? chosen.included[0]!.name : `${chosen.included.length} kollegor`}.`);
    for (const item of chosen.excluded) notes.push(item.reason);
    if (!chosen.included.length) notes.push("Ingen av de valda mottagarna får resultatet just nu. Bara du får det.");
  }

  const kind = listOnly ? "rules" : costClass(draft.templateKey);
  const check: MissionCheck = {
    ok: problems.length === 0, problems, notes, cautions,
    nextRunAt: next?.toISOString() ?? null, scheduleText: missionScheduleText(draft.schedule),
    cost: { kind, text: costText(kind, facts.credits) },
    summary: describeMission(draft, { next, projects: facts.projects, rounds: facts.rounds, connections: facts.connections, recipients: chosen?.included.map((item) => item.name), aiOff: listOnly }),
    tools: [...new Set(uses)].map((name) => ({ name, title: toolTitle(name), writes: !(READ_TOOLS as readonly string[]).includes(name), undoable: isUndoableTool(name) })),
    ...(chosen ? { recipients: chosen } : {}),
  };
  return { ...check, draft };
}

const FEEDBACK_WORDS: Record<keyof typeof FEEDBACK_LABEL, string> = { EMAIL: "e-post", NOTICE: "en notis i Workflow", CHAT: "en sammanfattning i chatten" };
const TARGET_WORD: Record<string, string> = { report: "Bara en rapport", work_order: "Planerad arbetsorder", post: "Inlägg", news: "Intern nyhet" };

/** Så här kommer agenten att arbeta: a short plain description, one sentence per part. */
export function describeMission(draft: MissionDraft, context: { next: Date | null; projects?: Readonly<Record<string, string>>; rounds?: Readonly<Record<string, string>>; connections?: MissionFacts["connections"]; recipients?: readonly string[]; aiOff?: boolean }): string[] {
  const template = agentTemplate(draft.templateKey);
  if (!template) return [];
  const lines: string[] = [];
  lines.push(draft.templateKey === "custom" && draft.instruction ? `Agenten gör det du skrev: ”${draft.instruction.slice(0, 200)}”. ${template.does}` : template.does);
  lines.push(draft.schedule.kind === "event" ? `Den körs ${missionScheduleText(draft.schedule).toLocaleLowerCase("sv")}, högst 20 gånger i timmen. Det agenten själv ändrar startar den aldrig igen.`
    : `Den körs ${missionScheduleText(draft.schedule).toLocaleLowerCase("sv")}${context.next ? `, nästa gång ${runTimeText(context.next)}` : ""}. Svensk tid.`);
  const names = draft.scope.projectIds.map((projectId) => context.projects?.[projectId]).filter(Boolean) as string[];
  const round = draft.scope.roundScheduleId ? context.rounds?.[draft.scope.roundScheduleId] : null;
  lines.push(`Underlag: ${template.basis}${names.length ? ` Bara projekten ${names.join(", ")}.` : ""}${round ? ` Ronden ${round}.` : ""} Agenten använder dina behörigheter och ser aldrig mer än du.`);
  const channels = draft.target.channels.map((channel) => `${POST_CHANNEL_LABEL[channel]}${context.connections?.[channel]?.name ? ` (${context.connections[channel].name})` : ""}`);
  switch (draft.target.kind) {
    case "report": lines.push(`Agenten skapar inget. Den gör en rapport${draft.templateKey === "custom" ? (context.aiOff ? ": Workflow hämtar och räknar posterna" : ": Workflow hämtar och räknar posterna, och Workflow AI bedömer och skriver utifrån dem") : ""}, som du kan öppna som PDF.`); break;
    case "actions": lines.push(`Agenten föreslår ändringar i Workflow med dina behörigheter: ${(draft.target.tools ?? []).map((name) => toolTitle(name).toLowerCase()).join(", ") || "inget valt ännu"}. Inget ändras förrän du väljer Godkänn, och det du godkänner loggas.`); break;
    case "work_order": lines.push("Saknas månadens arbetsorder skapar agenten den som Planerad, utan ansvarig. Finns den redan skapas inget."); break;
    case "post": lines.push(draft.target.publish === "auto"
      ? `Agenten publicerar inlägget på ${channels.join(" och ") || "de valda kanalerna"}. Första gången, och när texten är känslig eller underlaget osäkert, sparas ett utkast under Inlägg i stället.`
      : `Agenten sparar ett utkast under Inlägg (${PUBLISH_LABEL.draft.toLocaleLowerCase("sv")}). Inget publiceras förrän du gör det själv.`); break;
    case "news": lines.push(draft.target.publish === "auto"
      ? "Agenten publicerar en intern nyhet under Nyheter. Första gången, och när texten är känslig eller underlaget osäkert, sparas den som utkast i stället."
      : "Agenten sparar en intern nyhet som utkast under Nyheter."); break;
  }
  lines.push(draft.feedback.length ? `Du får resultatet som ${draft.feedback.map((channel) => FEEDBACK_WORDS[channel]).join(" och ")}.` : "Du har inte valt hur du får resultatet.");
  const others = context.recipients ?? [];
  if (others.length) lines.push(`${others.length > 3 ? `${others.length} kollegor` : others.length === 1 ? others[0] : `${others.slice(0, -1).join(", ")} och ${others[others.length - 1]}`} får det också som e-post. De får läsa allt agenten läser.`);
  lines.push(template.never);
  return lines;
}
