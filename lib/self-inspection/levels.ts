import { RISK_FORM_ID } from "../workflow/builtin-originals";

/**
 * Roller med nivå och riskklasser (2026-10-07, ersätter "roll per uppdrag"). Pure rules shared by Cloud (the
 * routes), Local, the demo and the screen, so every place answers the same way. No database code here.
 *
 * - A programme role has a level 1–3; a person's level is the highest level among the person's roles.
 * - Every task type has a risk class 1–3 that the company's admin sets (Workflow only proposes).
 * - A person may not be assigned, start, fill in, complete or sign a task whose risk class is above the person's level.
 * - Supervision: a person who works under supervision may do a task one class above their level when the task's
 *   responsible person is a supervisor whose own level reaches the task's class.
 * - Nothing is blocked while the company has given no role to anyone (backwards compatible), nor for a task type
 *   without a risk class.
 */

export const LEVELS = [1, 2, 3] as const;
export type Level = (typeof LEVELS)[number];
export type RiskClass = Level;
export const toLevel = (value: unknown, fallback: Level = 1): Level => value === 1 || value === 2 || value === 3 ? value : fallback;
export const RISK_CLASSES = LEVELS;
export const isRiskClass = (value: unknown): value is RiskClass => value === 1 || value === 2 || value === 3;

/** What a level and a risk class mean, in short words for the pickers (no standard is quoted). */
export const LEVEL_TEXTS: Record<Level, string> = {
  1: "Nivå 1 – enklare uppgifter och arbete under handledning",
  2: "Nivå 2 – självständigt arbete",
  3: "Nivå 3 – uppgifter med högre risk och kontroller",
};
export const RISK_CLASS_TEXTS: Record<RiskClass, string> = {
  1: "Nivå 1 – enklare uppgifter",
  2: "Nivå 2 – självständigt arbete",
  3: "Nivå 3 – krävande uppgifter och kontroller",
};

// ---------- risk classes: the task type, its key and Workflow's proposal ----------

/** What decides a task's risk class: the built-in work order, or a form (a protocol) by its family and category. */
export type RiskSubject = { kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM"; /** The form's family id: the Workflow original's id also for a company's version of it. */ formId?: string | null; category?: string | null };
export const WORK_ORDER_RISK_KEY = "kind:WORK_ORDER";
export const formRiskKey = (formId: string) => `form:${formId}`;
/** The old Riskbedömning task type follows the risk assessment form, which has taken its place. */
export function riskClassKey(subject: RiskSubject): string | null {
  if (subject.kind === "WORK_ORDER") return WORK_ORDER_RISK_KEY;
  if (subject.kind === "RISK_ASSESSMENT") return formRiskKey(RISK_FORM_ID);
  return subject.formId ? formRiskKey(subject.formId) : null;
}
const KEY_PATTERN = /^(kind:WORK_ORDER|form:[A-Za-z0-9_-]{1,100})$/;
export const isRiskClassKey = (key: string) => KEY_PATTERN.test(key);

/**
 * Workflow's proposal per category of form and for the work order. It is only a proposal: it applies until the company's
 * admin sets a class of their own, and every place that shows it says so. Nothing here is a limit from a standard.
 */
const PROPOSAL_BY_CATEGORY: Record<string, RiskClass> = { ELECTRICAL: 2, POWER: 3, INDUSTRY: 2, ROUNDS: 1, PROPERTY: 1, SAFETY: 1, OTHER: 1 };
/** Workflow's own forms by id, so a place that does not know a form's category (Local, a protocol of a form since deleted) proposes the same. */
const PROPOSAL_BY_FORM: Record<string, RiskClass> = {
  "hintek-kontroll-fore-idrifttagning": 2, "hintek-planering-kravbestamning": 2, [RISK_FORM_ID]: 2, "hintek-fortlopande-kontroll": 2, "hintek-termografering": 2,
  "hintek-isolationsmatning-ebr": 3, "hintek-foljelinematning-ebr": 3,
  "hintek-driftrond-vattenkraft": 1, "hintek-reservkraft": 1, "hintek-pumpstation": 1, "hintek-skyddsrond": 1,
};
export function proposedRiskClass(subject: RiskSubject): RiskClass {
  if (subject.kind === "WORK_ORDER") return 1;
  const formId = subject.kind === "RISK_ASSESSMENT" ? RISK_FORM_ID : subject.formId ?? "";
  return PROPOSAL_BY_FORM[formId] ?? PROPOSAL_BY_CATEGORY[subject.category ?? ""] ?? 1;
}

export type ResolvedRiskClass = { key: string; name: string; value: RiskClass; /** True while the class is Workflow's proposal, not the company's own choice. */ suggested: boolean };
/** The company's own class (`company`, by key) before Workflow's proposal. */
export function effectiveRiskClass(subject: RiskSubject & { name?: string }, company: Readonly<Record<string, number>> | undefined): ResolvedRiskClass | null {
  const key = riskClassKey(subject);
  if (!key) return null;
  const own = company?.[key];
  const name = subject.name ?? (subject.kind === "WORK_ORDER" ? "Arbetsorder" : subject.kind === "RISK_ASSESSMENT" ? "Riskbedömning" : "Protokoll");
  return isRiskClass(own) ? { key, name, value: own, suggested: false } : { key, name, value: proposedRiskClass(subject), suggested: true };
}

// ---------- who has which level ----------

export type LevelPerson = {
  personId: string; name: string;
  /** The highest level among the person's roles; 0 when the person has no role. */
  level: number;
  /** Works under supervision (the competence data's flag): may do one class above the level when a supervisor is responsible. */
  supervised: boolean;
  roles: string[];
  /** Has a role whose task is to inspect the work of others. */
  inspects: boolean;
};
export type LevelDirectory = {
  /** The company has given at least one role to a person. Only then is anything blocked. */
  enforced: boolean;
  people: LevelPerson[];
};
export type RoleForLevels = { name: string; level: number; capabilities?: readonly string[]; members: readonly { personId: string; name?: string }[] };

export function levelDirectory(roles: readonly RoleForLevels[], supervised: Iterable<string> = [], names: ReadonlyMap<string, string> = new Map()): LevelDirectory {
  const people = new Map<string, LevelPerson>();
  const person = (personId: string, kept = "") => {
    let found = people.get(personId);
    if (!found) { found = { personId, name: names.get(personId) || kept, level: 0, supervised: false, roles: [], inspects: false }; people.set(personId, found); }
    else if (!found.name) found.name = names.get(personId) || kept;
    return found;
  };
  for (const role of roles) for (const member of role.members) {
    const found = person(member.personId, member.name ?? "");
    found.level = Math.max(found.level, toLevel(role.level));
    if (!found.roles.includes(role.name)) found.roles.push(role.name);
    if (role.capabilities?.includes("inspect")) found.inspects = true;
  }
  for (const personId of supervised) person(personId).supervised = true;
  return { enforced: roles.some((role) => role.members.length > 0), people: [...people.values()] };
}

const NOBODY: Omit<LevelPerson, "personId"> = { name: "", level: 0, supervised: false, roles: [], inspects: false };
export const levelOf = (directory: LevelDirectory, personId: string | null | undefined): LevelPerson =>
  directory.people.find((item) => item.personId === personId) ?? { personId: personId ?? "", ...NOBODY };

/** What the screen needs to explain and pre-check the rule: the directory, the reader and the company's classes. */
export type LevelsView = { enforced: boolean; me: LevelPerson; people: LevelPerson[]; riskClasses: Record<string, number> };
export function levelsView(directory: LevelDirectory, meId: string, riskClasses: Record<string, number>): LevelsView {
  return { enforced: directory.enforced, me: levelOf(directory, meId), people: directory.people, riskClasses };
}
export const directoryOfView = (view: Pick<LevelsView, "enforced" | "people">): LevelDirectory => ({ enforced: view.enforced, people: view.people });

// ---------- the rule ----------

export const LEVEL_ACTIONS = { assign: "tilldelas", start: "starta", fill: "fylla i", complete: "slutföra", sign: "signera", reopen: "återöppna", work: "arbeta i" } as const;
export type LevelAction = keyof typeof LEVEL_ACTIONS;
export type LevelDecision =
  | { allowed: true; via: "free" | "level" | "supervision" }
  | { allowed: false; missing: "role" | "level" | "supervisor"; message: string };

const possessive = (name: string) => /[sxz]$/i.test(name) ? name : `${name}s`;
const WHERE = "under Egenkontroll";

/**
 * Whether `person` may be assigned, start, fill in, complete or sign a task of `subject`'s risk class. `responsible` is
 * the task's responsible person: the supervisor for a person who works under supervision. Pure; the routes call it with
 * the stored data, the screen with what is on the page, so a blocked occasion is explained before it is tried.
 */
export function checkLevel(input: {
  directory: LevelDirectory;
  subject: Pick<ResolvedRiskClass, "name" | "value" | "suggested"> | null;
  action: LevelAction;
  person: { id: string; name?: string };
  /** The message speaks to the person ("Du …") instead of about them. */
  self?: boolean;
  responsible?: { id: string; name?: string } | null;
}): LevelDecision {
  const { directory, subject, person } = input;
  if (!directory.enforced || !subject) return { allowed: true, via: "free" };
  const level = levelOf(directory, person.id);
  if (level.level >= subject.value) return { allowed: true, via: "level" };
  const supervisor = input.responsible && input.responsible.id !== person.id ? levelOf(directory, input.responsible.id) : null;
  if (level.supervised && level.level + 1 === subject.value && supervisor && supervisor.level >= subject.value) return { allowed: true, via: "supervision" };

  const who = input.self ? "Du" : person.name?.trim() || level.name || "Personen";
  const base = `${who} kan inte ${LEVEL_ACTIONS[input.action]} uppgiften`;
  const type = `${subject.name} kräver nivå ${subject.value}${subject.suggested ? " (Workflows förslag)" : ""}`;
  const own = input.self ? "din" : `${possessive(who)}`;
  const fix = `Be en administratör ge ${input.self ? "dig" : "personen"} en roll med nivå ${subject.value} eller högre ${WHERE}.`;
  if (level.level === 0) return { allowed: false, missing: "role", message: `${base}: ${input.self ? "du har" : "personen har"} ingen roll i egenkontrollprogrammet och ${type}. ${fix}` };
  let message = `${base}: ${type} och ${own} nivå är ${level.level}. ${fix}`;
  let missing: "level" | "supervisor" = "level";
  if (level.supervised && level.level + 1 === subject.value) {
    missing = "supervisor";
    message += input.responsible && input.responsible.id !== person.id
      ? ` ${input.self ? "Du arbetar" : "Personen arbetar"} under handledning, men ${supervisor?.name || input.responsible.name || "den ansvariga"} har nivå ${supervisor?.level ?? 0} – handledaren behöver nivå ${subject.value} eller högre.`
      : ` ${input.self ? "Du arbetar" : "Personen arbetar"} under handledning och får göra uppgifter som kräver en nivå över ${input.self ? "din" : "sin"} när en handledare med nivå ${subject.value} eller högre är ansvarig på uppgiften.`;
  }
  return { allowed: false, missing, message };
}
