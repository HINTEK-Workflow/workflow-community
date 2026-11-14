import { swedishDayKey } from "@/lib/swedish-time";
import { ACTIVITY_TYPES, activityLabel, documentLevels, dueState, LANGUAGE_LEVELS, licenceText, mayReadCompetence, peopleOverview, type ActivityTypeKey, type Assignment, type Instrument, type ProgramDeviation, type SelfInspectionDocument } from "./model";
import { checkLevel, directoryOfView, effectiveRiskClass, levelsView, type LevelAction, type LevelsView, type ResolvedRiskClass, type RiskSubject } from "./levels";
import type { PlanningScope } from "./planning-scope";
import { isIncidentType, mayReadDeviation } from "./incidents";

/**
 * Egenkontroll in the daily work (etapp 2–3, 2026-10-06): what a project or a task needs from the programme –
 * who may perform and inspect, the kind of work, the customer's special requirements (the field on the customer card,
 * read by the caller, 2026-10-07), the deviations already taken from the protocol, the instruments to choose from and the
 * scope from the project's planning protocol. Since 2026-10-07 also the task's risk class and everyone's level
 * (./levels.ts), so the page can say before it is tried what a person's level lets them do; the routes decide. Pure, so
 * Cloud, Local and the demo answer alike. The competence warnings here never block anything (beslut 2); the levels do,
 * on the server.
 */
/**
 * `card`: what the person's competence card says (kompetenskort v2, 2026-10-08) – groups, valid trainings, driving licence
 * and languages – only for a reader who may read the card (an admin, or the person), otherwise null. It informs; it never
 * changes the level rule.
 */
export type WorkCandidate = { id: string; name: string; workTypes: ActivityTypeKey[]; assessed: boolean; supervised: boolean; expiredCredentials: number; level: number;
  card: { groups: string[]; validTrainings: number; licence: string; licenceExpired: boolean; languages: string[] } | null;
  /** The reader may not read this person's competence (a member, about someone else): workTypes, assessed and expiredCredentials are empty, not "missing". */
  competenceHidden: boolean };
export type WorkAssignment = Pick<Assignment, "performerId" | "performerName" | "inspectorId" | "inspectorName" | "activityType">;
export type WorkContext = {
  hasProgram: boolean;
  /** The programme's activity types, to choose the kind of work. */
  activityTypes: { key: ActivityTypeKey; label: string }[];
  performers: WorkCandidate[];
  inspectors: WorkCandidate[];
  project: Assignment | null;
  task: Assignment | null;
  /** The task's choice, else its project's, field by field. */
  effective: WorkAssignment;
  /** The customer's "Särskilda krav" from the customer card. */
  customerRequirements: string;
  /** The moments of Kontroll före idrifttagning the project's planning protocol selects (a suggestion for a new control), or null. */
  planning: PlanningScope | null;
  /** Deviations already taken from this task's protocol (number and status only). */
  deviations: { id: string; number: number; rowId: string; status: string }[];
  /**
   * Avvikelse ↔ arbetsorder (2026-10-10): the log entries this work order fixes, for a reader who may read them (an
   * admin, or the person who reported the entry or is responsible for it) – so the order's page links to them.
   */
  orderDeviations?: { id: string; number: number; kind: ProgramDeviation["kind"]; status: ProgramDeviation["status"]; closedAt: string | null; closedByName: string }[];
  /** Active instruments to choose in a protocol. */
  instruments: (Pick<Instrument, "id" | "name" | "serialNumber" | "calibratedAt" | "nextCalibrationAt"> & { overdue: boolean })[];
  /** Roles with levels (2026-10-07): the reader's level, everyone's, and the company's classes per task type. */
  levels: LevelsView;
  /** The task's risk class (the company's own, else Workflow's proposal), when the work context was asked for a task or a form. */
  riskClass: ResolvedRiskClass | null;
};

const EMPTY: WorkAssignment = { performerId: null, performerName: "", inspectorId: null, inspectorName: "", activityType: null };

export type WorkDocument = Pick<SelfInspectionDocument, "program" | "assignments" | "credentials" | "instruments" | "riskClasses"> & Partial<Pick<SelfInspectionDocument, "competenceCards" | "competenceGroups">>
  & { deviations: (Pick<ProgramDeviation, "id" | "number" | "status" | "source"> & Partial<Pick<ProgramDeviation, "kind" | "workOrderId" | "reportedById" | "responsibleId" | "closedAt" | "closedByName" | "type">>)[] };
export function workContext(doc: WorkDocument, input: { projectId?: string | null; taskId?: string | null; names?: Map<string, string>; customerRequirements?: string; planning?: PlanningScope | null;
  /** The reader, for their own level. */
  me?: { id: string };
  /** Whether the reader is a company admin: an admin reads everyone's competence card, anyone else only their own. */
  admin?: boolean;
  /** The Teamet right: a near miss or an accident is read only by its reporter, admins and this (./incidents.ts). */
  team?: boolean;
  /** The reader owns a Local file: counted as level 3 there (documentLevels). */
  owner?: boolean;
  /** The task type the risk class comes from (a task, or the form a new protocol starts from). */
  subject?: (RiskSubject & { name?: string }) | null }, today = swedishDayKey(new Date())): WorkContext {
  const program = doc.program;
  const reader = { id: input.me?.id ?? "", admin: Boolean(input.admin), team: Boolean(input.admin || input.team) };
  const nameOf = (personId: string | null, kept: string) => (personId && input.names?.get(personId)) || kept;
  const people = program ? peopleOverview({ roles: program.roles, people: program.people }) : [];
  const expired = new Map<string, number>();
  for (const item of doc.credentials ?? []) if (!item.leftAt && dueState(item.validUntil, today) === "OVERDUE") expired.set(item.personId, (expired.get(item.personId) ?? 0) + 1);
  const groups = new Map((doc.competenceGroups ?? []).map((group) => [group.id, group.name]));
  // Kompetenskort v2: the card is personal data – an admin reads everyone's, anyone else only their own.
  const cardOf = (personId: string): WorkCandidate["card"] => {
    if (!input.admin && input.me?.id !== personId) return null;
    const card = (doc.competenceCards ?? []).find((item) => item.personId === personId && !item.leftAt);
    const lines = (doc.credentials ?? []).filter((item) => item.personId === personId && !item.leftAt);
    if (!card && !lines.length) return null;
    return {
      groups: (card?.groupIds ?? []).flatMap((groupId) => groups.has(groupId) ? [groups.get(groupId)!] : []).sort((a, b) => a.localeCompare(b, "sv")),
      validTrainings: lines.filter((item) => dueState(item.validUntil, today) !== "OVERDUE").length,
      licence: card ? licenceText(card) : "", licenceExpired: Boolean(card && dueState(card.licenceValidUntil, today) === "OVERDUE"),
      languages: (card?.languages ?? []).map((item) => `${item.language} (${LANGUAGE_LEVELS[item.level].toLocaleLowerCase("sv")})`),
    };
  };
  // A member reads only their own competence assessment (2026-10-09); of the others only the name, the level and
  // whether they work under supervision (which the level rule needs) – nothing that says what the assessment holds.
  const candidate = (person: (typeof people)[number]): WorkCandidate => {
    const visible = mayReadCompetence({ id: input.me?.id ?? "", admin: Boolean(input.admin) }, person.personId);
    return {
      id: person.personId, name: nameOf(person.personId, person.name), workTypes: visible ? person.competence?.workTypes ?? [] : [], assessed: visible && Boolean(person.competence?.assessment.trim()),
      supervised: Boolean(person.competence?.supervised), expiredCredentials: visible ? expired.get(person.personId) ?? 0 : 0, level: person.level, card: cardOf(person.personId),
      competenceHidden: !visible,
    };
  };
  const named = (item: Assignment | undefined) => item ? { ...item, performerName: nameOf(item.performerId, item.performerName), inspectorName: nameOf(item.inspectorId, item.inspectorName) } : null;
  const project = input.projectId ? named(doc.assignments?.find((item) => item.target === "project" && item.targetId === input.projectId)) : null;
  const task = input.taskId ? named(doc.assignments?.find((item) => item.target === "task" && item.targetId === input.taskId)) : null;
  const effective: WorkAssignment = {
    performerId: task?.performerId ?? project?.performerId ?? null, performerName: task?.performerId ? task.performerName : project?.performerName ?? "",
    inspectorId: task?.inspectorId ?? project?.inspectorId ?? null, inspectorName: task?.inspectorId ? task.inspectorName : project?.inspectorName ?? "",
    activityType: task?.activityType ?? project?.activityType ?? null,
  };
  return {
    hasProgram: Boolean(program),
    activityTypes: ACTIVITY_TYPES.filter((type) => program?.activityTypes.includes(type.key)).map((type) => ({ key: type.key, label: type.label })),
    performers: people.filter((person) => person.capabilities.includes("perform")).map(candidate),
    inspectors: people.filter((person) => person.capabilities.includes("inspect")).map(candidate),
    project, task, effective: program ? effective : EMPTY,
    customerRequirements: input.customerRequirements?.trim() ?? "",
    planning: input.planning ?? null,
    // A near miss or an accident is left out unless the reader may read it (2026-10-30); the others as before.
    deviations: input.taskId ? doc.deviations.filter((item) => item.source?.taskId === input.taskId
      && (!isIncidentType(item.type) || (item.reportedById !== undefined && mayReadDeviation(reader, { type: item.type, reportedById: item.reportedById, responsibleId: item.responsibleId })))).map((item) => ({ id: item.id, number: item.number, rowId: item.source?.rowId ?? "", status: item.status })) : [],
    orderDeviations: input.taskId ? doc.deviations.filter((item) => item.workOrderId === input.taskId && item.reportedById !== undefined
      && mayReadDeviation(reader, { type: item.type, reportedById: item.reportedById, responsibleId: item.responsibleId }))
      .map((item) => ({ id: item.id, number: item.number, kind: item.kind ?? "DEVIATION", status: item.status, closedAt: item.closedAt ?? null, closedByName: item.closedByName ?? "" })) : [],
    instruments: (doc.instruments ?? []).filter((item) => item.active).sort((a, b) => a.name.localeCompare(b.name, "sv"))
      .map(({ id, name, serialNumber, calibratedAt, nextCalibrationAt }) => ({ id, name, serialNumber, calibratedAt, nextCalibrationAt, overdue: dueState(nextCalibrationAt, today) === "OVERDUE" })),
    levels: levelsView(documentLevels(doc, input.names, input.owner ? input.me?.id : undefined), input.me?.id ?? "", doc.riskClasses ?? {}),
    riskClass: input.subject ? effectiveRiskClass(input.subject, doc.riskClasses) : null,
  };
}

/**
 * The task type of a task kept in a Local file or in the demo, for its risk class: the work order, or the form the protocol
 * was made from (Workflow's own forms are known by id; the category is not kept in the protocol).
 */
export function localTaskSubject(task: { kind: string; data?: unknown }): (RiskSubject & { name: string }) | null {
  if (task.kind === "WORK_ORDER") return { kind: "WORK_ORDER", name: "Arbetsorder" };
  if (task.kind === "RISK_ASSESSMENT") return { kind: "RISK_ASSESSMENT", name: "Riskbedömning" };
  const details = (task.data as { details?: { templateId?: string; templateName?: string } } | undefined)?.details;
  return task.kind === "FORM" && details?.templateId ? { kind: "FORM", formId: details.templateId, category: null, name: details.templateName || "Protokoll" } : null;
}

/**
 * The level rule in a Local file (2026-10-07). The file's owner is its only user and counts as level 3, so nothing is
 * asked of them; what is checked is a task given to a person named in the programme (by name, since Local has no member
 * list): that person must reach the task's risk class by their own level. A name the programme does not know is free, and so
 * is a task that keeps its responsible person. Returns the explanation, or null.
 */
export function localAssignRefusal(doc: Pick<SelfInspectionDocument, "program" | "riskClasses">, task: { kind: string; data: unknown; assignedToUserId: string | null; assignedToName: string },
  previous: { assignedToUserId: string | null; assignedToName: string } | null): string | null {
  const same = (a: string, b: string) => a.trim().toLocaleLowerCase("sv") === b.trim().toLocaleLowerCase("sv");
  const name = task.assignedToName.trim();
  if (!name || task.assignedToUserId) return null;
  if (previous && !previous.assignedToUserId && same(previous.assignedToName, name)) return null;
  const directory = documentLevels(doc);
  const person = directory.people.find((item) => same(item.name, name));
  if (!person) return null;
  const subject = localTaskSubject(task);
  const decision = checkLevel({ directory, subject: subject ? effectiveRiskClass(subject, doc.riskClasses) : null, action: "assign", person: { id: person.personId, name: person.name } });
  return decision.allowed ? null : decision.message;
}

/**
 * Why the reader cannot work on the task, or null when they can: the task's risk class against the reader's level, with
 * the task's responsible person as supervisor for someone who works under supervision. The page uses it to explain a
 * blocked occasion and to pre-check; the route decides again from the stored data.
 */
export function workBlock(context: Pick<WorkContext, "levels" | "riskClass">, input: { responsibleId?: string | null; responsibleName?: string; action?: LevelAction; person?: { id: string; name?: string } } = {}): string | null {
  const person = input.person ?? { id: context.levels.me.personId, name: context.levels.me.name };
  const decision = checkLevel({ directory: directoryOfView(context.levels), subject: context.riskClass, action: input.action ?? "work", person, self: !input.person || input.person.id === context.levels.me.personId,
    responsible: input.responsibleId ? { id: input.responsibleId, name: input.responsibleName } : null });
  return decision.allowed ? null : decision.message;
}
/** Why a person cannot be made the responsible of the task (strictly by level: a supervisor must be able to do it themself). */
export function assignBlock(context: Pick<WorkContext, "levels" | "riskClass">, person: { id: string; name?: string }): string | null {
  const decision = checkLevel({ directory: directoryOfView(context.levels), subject: context.riskClass, action: "assign", person, self: person.id === context.levels.me.personId });
  return decision.allowed ? null : decision.message;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase("sv") === b.trim().toLocaleLowerCase("sv");
const find = (list: WorkCandidate[], id: string | null | undefined, name: string) => list.find((person) => (id && person.id === id) || (name.trim() && same(person.name, name)));

/**
 * The warnings for who inspects (and who performs) a piece of work: the same person as the one who performed it, no
 * role with an inspection task, no competence for the kind of work, under supervision, an expired training. People are
 * matched by id when known, otherwise by the name written in the protocol. Never blocks.
 */
export function assignmentWarnings(context: Pick<WorkContext, "hasProgram" | "performers" | "inspectors">, input: { performerId?: string | null; performerName: string; inspectorId?: string | null; inspectorName: string; activityType: ActivityTypeKey | null }): string[] {
  if (!context.hasProgram) return [];
  const warnings: string[] = [];
  const inspectorName = input.inspectorName.trim();
  const performerName = input.performerName.trim();
  const kind = input.activityType ? activityLabel(input.activityType).toLocaleLowerCase("sv") : "";
  const competence = (person: WorkCandidate, label: string) => {
    if (person.competenceHidden) {
      // Only the person and the admins read the assessment; the supervision is part of the level rule and shown to all.
      if (person.supervised) warnings.push(`${person.name} arbetar under handledning enligt egenkontrollprogrammet.`);
      return;
    }
    if (!person.assessed) warnings.push(`Kompetensbedömning saknas för ${label} ${person.name} i egenkontrollprogrammet.`);
    else if (input.activityType && person.workTypes.length && !person.workTypes.includes(input.activityType)) warnings.push(`${person.name} saknar kompetens för ${kind} enligt egenkontrollprogrammet.`);
    if (person.supervised) warnings.push(`${person.name} arbetar under handledning enligt egenkontrollprogrammet.`);
    if (person.expiredCredentials) warnings.push(`${person.name} har ${person.expiredCredentials === 1 ? "en utbildning eller ett intyg" : `${person.expiredCredentials} utbildningar eller intyg`} som har gått ut.`);
    // Kompetenskort v2: only shown to a reader who may read the card (`card` is null otherwise).
    if (person.card?.licenceExpired) warnings.push(`Körkortet för ${person.name} har gått ut enligt kompetenskortet.`);
  };
  if (inspectorName || input.inspectorId) {
    const sameId = Boolean(input.inspectorId && input.performerId && input.inspectorId === input.performerId);
    if (sameId || (inspectorName && performerName && same(inspectorName, performerName))) warnings.push("Den som kontrollerar är samma person som utförde arbetet.");
    const inspector = find(context.inspectors, input.inspectorId, inspectorName);
    if (!inspector) warnings.push(`${inspectorName || "Den som kontrollerar"} har ingen roll med kontrolluppgift i egenkontrollprogrammet.`);
    else competence(inspector, "kontrollanten");
  }
  if (input.performerId) {
    const performer = find(context.performers, input.performerId, performerName);
    if (!performer) warnings.push(`${performerName || "Den som utför"} har ingen roll som utför arbete i egenkontrollprogrammet.`);
    else competence(performer, "den som utför");
  }
  return [...new Set(warnings)];
}
