import { cleanRecipients, EVENT_NEEDS, type MissionDraft } from "./model";
import { agentTemplate } from "./templates";
import type { SourceKey } from "./tool-policy";

/**
 * Fler mottagare (2026-11-23): besides the owner, chosen colleagues in the same company or a role (all admins, everyone) get the
 * mission's result by e-mail. Only active members of the company – never an address outside it – and each only when they may read
 * what the mission reads themselves: the agent reads with the owner's rights, so a recipient who lacks one of them is left out and
 * Kontrollera says why. The run checks it again with the rights the recipients have then. Pure: the check, the run and the tests
 * read the same rules.
 */
export type Colleague = { id: string; name: string; admin: boolean; rights: readonly string[] };
export type RecipientChoice = { included: { id: string; name: string }[]; excluded: { id: string; name: string; reason: string }[] };

/**
 * What a recipient must be allowed to read for each part (conservative: what the owner sees of the team needs Teamet – läsa, since
 * the agent reads with the owner's view).
 */
const SOURCE_RIGHTS: Record<SourceKey, readonly string[]> = {
  work_orders: ["work-order:read", "team:read"], deviations: ["team:read"], time: ["team:read"], quotes: ["quotes:read"], planning: ["team:read"],
  projects: ["projects:read"], customers: ["customers:read"], credentials: ["admin"], invoices: ["invoicing:read"],
};
const RIGHT_WORDS: Record<string, string> = {
  "work-order:read": "läsa arbetsordrar", "team:read": "se Teamet", "quotes:read": "läsa offerter", "quotes:edit": "redigera offerter", "projects:read": "läsa projekt",
  "customers:read": "läsa kunder", "maintenance:read": "läsa underhåll", "invoicing:read": "se fakturor", admin: "vara administratör",
};

/** The rights a recipient needs to read what the mission reads (as "subject:action", or "admin"). */
export function readNeeds(draft: Pick<MissionDraft, "templateKey" | "scope" | "schedule">): string[] {
  const template = agentTemplate(draft.templateKey);
  const needs = new Set<string>();
  if (!template) return ["admin"];
  if (template.needs.admin) needs.add("admin");
  // Reading is enough for the recipient: what the owner must be able to make (create, edit) becomes reading the same subject.
  for (const right of template.needs.rights ?? []) needs.add(right === "quotes:edit" ? right : right.replace(/:(create|edit)$/, ":read"));
  const sources = draft.templateKey === "custom" ? (draft.scope.sources?.length ? draft.scope.sources : ["work_orders" as const]) : template.sources;
  for (const source of sources) for (const right of SOURCE_RIGHTS[source]) needs.add(right);
  if (draft.scope.projectIds.length) needs.add("projects:read");
  if (draft.schedule.kind === "event") {
    const event = EVENT_NEEDS[draft.schedule.event];
    if (event?.admin) needs.add("admin");
    for (const right of event?.rights ?? []) needs.add(right);
  }
  return [...needs];
}

/** The parts the colleague lacks (empty: the colleague may read everything the mission reads). */
export function missingRights(colleague: Pick<Colleague, "admin" | "rights">, needs: readonly string[]) {
  if (colleague.admin) return [];
  return needs.filter((need) => need === "admin" || !colleague.rights.includes(need));
}

/** Who gets the result besides the owner, and who is left out with the reason in plain Swedish. */
export function resolveRecipients(draft: Pick<MissionDraft, "templateKey" | "scope" | "schedule" | "recipients">, colleagues: readonly Colleague[], ownerId: string): RecipientChoice {
  const chosen = cleanRecipients(draft.recipients);
  if (!chosen) return { included: [], excluded: [] };
  const byId = new Map(colleagues.map((colleague) => [colleague.id, colleague]));
  const wanted = new Map<string, Colleague>();
  const excluded: RecipientChoice["excluded"] = [];
  for (const userId of chosen.userIds) {
    const colleague = byId.get(userId);
    if (colleague) wanted.set(userId, colleague);
    else excluded.push({ id: userId, name: "En vald mottagare", reason: "En vald mottagare är inte längre aktiv i företaget och får inte resultatet." });
  }
  for (const colleague of colleagues) if (chosen.roles.includes("everyone") || (chosen.roles.includes("admins") && colleague.admin)) wanted.set(colleague.id, colleague);
  wanted.delete(ownerId);
  const needs = readNeeds(draft);
  const included: RecipientChoice["included"] = [];
  for (const colleague of wanted.values()) {
    const missing = missingRights(colleague, needs);
    if (!missing.length) included.push({ id: colleague.id, name: colleague.name });
    else excluded.push({ id: colleague.id, name: colleague.name, reason: `${colleague.name} får inte resultatet, eftersom behörigheten att ${missing.map((item) => RIGHT_WORDS[item] ?? "läsa underlaget").join(" och ")} saknas.` });
  }
  return { included, excluded };
}
