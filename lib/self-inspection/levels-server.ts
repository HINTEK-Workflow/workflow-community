import type { Prisma } from "@prisma/client";
import { moduleOn } from "@/lib/workflow/modules";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { visibleFormsWhere } from "@/lib/kfid/form-scope";
import { workflowTaskDataSchema } from "@/lib/workflow/task-model";
import { savedTaskRefusal } from "./task-work";
import {
  checkLevel, effectiveRiskClass, levelDirectory, riskClassKey, toLevel, type LevelAction, type LevelDirectory, type ResolvedRiskClass, type RiskSubject, type RoleForLevels,
} from "./levels";
import { externalInProgramme, personLevel } from "./structure";
import { swedishDayKey } from "@/lib/swedish-time";

/**
 * Roller med nivå och riskklasser in Cloud (2026-10-07): the tables behind the level rule that the task routes
 * enforce. Everything is read inside the caller's company (organizationId on every query). The rule itself is
 * ./levels.ts, shared with Local, the demo and the screen.
 *
 * A company is only subject to the rule once it has given at least one role to a person; before that nothing is read
 * but that one question, so a company that does not use roles pays one cheap query per save.
 */
type Db = Prisma.TransactionClient | typeof prisma;
const SCOPE = "company";

/** Who has which level in the company: the roles' members and everyone who works under supervision. */
export async function loadLevelDirectory(organizationId: string, db: Db = prisma, names: ReadonlyMap<string, string> = new Map()): Promise<LevelDirectory> {
  const placements = await db.selfInspectionRoleMember.findMany({
    where: { organizationId, role: { program: { scopeKey: SCOPE } } },
    select: { userId: true, role: { select: { id: true, name: true, level: true, capabilities: true } } },
  });
  // Ny struktur (2026-11-24): a person's own level from the competence card (or a hired person with an account in the
  // programme) decides for that person; the roles' levels are then requirements. Only cards that hold a level are read.
  // The rule is switched on by roles with people only, never by a card alone.
  if (!placements.length) return { enforced: false, people: [] };
  const own = await ownLevelsOf(organizationId, db);
  const supervised = await db.selfInspectionCompetence.findMany({ where: { organizationId, supervised: true, program: { scopeKey: SCOPE } }, select: { userId: true } });
  const roles = new Map<string, RoleForLevels & { members: { personId: string }[] }>();
  for (const placement of placements) {
    const role = roles.get(placement.role.id) ?? { name: placement.role.name, level: placement.role.level, capabilities: placement.role.capabilities, members: [] };
    role.members.push({ personId: placement.userId });
    roles.set(placement.role.id, role);
  }
  const directory = levelDirectory([...roles.values()], supervised.map((item) => item.userId), names, own);
  return withAdminExemption(directory, (await db.organizationMember.findMany({ where: { organizationId, isActive: true, role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } })).map((item) => item.userId), names);
}

async function ownLevelsOf(organizationId: string, db: Db): Promise<Map<string, number>> {
  const today = swedishDayKey(new Date());
  const [program, cards, external] = await Promise.all([
    db.selfInspectionProgram.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey: SCOPE } }, select: { levelYears: true } }),
    db.selfInspectionCompetenceCard.findMany({ where: { organizationId, leftAt: null, OR: [{ level: { not: null } }, { levelOverride: { not: null } }, { experienceSince: { not: null } }, { experienceYears: { not: null } }] },
      select: { userId: true, level: true, levelOverride: true, experienceSince: true, experienceYears: true, experienceYearsAt: true }, take: 2000 }),
    db.selfInspectionExternalPerson.findMany({ where: { organizationId, included: true, userId: { not: null } }, select: { userId: true, level: true, included: true, periodFrom: true, periodTo: true }, take: 500 }),
  ]);
  const levels = new Map<string, number>();
  for (const card of cards) { const level = personLevel(card, program?.levelYears, today).level; if (level) levels.set(card.userId, level); }
  for (const person of external) if (person.userId && externalInProgramme(person, today) && !levels.has(person.userId)) levels.set(person.userId, toLevel(person.level));
  return levels;
}

/**
 * Administratörsundantaget (2026-10-07): the company's administrators and owner are the ones who give out the
 * roles, so an administrator without a role of their own is not locked out – they count as level 3, like the owner of a
 * Local file (documentLevels). An administrator who has been given a role keeps that role's level unchanged.
 */
export function withAdminExemption(directory: LevelDirectory, adminIds: readonly string[], names: ReadonlyMap<string, string> = new Map()): LevelDirectory {
  if (!directory.enforced || !adminIds.length) return directory;
  const people = [...directory.people];
  for (const personId of adminIds) {
    const index = people.findIndex((person) => person.personId === personId);
    if (index >= 0) { if (people[index].level === 0) people[index] = { ...people[index], level: 3, roles: ["Företagsadministratör"] }; }
    else people.push({ personId, name: names.get(personId) ?? "", level: 3, supervised: false, roles: ["Företagsadministratör"], inspects: false });
  }
  return { enforced: directory.enforced, people };
}

/** The company's own risk classes by key. */
export async function loadRiskClassMap(organizationId: string, db: Db = prisma): Promise<Record<string, number>> {
  const rows = await db.taskRiskClass.findMany({ where: { organizationId }, select: { key: true, riskClass: true }, take: 1000 });
  return Object.fromEntries(rows.map((row) => [row.key, row.riskClass]));
}

/** What a task is, for its risk class: the work order, or the form (its family and category) the protocol came from. */
export type TaskForRisk = { kind: string; formTemplateId?: string | null; /** A protocol's own data: names the form when the form itself was deleted. */ data?: unknown };
export async function riskSubjectOf(organizationId: string, task: TaskForRisk, db: Db = prisma): Promise<(RiskSubject & { name: string }) | null> {
  if (task.kind === "WORK_ORDER") return { kind: "WORK_ORDER", name: "Arbetsorder" };
  if (task.kind === "RISK_ASSESSMENT") return { kind: "RISK_ASSESSMENT", name: "Riskbedömning" };
  if (task.kind !== "FORM") return null;
  const details = ((task.data as { details?: { templateId?: string; templateName?: string } } | null | undefined) ?? {}).details;
  const templateId = task.formTemplateId ?? details?.templateId;
  if (!templateId) return null;
  return formSubject(organizationId, templateId, details?.templateName, db);
}

/** A form by its template id: the family (the Workflow original's id also for the company's version), the name and the category. */
export async function formSubject(organizationId: string, templateId: string, fallbackName = "Protokoll", db: Db = prisma): Promise<RiskSubject & { name: string; /** The permission area of its protocols, when the form exists. */ area?: string }> {
  const template = await db.formTemplate.findFirst({ where: { id: templateId, ...visibleFormsWhere(organizationId) }, select: { id: true, baseTemplateId: true, name: true, displayName: true, category: true, permissionArea: true } });
  // A deleted form: the protocol keeps its own copy, so the class still follows the id it was made from.
  if (!template) return { kind: "FORM", formId: templateId, category: null, name: fallbackName || "Protokoll" };
  return { kind: "FORM", formId: template.baseTemplateId ?? template.id, category: template.category, name: template.displayName || template.name || fallbackName, area: template.permissionArea };
}

/** The company's own class for the task's type, else Workflow's proposal. */
export async function resolveRiskClass(organizationId: string, subject: (RiskSubject & { name?: string }) | null, db: Db = prisma): Promise<ResolvedRiskClass | null> {
  if (!subject) return null;
  const key = riskClassKey(subject);
  if (!key) return null;
  const row = await db.taskRiskClass.findUnique({ where: { organizationId_key: { organizationId, key } }, select: { riskClass: true } });
  return effectiveRiskClass(subject, row ? { [key]: row.riskClass } : undefined);
}

/**
 * The level rule for one task in one request: opened once (one question, whether the company uses roles at all), then asked
 * for the person who is assigned or who acts. A refusal is a 403 that says what is missing.
 */
export async function openLevelGate(organizationId: string, db: Db = prisma) {
  const loaded = await loadLevelDirectory(organizationId, db);
  // Företagets moduler (0.39.0): roles are given under Egenkontroll, so with the module off nobody can change them and nobody is
  // stopped by them. Asked only of a company that uses roles, so the others still pay one query.
  const off = loaded.enforced && !moduleOn((await db.organization.findUnique({ where: { id: organizationId }, select: { disabledModules: true } }))?.disabledModules, "self_inspection");
  const directory: LevelDirectory = off ? { enforced: false, people: [] } : loaded;
  const risks = new Map<string, ResolvedRiskClass | null>();
  const nameOf = async (userId: string) => (await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }).then((user) => user?.name?.trim() || user?.email)) || undefined;
  return {
    directory,
    enforced: directory.enforced,
    /** The task's risk class, resolved once per type. */
    async risk(task: TaskForRisk) {
      const subject = await riskSubjectOf(organizationId, task, db);
      const key = subject ? riskClassKey(subject) : null;
      if (!subject || !key) return null;
      if (!risks.has(key)) risks.set(key, await resolveRiskClass(organizationId, subject, db));
      return risks.get(key) ?? null;
    },
    /** Throws when `person` may not take the task's class. `actorId` is who made the request ("Du …" when it is the same person). */
    async require(task: TaskForRisk, input: { action: LevelAction; person: { id: string; name?: string }; actorId: string; responsibleId?: string | null }) {
      if (!directory.enforced) return;
      const subject = await this.risk(task);
      if (!subject) return;
      const ask = (names: { person?: string; responsible?: string }) => checkLevel({
        directory, subject, action: input.action, person: { id: input.person.id, name: input.person.name || names.person }, self: input.person.id === input.actorId,
        responsible: input.responsibleId ? { id: input.responsibleId, name: names.responsible } : null,
      });
      if (ask({}).allowed) return;
      // Refused: the names are read now, for the message only.
      const decision = ask({ person: input.person.name ? undefined : await nameOf(input.person.id), responsible: input.responsibleId ? await nameOf(input.responsibleId) : undefined });
      if (!decision.allowed) throw new ApiError(403, decision.message);
    },
  };
}

/** One check for a person acting on a stored task (start, reopen): the task's responsible person is the supervisor. */
export async function requireTaskLevel(organizationId: string, task: TaskForRisk & { assignedToUserId?: string | null }, actor: { id: string }, action: LevelAction, db: Db = prisma) {
  const gate = await openLevelGate(organizationId, db);
  if (!gate.enforced) return;
  await gate.require(task, { action, person: { id: actor.id }, actorId: actor.id, responsibleId: task.assignedToUserId });
}

/**
 * Assigning people to a task's type: the project's responsible taking over a task, a person planned on a task, or the
 * person a round is assigned to. `responsibleId` is the task's responsible person, the supervisor of someone who works under
 * supervision (planning); without it the person must reach the class by their own level.
 */
export async function requireAssignLevels(organizationId: string, task: TaskForRisk, people: { id: string; name?: string }[], actor: { id: string }, options: { responsibleId?: string | null } = {}, db: Db = prisma) {
  if (!people.length) return;
  const gate = await openLevelGate(organizationId, db);
  if (!gate.enforced) return;
  for (const person of people) await gate.require(task, { action: "assign", person, actorId: actor.id, responsibleId: options.responsibleId });
}

/** The same check for a task read by its id (an attachment added or removed). */
export async function requireTaskLevelById(organizationId: string, taskId: string, actor: { id: string }, action: LevelAction, db: Db = prisma) {
  const gate = await openLevelGate(organizationId, db);
  if (!gate.enforced) return;
  const task = await db.workflowTask.findFirst({ where: { id: taskId, organizationId }, select: { kind: true, formTemplateId: true, data: true, assignedToUserId: true } });
  if (task) await gate.require(task, { action, person: { id: actor.id }, actorId: actor.id, responsibleId: task.assignedToUserId });
}

/**
 * What a save of a task asks of the people involved (2026-10-07): a new responsible person must be able to take the
 * task's class by their own level, and whoever fills in, signs or completes it must reach it – by level, or under
 * supervision when the responsible person is a supervisor. A save that only plans (the title, the project, the date) is not
 * work. `input.task` is the task as it will be stored, `current` is read here.
 */
export async function requireSavedTaskLevels(organizationId: string, actor: { id: string }, input: {
  task: { id?: string; kind: string; status: string; assignedToUserId: string | null; assignedToName: string; data: unknown };
  formTemplateId: string | null;
  /** workflowTaskHasDocumentation(task): a new task that already holds something filled in. */
  documented: boolean;
}, db: Db = prisma) {
  const gate = await openLevelGate(organizationId, db);
  if (!gate.enforced) return;
  const { task } = input;
  const stored = task.id ? await db.workflowTask.findFirst({ where: { id: task.id, organizationId }, select: { status: true, data: true, assignedToUserId: true } }) : null;
  // The stored answers are read with today's schema, like every other read of a task, so a task saved before a field got its
  // default is not "changed" by the default alone.
  const current = stored ? { ...stored, data: workflowTaskDataSchema.safeParse(stored.data).data ?? stored.data } : null;
  const risk = await gate.risk({ kind: task.kind, formTemplateId: input.formTemplateId, data: task.data });
  const ask = (names?: ReadonlyMap<string, string>) => savedTaskRefusal({ directory: gate.directory, risk, actor, task, current, documented: input.documented, names });
  if (!ask()) return;
  // Refused: the people's names are read now, for the message only.
  const ids = [...new Set([actor.id, task.assignedToUserId].filter((id): id is string => Boolean(id)))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  throw new ApiError(403, ask(new Map(users.map((user) => [user.id, user.name?.trim() || user.email]))) ?? ask() ?? "Du kan inte arbeta i uppgiften.");
}

/** Whether `key` names a task type the company can set a class for: the work order, or a form it may read (Workflow's or its own). */
export async function riskClassKeyExists(organizationId: string, key: string, db: Db = prisma): Promise<boolean> {
  if (key === riskClassKey({ kind: "WORK_ORDER" })) return true;
  if (!key.startsWith("form:")) return false;
  // The family's id: the original's, or the company's own form (which has no original).
  return Boolean(await db.formTemplate.findFirst({ where: { id: key.slice("form:".length), ...visibleFormsWhere(organizationId) }, select: { id: true } }));
}
