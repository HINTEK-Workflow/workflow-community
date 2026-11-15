import type { Prisma } from "@prisma/client";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { prisma } from "@/lib/db";
import { requireWorkflowPermission, type Context } from "@/lib/kfid/server";
import { formFamily } from "@/lib/kfid/form-server";
import { canViewTeam, formPermissionArea, hasWorkflowPermission, normalizeWorkflowPermissionProfile, readableTaskScope, workflowSubjectForTask } from "@/lib/workflow/permissions";
import { closedInvestigation, deviationCloseRefusal, deviationReadWhere, deviationSeverity, deviationType, DEVIATION_TYPES, incidentFields, incidentResponsibleRefusal, isIncidentType, mayHandleDeviation, mayReadDeviation, reportToAuthorityRefusal, REPORTABLE_WHERE, type DeviationViewer } from "./incidents";
import { readableTaskSql } from "@/lib/workflow/task-access";
import { PLANNING_FORM_ID } from "@/lib/workflow/builtin-planning-form";
import { swedishDayKey } from "@/lib/swedish-time";
import {
  ACTIVITY_TYPES, actionNeedsAdmin, CARD_HISTORY_LIMIT, cardContentSchema, cardLanguages, cardLicenceClasses, changeFingerprint, credentialExpired, DUE_REMINDER_DAYS, contentHash, contentSchema, documentReminders, dueState,
  emptySelfInspectionDocument, mayReadCard, mayReadCompetence, mayWithdraw, programContent, selfInspectionView, SelfInspectionError, withdrawnDeviationKept, withNoteOfWithdrawal,
  type ActivityTypeKey, type CardVersion, type CompetenceCard, type DraftProgram, type InstrumentProtocolsView, type InstrumentsView, type ParsedSelfInspectionAction, type Person, type ProgramContent, type ProgramDeviation, type SelfInspectionDocument,
} from "./model";
import { cardChangeText } from "./document";
import { workContext, type WorkDocument } from "./work";
import { formSubject, loadLevelDirectory, loadRiskClassMap, riskClassKeyExists, riskSubjectOf } from "./levels-server";
import { planningScope, type PlanningProtocol } from "./planning-scope";
import { deleteCompetenceCards, deleteCredentialLines, recordCardVersion, removeStoredFiles } from "./credentials-server";
import { TEMPLATE_ROLES, TEMPLATE_SECTIONS, SELF_INSPECTION_TEMPLATE_VERSION } from "./template";
import { manualStatusPatch, newEntryPatch, withoutSourceNote } from "./deviation-link";
import { cloudOrderForRow, withCloudDeviationOrders } from "./deviation-link-server";
import { DEVIATION_PERSONAL_DATA_REFUSAL } from "./retention";
import { countDeviationsSoonPurged } from "./retention-server";

/**
 * Egenkontrollprogram in Cloud (2026-10-06): the tables behind app/api/self-inspection. Everything is read and
 * written inside the caller's company (organizationId on every query, composite keys in the database); the shared view
 * and rules come from ./model, so Local and the demo answer the same way.
 */
const SCOPE = "company";
type Db = Prisma.TransactionClient | typeof prisma;
const LEFT = "Personen har lämnat företaget. Kompetenskortet kan inte ändras, bara tas bort.";

export async function companyPeople(organizationId: string, db: Db = prisma) {
  const members = await db.organizationMember.findMany({ where: { organizationId }, select: { userId: true, isActive: true, user: { select: { name: true, email: true, isActive: true } } } });
  const all: Person[] = members.map((member) => ({ id: member.userId, name: member.user.name?.trim() || member.user.email }));
  const active = members.filter((member) => member.isActive && member.user.isActive).map((member) => ({ id: member.userId, name: member.user.name?.trim() || member.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
  return { all, active };
}

const iso = (value: Date | null) => value ? value.toISOString() : null;
/** Tillbud och olycksfall (2026-10-30): the stored type and investigation as the document reads them. */
export const incidentRow = (item: { type: string; occurredAt: Date | null; whatHappened: string; cause: string; serious: boolean; personalInjury: boolean; electrical: boolean;
  reportedToAuthorityAt: Date | null; reportedToAuthorityById: string | null; doneNote: string }) => ({
  type: deviationType(item.type), occurredAt: iso(item.occurredAt), whatHappened: item.whatHappened, cause: item.cause, serious: item.serious, personalInjury: item.personalInjury,
  electrical: item.electrical, reportedToAuthorityAt: iso(item.reportedToAuthorityAt), reportedToAuthorityById: item.reportedToAuthorityById, reportedToAuthorityByName: "", doneNote: item.doneNote,
});
export const PHOTO_SELECT = { id: true, phase: true, filename: true, mimeType: true, size: true, createdById: true, createdAt: true } as const;
const photoRow = (file: { id: string; phase: string; filename: string; mimeType: string; size: number; createdById: string; createdAt: Date }) => ({
  id: file.id, phase: file.phase === "AFTER" ? "AFTER" as const : "BEFORE" as const, filename: file.filename, mimeType: file.mimeType, size: file.size, createdById: file.createdById, createdAt: file.createdAt.toISOString(),
});
/** The reader as the deviation log's rules see them (./incidents.ts). */
export const deviationViewerOf = (ctx: Pick<Context, "user" | "admin" | "workflowPermissions">): DeviationViewer => ({ id: ctx.user.id, admin: ctx.admin, team: canViewTeam(ctx) });
function parseContent(value: unknown): ProgramContent {
  const parsed = contentSchema.safeParse(value);
  return parsed.success ? parsed.data : { title: "Egenkontrollprogram", templateVersion: "", activityTypes: [], worksOnOthersInstallations: false, registrationCheckedAt: null, sections: [], roles: [] };
}

/** The company's programme as the shared document; a member reads only what the view will show them. */
export async function loadSelfInspectionDocument(organizationId: string, viewer: DeviationViewer, db: Db = prisma): Promise<SelfInspectionDocument> {
  const program = await db.selfInspectionProgram.findUnique({
    where: { organizationId_scopeKey: { organizationId, scopeKey: SCOPE } },
    include: { sections: { orderBy: { sortOrder: "asc" } }, roles: { orderBy: { sortOrder: "asc" }, include: { members: { orderBy: { createdAt: "asc" } } } }, competence: { orderBy: { createdAt: "asc" } } },
  });
  // Avvikelser (2026-10-30): the log is the company's, with or without a programme; the read rule of ./incidents.ts in the query.
  const [registers, deviations] = await Promise.all([loadRegisters(organizationId, viewer, db), loadDeviationLog(organizationId, viewer, db)]);
  if (!program) return { ...emptySelfInspectionDocument(), ...registers, deviations };
  const where = { programId: program.id, organizationId };
  // Bounded reads (2026-09-26): the latest 50 versions and reviews, the latest 200 log entries.
  const versions = await db.selfInspectionVersion.findMany({ where, orderBy: { number: "desc" }, take: viewer.admin ? 50 : 1 });
  const latest = versions[0];
  const [confirmations, reviews] = await Promise.all([
    latest ? db.selfInspectionReadConfirmation.findMany({ where: { organizationId, versionId: latest.id, ...(viewer.admin ? {} : { userId: viewer.id }) } }) : [],
    db.selfInspectionReview.findMany({ where, orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }], take: viewer.admin ? 50 : 1 }),
  ]);
  const draft: DraftProgram = {
    id: program.id, title: program.title, templateVersion: program.templateVersion,
    activityTypes: program.activityTypes as DraftProgram["activityTypes"], worksOnOthersInstallations: program.worksOnOthersInstallations,
    registrationCheckedAt: program.registrationCheckedAt, customerId: program.customerId, revision: program.revision,
    sections: program.sections.map((section) => ({ id: section.id, key: section.key, title: section.title, body: section.body, legalRef: section.legalRef, sortOrder: section.sortOrder })),
    roles: program.roles.map((role) => ({
      id: role.id, key: role.key, name: role.name, description: role.description, duties: role.duties, isEre: role.isEre, level: role.level,
      capabilities: role.capabilities as DraftProgram["roles"][number]["capabilities"], sortOrder: role.sortOrder,
      // Cloud keeps no names in the programme: they are read from the person, so an erased person reads anonymised.
      members: role.members.map((member) => ({ personId: member.userId, name: "", authorizationLevel: member.authorizationLevel as "" | "A" | "AL" | "B",
        authorizationNumber: viewer.admin || member.userId === viewer.id ? member.authorizationNumber : "", registered: member.registered })),
    })),
    // The draft's competence data is for admins; members read it from the approved version.
    people: viewer.admin ? program.competence.map((item) => ({ personId: item.userId, name: "", workTypes: item.workTypes as DraftProgram["people"][number]["workTypes"], scope: item.scope,
      assessment: item.assessment, assessedAt: item.assessedAt, limitations: item.limitations, supervised: item.supervised })) : [],
    createdAt: program.createdAt.toISOString(), updatedAt: program.updatedAt.toISOString(),
  };
  return {
    program: draft,
    versions: versions.map((version) => {
      const content = parseContent(version.content);
      // A member never receives the others' competence assessments, not even inside the server (2026-10-09).
      const own = viewer.admin || !content.people ? content : { ...content, people: content.people.filter((person) => mayReadCompetence(viewer, person.personId)) };
      // The approver's name as it was at approval (kept for traceability); older versions read it from the person.
      return { id: version.id, number: version.number, content: own, hash: version.contentHash, changeReason: version.changeReason,
        approvedById: version.approvedById, approvedByName: version.approvedByName, approvedAt: version.approvedAt.toISOString() };
    }),
    confirmations: confirmations.map((item) => ({ versionId: item.versionId, personId: item.userId, name: "", confirmedAt: item.confirmedAt.toISOString() })),
    reviews: reviews.map((item) => ({ id: item.id, reviewedAt: item.reviewedAt, reviewedById: item.reviewedById, reviewedByName: "", versionNumber: item.versionNumber,
      registrationChecked: item.registrationChecked, deviationsReviewed: item.deviationsReviewed, competenceFollowed: item.competenceFollowed,
      outcome: item.outcome === "CHANGES_NEEDED" ? "CHANGES_NEEDED" : "NO_CHANGES", notes: item.notes, createdAt: item.createdAt.toISOString() })),
    deviations,
    // The customers' requirements are the customer card's field (2026-10-07); the document keeps the older shape empty.
    customerRequirements: [],
    ...registers,
  };
}

/** The company's deviation log as the reader may read it (./incidents.ts), the latest 200 entries; no programme needed. */
async function loadDeviationLog(organizationId: string, viewer: DeviationViewer, db: Db): Promise<SelfInspectionDocument["deviations"]> {
  const rows = await db.selfInspectionDeviation.findMany({ where: { organizationId, AND: [deviationReadWhere(viewer)] }, orderBy: { number: "desc" }, take: 200,
    include: { attachments: { orderBy: { createdAt: "asc" }, select: PHOTO_SELECT } } });
  return rows.map((item) => ({
    id: item.id, number: item.number, kind: item.kind === "IMPROVEMENT" ? "IMPROVEMENT" : "DEVIATION", title: item.title, description: item.description,
    category: item.category === "IMMEDIATE" ? "IMMEDIATE" : "ROUTINE", systematic: item.systematic,
    status: item.status === "DONE" ? "DONE" : item.status === "IN_PROGRESS" ? "IN_PROGRESS" : "OPEN", action: item.action, responsibleId: item.responsibleUserId, responsibleName: "",
    dueDate: item.dueDate, followUp: item.followUp, reportedById: item.reportedById, reportedByName: "", createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), closedAt: iso(item.closedAt),
    source: item.sourceTaskId ? { taskId: item.sourceTaskId, title: item.sourceTitle, rowId: item.sourceRowId } : null,
    // Avvikelse ↔ arbetsorder (2026-10-10): the order that fixes it and who closed it, by the name kept then.
    workOrderId: item.workOrderId, closedById: item.closedById, closedByName: item.closedByName,
    ...incidentRow(item),
    severity: deviationSeverity(item.severity),
    retentionHoldAt: iso(item.retentionHoldAt), personalDataRemovedAt: iso(item.personalDataRemovedAt),
    attachments: item.attachments.map(photoRow),
  }));
}

/**
 * Etapp 2–3: the registers beside the programme – competence cards (admins all, a member their own; a card of a person who
 * left stays three months) and the instruments (everyone reads them). Customers' special requirements are a field on the
 * customer card (2026-10-07). Assignments are read per project or task (cloudWorkContext).
 */
async function loadRegisters(organizationId: string, viewer: { id: string; admin: boolean }, db: Db) {
  const own = viewer.admin ? {} : { userId: viewer.id, leftAt: null };
  const [credentials, cards, groups, instruments, riskClasses] = await Promise.all([
    db.selfInspectionCredential.findMany({ where: { organizationId, ...own }, orderBy: { createdAt: "asc" }, take: 2000,
      include: { files: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, mimeType: true, size: true, createdAt: true } } } }),
    // Kompetenskort v2 (2026-10-08): the rest of the cards, read like the lines, and the company's groups.
    db.selfInspectionCompetenceCard.findMany({ where: { organizationId, ...own }, orderBy: { createdAt: "asc" }, take: 2000, include: { groups: { select: { groupId: true } } } }),
    db.selfInspectionCompetenceGroup.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 100 }),
    db.instrument.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 500 }),
    loadRiskClassMap(organizationId, db),
  ]);
  return {
    assignments: [],
    riskClasses,
    credentials: credentials.map((item) => ({ id: item.id, personId: item.userId, name: "", title: item.title, provider: item.provider, issuedAt: item.issuedAt, validUntil: item.validUntil, note: item.note, leftAt: iso(item.leftAt),
      files: item.files.map((file) => ({ id: file.id, filename: file.filename, mimeType: file.mimeType, size: file.size, createdAt: file.createdAt.toISOString() })),
      createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
    competenceCards: cards.map(cardRow),
    competenceGroups: groups.map((group) => ({ id: group.id, name: group.name, description: group.description, sortOrder: group.sortOrder, createdAt: group.createdAt.toISOString(), updatedAt: group.updatedAt.toISOString() })),
    // The history of a card is read on its own (cloudCardHistory), bounded, never with the page.
    cardVersions: [],
    instruments: instruments.map(instrumentRow),
  } satisfies Pick<SelfInspectionDocument, "assignments" | "credentials" | "competenceCards" | "competenceGroups" | "cardVersions" | "instruments" | "riskClasses">;
}
type CardRow = { userId: string; licenceClasses: string[]; licenceValidUntil: string | null; languages: unknown; suggestion: string; suggestedAt: Date | null; revision: number; leftAt: Date | null;
  createdAt: Date; updatedAt: Date; groups?: { groupId: string }[] };
const cardRow = (card: CardRow): CompetenceCard => ({
  personId: card.userId, name: "", groupIds: (card.groups ?? []).map((item) => item.groupId), licenceClasses: cardLicenceClasses(card.licenceClasses), licenceValidUntil: card.licenceValidUntil,
  languages: cardLanguages(card.languages), suggestion: card.suggestion, suggestedAt: iso(card.suggestedAt), revision: card.revision, leftAt: iso(card.leftAt),
  createdAt: card.createdAt.toISOString(), updatedAt: card.updatedAt.toISOString(),
});
const instrumentRow = (item: { id: string; name: string; serialNumber: string; calibratedAt: string | null; nextCalibrationAt: string | null; note: string; isActive: boolean; createdAt: Date; updatedAt: Date }) => ({
  id: item.id, name: item.name, serialNumber: item.serialNumber, calibratedAt: item.calibratedAt, nextCalibrationAt: item.nextCalibrationAt, note: item.note,
  active: item.isActive, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
});

/**
 * The bell's reminders (polled every minute): only what they need – the latest and first version, the person's own
 * confirmation, the latest review and open actions due within a week – never the content or the whole log.
 */
export async function cloudSelfInspectionReminders(ctx: Context, today = swedishDayKey(new Date())) {
  // Företagets moduler (0.39.0): with Egenkontroll off its programme and competence cards remind nobody; the deviation log and the instruments are always on.
  const programmeOn = organizationModuleOn(ctx.organization, "self_inspection");
  const program = programmeOn ? await prisma.selfInspectionProgram.findUnique({ where: { organizationId_scopeKey: { organizationId: ctx.organizationId, scopeKey: SCOPE } }, select: { id: true } }) : null;
  // Competence cards and instruments that run out within 30 days (etapp 3), with or without a programme.
  const horizon = new Date(Date.parse(`${today}T00:00:00.000Z`) + DUE_REMINDER_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [credentials, cards, instruments] = await Promise.all([
    // No reminder for a person who has left the company (their card is only kept for a while).
    !programmeOn ? [] : prisma.selfInspectionCredential.findMany({ where: { organizationId: ctx.organizationId, leftAt: null, validUntil: { not: null, lte: horizon }, ...(ctx.admin ? {} : { userId: ctx.user.id }) }, orderBy: { validUntil: "asc" }, take: 10 }),
    // Kompetenskort v2: a driving licence that runs out, and – for admins – a person's suggestion.
    !programmeOn ? [] : prisma.selfInspectionCompetenceCard.findMany({ where: { organizationId: ctx.organizationId, leftAt: null, ...(ctx.admin ? {} : { userId: ctx.user.id }),
      OR: [{ licenceValidUntil: { not: null, lte: horizon } }, ...(ctx.admin ? [{ suggestion: { not: "" } }] : [])] }, orderBy: { updatedAt: "desc" }, take: 10 }),
    ctx.admin ? prisma.instrument.findMany({ where: { organizationId: ctx.organizationId, isActive: true, nextCalibrationAt: { not: null, lte: horizon } }, orderBy: { nextCalibrationAt: "asc" }, take: 10 }) : [],
  ]);
  const registers = {
    credentials: credentials.map((item) => ({ id: item.id, personId: item.userId, name: "", title: item.title, provider: "", issuedAt: item.issuedAt, validUntil: item.validUntil, note: "", leftAt: null, files: [], createdAt: "", updatedAt: "" })),
    competenceCards: cards.map((card) => cardRow(card)),
    instruments: instruments.map((item) => ({ id: item.id, name: item.name, serialNumber: item.serialNumber, calibratedAt: item.calibratedAt, nextCalibrationAt: item.nextCalibrationAt, note: "", active: true, createdAt: "", updatedAt: "" })),
  };
  if ([...credentials, ...cards].some((item) => item.userId !== ctx.user.id)) {
    const people = await companyPeople(ctx.organizationId);
    const names = new Map(people.all.map((person) => [person.id, person.name]));
    registers.credentials = registers.credentials.map((item) => ({ ...item, name: names.get(item.personId) ?? "" }));
    registers.competenceCards = registers.competenceCards.map((card) => ({ ...card, name: names.get(card.personId) ?? "" }));
  }
  // The log's reminders come with or without a programme (Avvikelser, 2026-10-30); a missing programme reads no versions.
  const where = { programId: program?.id ?? "", organizationId: ctx.organizationId };
  const soon = new Date(Date.parse(`${today}T00:00:00.000Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const pick = { id: true, number: true, approvedAt: true, approvedById: true } as const;
  const dueSoon = { dueDate: { not: "", lte: soon } };
  // Kräver åtgärd (beslut 4): an entry of the grade Hög or Akut until it is done (the query already leaves out what is done);
  // for the person it is theirs to do. TE7: an open entry that is the person's.
  const severeOpen = { severity: { in: ["HIGH", "ACUTE"] } };
  const mySevere = { ...severeOpen, responsibleUserId: ctx.user.id };
  const myOpen = { status: "OPEN", responsibleUserId: ctx.user.id };
  const [latest, first, review, deviations] = await Promise.all([
    program ? prisma.selfInspectionVersion.findFirst({ where, orderBy: { number: "desc" }, select: pick }) : null,
    program && ctx.admin ? prisma.selfInspectionVersion.findFirst({ where, orderBy: { number: "asc" }, select: pick }) : null,
    program && ctx.admin ? prisma.selfInspectionReview.findFirst({ where, orderBy: { reviewedAt: "desc" } }) : null,
    // Due soon (the person's own, or every one for admins), and – for admins and Teamet – what must be reported to the
    // authority and is not marked reported (användartest 2026-10-31, fel 3), whatever its date.
    prisma.selfInspectionDeviation.findMany({ where: { organizationId: ctx.organizationId, status: { not: "DONE" }, ...(ctx.admin ? { OR: [dueSoon, REPORTABLE_WHERE, severeOpen, myOpen] }
      : { AND: [deviationReadWhere(deviationViewerOf(ctx)), { OR: [{ responsibleUserId: ctx.user.id, ...dueSoon }, myOpen, mySevere, ...(canViewTeam(ctx) ? [REPORTABLE_WHERE, severeOpen] : [])] }] }) }, orderBy: { dueDate: "asc" }, take: 50 }),
  ]);
  const confirmed = latest ? await prisma.selfInspectionReadConfirmation.findUnique({ where: { versionId_userId: { versionId: latest.id, userId: ctx.user.id } }, select: { confirmedAt: true } }) : null;
  const empty = parseContent(null);
  const version = (row: NonNullable<typeof latest>) => ({ id: row.id, number: row.number, content: empty, hash: "", changeReason: "", approvedById: row.approvedById, approvedByName: "", approvedAt: row.approvedAt.toISOString() });
  const doc: SelfInspectionDocument = {
    program: null,
    versions: [...(latest ? [version(latest)] : []), ...(first && first.id !== latest?.id ? [version(first)] : [])],
    confirmations: latest && confirmed ? [{ versionId: latest.id, personId: ctx.user.id, name: "", confirmedAt: confirmed.confirmedAt.toISOString() }] : [],
    reviews: review ? [{ id: review.id, reviewedAt: review.reviewedAt, reviewedById: review.reviewedById, reviewedByName: "", versionNumber: review.versionNumber, registrationChecked: review.registrationChecked,
      deviationsReviewed: review.deviationsReviewed, competenceFollowed: review.competenceFollowed, outcome: "NO_CHANGES", notes: "", createdAt: review.createdAt.toISOString() }] : [],
    deviations: deviations.map((item) => ({ id: item.id, number: item.number, kind: item.kind === "IMPROVEMENT" ? "IMPROVEMENT" : "DEVIATION", title: item.title, description: "", category: "ROUTINE", systematic: false,
      status: item.status === "IN_PROGRESS" ? "IN_PROGRESS" : "OPEN", action: item.action, responsibleId: item.responsibleUserId, responsibleName: "", dueDate: item.dueDate, followUp: "",
      reportedById: item.reportedById, reportedByName: "", createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), closedAt: null, source: null, type: deviationType(item.type),
      serious: item.serious, reportedToAuthorityAt: item.reportedToAuthorityAt?.toISOString() ?? null, severity: deviationSeverity(item.severity) })),
    assignments: [], customerRequirements: [], riskClasses: {}, competenceGroups: [], cardVersions: [], ...registers,
  };
  return documentReminders(doc, { me: { id: ctx.user.id, name: ctx.user.name ?? "" }, admin: ctx.admin, team: canViewTeam(ctx) }, today);
}

/**
 * The people a card names who are no longer members (they left, or were erased: "Borttagen användare"): their names come
 * from the person, since the membership is gone. Only ids that the company's own cards name are read.
 */
async function formerPeople(doc: Pick<SelfInspectionDocument, "credentials" | "competenceCards">, members: Person[]): Promise<Person[]> {
  const known = new Set(members.map((person) => person.id));
  const missing = [...new Set([...doc.credentials.map((item) => item.personId), ...(doc.competenceCards ?? []).map((card) => card.personId)])].filter((personId) => !known.has(personId));
  if (!missing.length) return [];
  const users = await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, email: true } });
  return users.map((user) => ({ id: user.id, name: user.name?.trim() || user.email }));
}

/** The reader's view in Cloud. */
export async function cloudSelfInspectionView(ctx: Context) {
  const viewer = deviationViewerOf(ctx);
  const [doc, people] = await Promise.all([loadSelfInspectionDocument(ctx.organizationId, viewer), companyPeople(ctx.organizationId)]);
  const me = { id: ctx.user.id, name: ctx.user.name?.trim() || ctx.user.email };
  // Names for everyone a card mentions; only the active members can be chosen for a new line.
  const view = await selfInspectionView(doc, { me, admin: ctx.admin, team: viewer.team, company: ctx.organization.name, people: [...people.all, ...(await formerPeople(doc, people.all))], activePeople: people.active,
    levels: await loadLevelDirectory(ctx.organizationId, prisma, new Map(people.all.map((person) => [person.id, person.name]))) });
  // Avvikelse ↔ arbetsorder (2026-10-10): each entry's work order, by title and status for those who may read work orders.
  // Ansvarig for a near miss or an accident is chosen among admins and Teamet (admins choose; members get no list).
  const incidentResponsibleIds = ctx.admin ? (await prisma.organizationMember.findMany({ where: { organizationId: ctx.organizationId, isActive: true }, select: { userId: true, role: true, workflowPermissions: true } }))
    .filter((member) => member.role === "OWNER" || member.role === "ADMIN" || hasWorkflowPermission(normalizeWorkflowPermissionProfile(member.workflowPermissions), "team", "read")).map((member) => member.userId) : undefined;
  return { ...(await withCloudDeviationOrders(ctx, view)), photos: true, deviationRetention: { soon: await countDeviationsSoonPurged(ctx.organizationId, viewer) }, ...(incidentResponsibleIds ? { incidentResponsibleIds } : {}) };
}

/**
 * A competence card's history (kompetenskort v2, 2026-10-08), newest first, the latest 50: admins any card of the company,
 * a member their own while a member. Anyone else gets the same empty answer as for a card that does not exist.
 */
export async function cloudCardHistory(ctx: Context, personId: string, today = swedishDayKey(new Date())): Promise<CardVersion[]> {
  const organizationId = ctx.organizationId;
  const [card, line] = await Promise.all([
    prisma.selfInspectionCompetenceCard.findUnique({ where: { organizationId_userId: { organizationId, userId: personId } }, select: { leftAt: true } }),
    prisma.selfInspectionCredential.findFirst({ where: { organizationId, userId: personId, leftAt: { not: null } }, select: { leftAt: true } }),
  ]);
  const left = card?.leftAt ?? line?.leftAt ?? null;
  if (!mayReadCard({ id: ctx.user.id, admin: ctx.admin }, personId, left) || (left && credentialExpired(left, today))) return [];
  const rows = await prisma.selfInspectionCompetenceCardVersion.findMany({ where: { organizationId, userId: personId }, orderBy: { number: "desc" }, take: CARD_HISTORY_LIMIT });
  const savers = [...new Set(rows.map((row) => row.savedById))];
  const users = savers.length ? await prisma.user.findMany({ where: { id: { in: savers } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name?.trim() || user.email]));
  return rows.flatMap((row) => {
    const content = cardContentSchema.safeParse(row.content);
    return content.success ? [{ id: row.id, personId, number: row.number, content: content.data, change: row.change, savedById: row.savedById, savedByName: names.get(row.savedById) ?? "", savedAt: row.savedAt.toISOString() }] : [];
  });
}

/** The instrument register on its own page (2026-10-07): everyone reads it, admins keep it. One query, no programme. */
export async function cloudInstrumentsView(ctx: Context): Promise<InstrumentsView> {
  const today = swedishDayKey(new Date());
  const rows = await prisma.instrument.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: "asc" }, take: 500 });
  return {
    canEdit: ctx.admin,
    instruments: rows.map(instrumentRow).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "sv"))
      .map((item) => ({ ...item, state: item.active ? dueState(item.nextCalibrationAt, today) : "NONE" as const })),
    protocolsReadable: readableTaskScope((subject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read")).areas.length > 0,
  };
}

/**
 * Protokoll med detta instrument (2026-10-11, plan 1L): the company's protocols whose stored instrument id
 * (`values.instruments.<field>.id`, written when the instrument was chosen) is this one – only the protocols the person
 * may read (the form's permission area, as every task list), newest first, bounded. An older protocol without the id is
 * not found; its text stays what it is.
 */
export async function cloudInstrumentProtocols(ctx: Context, instrumentId: string): Promise<InstrumentProtocolsView> {
  const can = (subject: Parameters<typeof hasWorkflowPermission>[1]) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  if (!readableTaskScope(can).areas.length) throw new SelfInspectionError(403, "Du saknar behörighet att läsa protokoll.");
  const instrument = await prisma.instrument.findFirst({ where: { id: instrumentId, organizationId: ctx.organizationId }, select: { id: true } });
  if (!instrument) throw new SelfInspectionError(404, "Instrumentet hittades inte.");
  const rows = await prisma.$queryRaw<{ id: string; title: string; status: string; updatedAt: Date; completedAt: Date | null }[]>`
    select t.id, t.title, t.status, t."updatedAt", t."completedAt" from "WorkflowTask" t
    where t."organizationId" = ${ctx.organizationId} and t.kind = 'FORM' and ${readableTaskSql(can, "t")}
      and jsonb_path_exists(t.data, '$.details.values.instruments.*.id ? (@ == $id)'::jsonpath, jsonb_build_object('id', ${instrument.id}::text))
    order by t."updatedAt" desc limit 100`;
  return { protocols: rows.map((row) => ({ id: row.id, title: row.title, status: row.status, updatedAt: row.updatedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null })) };
}

/** The project or task a piece of work concerns, read inside the company; its customer and project come with it. */
async function workTarget(ctx: Context, target: { projectId?: string | null; taskId?: string | null }, action: "read" | "edit") {
  if (target.taskId) {
    const task = await prisma.workflowTask.findFirst({ where: { id: target.taskId, organizationId: ctx.organizationId }, select: { id: true, kind: true, formArea: true, formTemplateId: true, projectId: true, customerId: true, project: { select: { customerId: true } } } });
    if (!task) throw new SelfInspectionError(404, "Uppgiften hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), action);
    return { taskId: task.id, projectId: task.projectId, customerId: task.customerId ?? task.project?.customerId ?? null, task: { kind: task.kind, formTemplateId: task.formTemplateId } };
  }
  if (target.projectId) {
    const project = await prisma.project.findFirst({ where: { id: target.projectId, organizationId: ctx.organizationId }, select: { id: true, customerId: true } });
    if (!project) throw new SelfInspectionError(404, "Projektet hittades inte.");
    requireWorkflowPermission(ctx, "projects", action);
    return { taskId: null, projectId: project.id, customerId: project.customerId, task: null };
  }
  throw new SelfInspectionError(400, "Ange ett projekt eller en uppgift.");
}

/**
 * What a project or task needs from the programme (etapp 2–3): candidates, the roles chosen, the customer's
 * requirements, deviations taken from the protocol and the instruments. Read with the right to read the work; the
 * programme's people are shown by name and competence summary only.
 */
/**
 * The protocols of "Planering och kravbestämning" in a project that the person may read (a form area of its own: Formulär),
 * the latest few – the suggestion for a new control's moments reads their "Kontroller som ska göras". The company's own
 * version of the form counts as the same form.
 */
async function projectPlanningProtocols(ctx: Context, projectId: string | null): Promise<PlanningProtocol[]> {
  if (!projectId || !(ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "forms", "read"))) return [];
  const { ids } = await formFamily(ctx.organizationId, PLANNING_FORM_ID);
  const tasks = await prisma.workflowTask.findMany({
    where: { organizationId: ctx.organizationId, projectId, kind: "FORM", formTemplateId: { in: ids } },
    orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, title: true, updatedAt: true, data: true },
  });
  return tasks.map((task) => {
    const details = (task.data as { details?: { document?: unknown; values?: unknown } } | null)?.details;
    return { id: task.id, title: task.title, updatedAt: task.updatedAt.toISOString(), document: details?.document, values: details?.values };
  });
}

export async function cloudWorkContext(ctx: Context, input: { projectId?: string | null; taskId?: string | null; /** A new protocol: the form it starts from. */ formId?: string | null; /** A new work order or risk assessment. */ kind?: string | null; /** Only a protocol asks for the planning's scope. */ planning?: boolean }) {
  const found = input.taskId || input.projectId ? await workTarget(ctx, input, "read") : null;
  if (!found && !input.formId && !input.kind) throw new SelfInspectionError(400, "Ange ett projekt, en uppgift eller ett formulär.");
  const { task: stored, ...target } = found ?? { taskId: null, projectId: null, customerId: null, task: null };
  // The risk class: of the stored task, or of the form or kind a new task starts from (the right to create it).
  let subject: Awaited<ReturnType<typeof riskSubjectOf>> = null;
  if (stored) {
    const own = stored.kind === "FORM" && !stored.formTemplateId ? await prisma.workflowTask.findFirst({ where: { id: target.taskId!, organizationId: ctx.organizationId }, select: { data: true } }) : null;
    subject = await riskSubjectOf(ctx.organizationId, { ...stored, data: own?.data });
  } else if (!target.taskId && input.formId) {
    const form = await formSubject(ctx.organizationId, input.formId);
    requireWorkflowPermission(ctx, formPermissionArea(form.area), "create");
    subject = form;
  } else if (!target.taskId && (input.kind === "WORK_ORDER" || input.kind === "RISK_ASSESSMENT")) {
    requireWorkflowPermission(ctx, workflowSubjectForTask(input.kind), "create");
    subject = await riskSubjectOf(ctx.organizationId, { kind: input.kind });
  }
  const [doc, people, assignments, deviations, customer, planning] = await Promise.all([
    loadSelfInspectionDocument(ctx.organizationId, { id: ctx.user.id, admin: true }), companyPeople(ctx.organizationId),
    prisma.selfInspectionAssignment.findMany({ where: { organizationId: ctx.organizationId, OR: [...(target.projectId ? [{ projectId: target.projectId }] : []), ...(target.taskId ? [{ taskId: target.taskId }] : [])] } }),
    // The entries taken from this protocol's rows, and (avvikelse ↔ arbetsorder, 2026-10-10) those this work order fixes.
    target.taskId ? prisma.selfInspectionDeviation.findMany({ where: { organizationId: ctx.organizationId, OR: [{ sourceTaskId: target.taskId }, { workOrderId: target.taskId }] }, orderBy: { number: "asc" }, take: 200 }) : [],
    // The customer's "Särskilda krav" from the customer card, for everyone who reads the work.
    target.customerId ? prisma.customer.findFirst({ where: { id: target.customerId, organizationId: ctx.organizationId }, select: { specialRequirements: true } }) : null,
    input.planning ? projectPlanningProtocols(ctx, target.projectId) : [],
  ]);
  const names = new Map(people.all.map((person) => [person.id, person.name]));
  const full: WorkDocument = {
    ...doc,
    assignments: assignments.map((item) => ({ id: item.id, target: item.taskId ? "task" : "project", targetId: (item.taskId ?? item.projectId)!, performerId: item.performerUserId, performerName: "",
      inspectorId: item.inspectorUserId, inspectorName: "", activityType: ACTIVITY_TYPES.some((type) => type.key === item.activityType) ? item.activityType as ActivityTypeKey : null, updatedAt: item.updatedAt.toISOString() })),
    deviations: deviations.map((item) => ({ id: item.id, number: item.number, kind: item.kind === "IMPROVEMENT" ? "IMPROVEMENT" : "DEVIATION", status: item.status === "DONE" ? "DONE" : item.status === "IN_PROGRESS" ? "IN_PROGRESS" : "OPEN",
      source: item.sourceTaskId ? { taskId: item.sourceTaskId, title: item.sourceTitle, rowId: item.sourceRowId } : null,
      workOrderId: item.workOrderId, reportedById: item.reportedById, responsibleId: item.responsibleUserId, closedAt: iso(item.closedAt), closedByName: item.closedByName, type: deviationType(item.type) })),
  };
  return workContext(full, { taskId: target.taskId, projectId: target.projectId, names, customerRequirements: customer?.specialRequirements ?? "", planning: planningScope(planning), me: { id: ctx.user.id }, admin: ctx.admin, team: canViewTeam(ctx), subject });
}

async function lockProgram(tx: Prisma.TransactionClient, organizationId: string) {
  const [row] = await tx.$queryRaw<{ id: string; revision: number }[]>`SELECT id, revision FROM "SelfInspectionProgram" WHERE "organizationId" = ${organizationId} AND "scopeKey" = ${SCOPE} FOR UPDATE`;
  if (!row) throw new SelfInspectionError(404, "Skapa programmet från mallen först.");
  return row;
}
async function requireActivePerson(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { isActive: true } });
  if (!member?.isActive) throw new SelfInspectionError(400, "Personen är inte en aktiv medlem i företaget.");
}
/** A member's role and Teamet right, for who may be responsible for a near miss or an accident. */
async function memberRights(db: Db, organizationId: string, userId: string) {
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true, workflowPermissions: true } });
  if (!member) return null;
  const admin = member.role === "OWNER" || member.role === "ADMIN";
  return { admin, team: admin || hasWorkflowPermission(normalizeWorkflowPermissionProfile(member.workflowPermissions), "team", "read") };
}
/** The incident fields as the table stores them (./incidents.ts incidentFields). */
const storedIncident = (value: ReturnType<typeof incidentFields>) => ({ ...value, occurredAt: value.occurredAt ? new Date(value.occurredAt) : null });

/**
 * One change, checked and written in a transaction. The route has checked session, origin and Cloud write access.
 * `createdDeviationId`: the entry a new report made, so the page can send its photos.
 */
export async function applyCloudSelfInspectionAction(ctx: Context, input: ParsedSelfInspectionAction): Promise<{ createdDeviationId?: string }> {
  if (actionNeedsAdmin(input) && !ctx.admin) throw new SelfInspectionError(403, "Bara företagets administratör kan ändra egenkontrollprogrammet.");
  const organizationId = ctx.organizationId;
  const actorId = ctx.user.id;
  const actor = { id: actorId, name: ctx.user.name?.trim() || ctx.user.email };
  let createdDeviationId: string | undefined;
  // The handling of a log entry is kept in the administration history (Öppna igen, Markera klar, anmäld); only type and number.
  const logDeviation = async (tx: Prisma.TransactionClient, deviationId: string, action: string, what: string) => {
    const entry = await tx.selfInspectionDeviation.findFirst({ where: { id: deviationId, organizationId }, select: { number: true, type: true } });
    if (entry) await tx.administrationEvent.create({ data: { actorId, organizationId, action, detail: `${DEVIATION_TYPES[deviationType(entry.type)]} ${entry.number} i avvikelseloggen ${what}.` } });
  };
  // Stored files of deleted competence-card lines and deviations' photos: removed from the storage once the change has been committed.
  const removedFiles: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    if (input.action === "create_program") {
      const exists = await tx.selfInspectionProgram.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey: SCOPE } }, select: { id: true } });
      if (exists) throw new SelfInspectionError(409, "Företaget har redan ett egenkontrollprogram.");
      const program = await tx.selfInspectionProgram.create({ data: { organizationId, scopeKey: SCOPE, title: "Egenkontrollprogram", templateVersion: SELF_INSPECTION_TEMPLATE_VERSION,
        activityTypes: [], worksOnOthersInstallations: true, createdById: actorId, updatedById: actorId }, select: { id: true } });
      await tx.selfInspectionSection.createMany({ data: TEMPLATE_SECTIONS.map((section, sortOrder) => ({ organizationId, programId: program.id, ...section, sortOrder })) });
      await tx.selfInspectionRole.createMany({ data: TEMPLATE_ROLES.map((role, sortOrder) => ({ organizationId, programId: program.id, ...role, capabilities: [...role.capabilities], sortOrder })) });
      await tx.administrationEvent.create({ data: { actorId, organizationId, action: "self_inspection_created", detail: `Egenkontrollprogrammet skapades från Workflows mall ${SELF_INSPECTION_TEMPLATE_VERSION}.` } });
      return;
    }
    // Etapp 2–3: the registers beside the draft; they never change its revision or an approved version.
    if (input.action === "set_assignment") {
      const target = await workTarget(ctx, input.target === "task" ? { taskId: input.targetId } : { projectId: input.targetId }, "edit");
      const program = await tx.selfInspectionProgram.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey: SCOPE } }, select: { id: true } });
      if (!program) throw new SelfInspectionError(404, "Företaget har inget egenkontrollprogram.");
      // Only the kind of work is chosen now (2026-10-07: roles are given in advance, with a level). A performer or an
      // inspector chosen before stays in its columns, unused; nothing new is written to them.
      const place = target.taskId ? { taskId: target.taskId } : { projectId: target.projectId! };
      const where = target.taskId ? { organizationId_taskId: { organizationId, taskId: target.taskId } } : { organizationId_projectId: { organizationId, projectId: target.projectId! } };
      const current = await tx.selfInspectionAssignment.findFirst({ where: { organizationId, ...place }, select: { performerUserId: true, inspectorUserId: true } });
      if (!input.activityType && !current?.performerUserId && !current?.inspectorUserId) {
        await tx.selfInspectionAssignment.deleteMany({ where: { organizationId, ...place } });
        return;
      }
      const data = { activityType: input.activityType, updatedById: actorId };
      await tx.selfInspectionAssignment.upsert({ where, create: { organizationId, ...place, ...data }, update: data });
      return;
    }
    if (input.action === "set_risk_class") {
      const name = input.key.startsWith("form:") ? (await formSubject(organizationId, input.key.slice("form:".length), "uppgiftstypen", tx)).name : "Arbetsorder";
      if (input.riskClass === null) {
        await tx.taskRiskClass.deleteMany({ where: { organizationId, key: input.key } });
        await tx.administrationEvent.create({ data: { actorId, organizationId, action: "risk_class_reset", detail: `Krävd nivå för ${name} återgick till Workflows förslag.` } });
        return;
      }
      if (!(await riskClassKeyExists(organizationId, input.key, tx))) throw new SelfInspectionError(404, "Uppgiftstypen hittades inte.");
      await tx.taskRiskClass.upsert({ where: { organizationId_key: { organizationId, key: input.key } }, create: { organizationId, key: input.key, riskClass: input.riskClass, updatedById: actorId },
        update: { riskClass: input.riskClass, updatedById: actorId } });
      await tx.administrationEvent.create({ data: { actorId, organizationId, action: "risk_class_set", detail: `Krävd nivå för ${name} sattes till nivå ${input.riskClass}.` } });
      return;
    }
    // Kompetenskort (etapp 3, v2 2026-10-08): every save keeps a version of the whole card (recordCardVersion).
    const version = (userId: string, change: string) => recordCardVersion(tx, { organizationId, userId, actorId, change });
    if (input.action === "save_credential") {
      const value = input.credential;
      await requireActivePerson(tx, organizationId, value.personId);
      const data = { title: value.title, provider: value.provider, issuedAt: value.issuedAt, validUntil: value.validUntil, note: value.note };
      if (value.id) {
        // The card of a person who left is kept as it was until it is deleted; it can only be removed (2026-10-07).
        const current = await tx.selfInspectionCredential.findFirst({ where: { id: value.id, organizationId }, select: { leftAt: true, userId: true } });
        if (!current) throw new SelfInspectionError(404, "Utbildningen hittades inte.");
        if (current.leftAt) throw new SelfInspectionError(409, LEFT);
        const changed = await tx.selfInspectionCredential.updateMany({ where: { id: value.id, organizationId, leftAt: null }, data: { ...data, userId: value.personId } });
        if (!changed.count) throw new SelfInspectionError(404, "Utbildningen hittades inte.");
        if (current.userId !== value.personId) await version(current.userId, `Utbildning flyttad till en annan person: ${value.title}`);
        await version(value.personId, `Utbildning ändrad: ${value.title}`);
      } else {
        await tx.selfInspectionCredential.create({ data: { organizationId, userId: value.personId, ...data } });
        await version(value.personId, `Utbildning tillagd: ${value.title}`);
      }
      return;
    }
    if (input.action === "remove_credential") {
      const current = await tx.selfInspectionCredential.findFirst({ where: { id: input.id, organizationId }, select: { userId: true, title: true } });
      const removed = await deleteCredentialLines(tx, { id: input.id, organizationId });
      if (!current || !removed.lines) throw new SelfInspectionError(404, "Utbildningen hittades inte.");
      removedFiles.push(...removed.files);
      await version(current.userId, `Utbildning borttagen: ${current.title}`);
      return;
    }
    // The whole card at any time, also one that is kept after the person left (2026-10-07) – with the rest of the card and its versions (v2).
    if (input.action === "remove_credential_card") {
      const removed = await deleteCredentialLines(tx, { organizationId, userId: input.personId });
      const cards = await deleteCompetenceCards(tx, { organizationId, userId: input.personId });
      if (!removed.lines && !cards) throw new SelfInspectionError(404, "Personen har inget kompetenskort.");
      removedFiles.push(...removed.files);
      await tx.administrationEvent.create({ data: { actorId, organizationId, action: "credential_card_removed", detail: `Ett kompetenskort togs bort: ${removed.lines} utbildningar eller intyg och ${removed.files.length} filer.` } });
      return;
    }
    if (input.action === "save_competence_card") {
      const value = input.card;
      await requireActivePerson(tx, organizationId, value.personId);
      const groupIds = [...new Set(value.groupIds)];
      if (groupIds.length && await tx.selfInspectionCompetenceGroup.count({ where: { organizationId, id: { in: groupIds } } }) !== groupIds.length) throw new SelfInspectionError(404, "Kompetensgruppen hittades inte.");
      const before = await tx.selfInspectionCompetenceCard.findUnique({ where: { organizationId_userId: { organizationId, userId: value.personId } }, include: { groups: { select: { groupId: true } } } });
      if (before?.leftAt) throw new SelfInspectionError(409, LEFT);
      const fields = { licenceClasses: [...new Set(value.licenceClasses)], licenceValidUntil: value.licenceValidUntil, languages: value.languages };
      await tx.selfInspectionCompetenceCard.upsert({ where: { organizationId_userId: { organizationId, userId: value.personId } }, create: { organizationId, userId: value.personId, ...fields }, update: fields });
      await tx.selfInspectionCompetenceGroupMember.deleteMany({ where: { organizationId, userId: value.personId, groupId: { notIn: groupIds } } });
      if (groupIds.length) await tx.selfInspectionCompetenceGroupMember.createMany({ data: groupIds.map((groupId) => ({ organizationId, groupId, userId: value.personId })), skipDuplicates: true });
      await version(value.personId, cardChangeText(before ? { ...cardRow(before) } : undefined, { ...fields, groupIds }));
      return;
    }
    if (input.action === "suggest_competence_change") {
      // Only about one's own card, by an active member; the card is made when it has none yet.
      await requireActivePerson(tx, organizationId, actorId);
      const data = { suggestion: input.text, suggestedAt: new Date() };
      await tx.selfInspectionCompetenceCard.upsert({ where: { organizationId_userId: { organizationId, userId: actorId } }, create: { organizationId, userId: actorId, licenceClasses: [], ...data }, update: data });
      return;
    }
    if (input.action === "clear_competence_suggestion") {
      const cleared = await tx.selfInspectionCompetenceCard.updateMany({ where: { organizationId, userId: input.personId, suggestion: { not: "" } }, data: { suggestion: "", suggestedAt: null } });
      if (!cleared.count) throw new SelfInspectionError(404, "Det finns inget förslag att ta bort.");
      return;
    }
    if (input.action === "save_competence_group") {
      const value = input.group;
      const groups = await tx.selfInspectionCompetenceGroup.findMany({ where: { organizationId }, select: { id: true, name: true, sortOrder: true } });
      if (groups.some((group) => group.id !== value.id && group.name.toLocaleLowerCase("sv") === value.name.toLocaleLowerCase("sv"))) throw new SelfInspectionError(409, "Det finns redan en kompetensgrupp med det namnet.");
      if (value.id) {
        const current = groups.find((group) => group.id === value.id);
        if (!current) throw new SelfInspectionError(404, "Kompetensgruppen hittades inte.");
        await tx.selfInspectionCompetenceGroup.updateMany({ where: { id: value.id, organizationId }, data: { name: value.name, description: value.description } });
        // The name is part of every card in the group, so each keeps a version.
        if (current.name !== value.name) for (const member of await tx.selfInspectionCompetenceGroupMember.findMany({ where: { organizationId, groupId: value.id }, select: { userId: true }, take: 2000 }))
          await version(member.userId, `Kompetensgruppen ${current.name} heter nu ${value.name}`);
        return;
      }
      if (groups.length >= 100) throw new SelfInspectionError(400, "Högst 100 kompetensgrupper.");
      await tx.selfInspectionCompetenceGroup.create({ data: { organizationId, name: value.name, description: value.description, sortOrder: groups.reduce((max, group) => Math.max(max, group.sortOrder), -1) + 1 } });
      return;
    }
    if (input.action === "remove_competence_group") {
      const current = await tx.selfInspectionCompetenceGroup.findFirst({ where: { id: input.id, organizationId }, select: { id: true, name: true, members: { select: { userId: true }, take: 2000 } } });
      if (!current) throw new SelfInspectionError(404, "Kompetensgruppen hittades inte.");
      await tx.selfInspectionCompetenceGroup.delete({ where: { id: current.id } });
      for (const member of current.members) await version(member.userId, `Kompetensgruppen ${current.name} togs bort`);
      await tx.administrationEvent.create({ data: { actorId, organizationId, action: "competence_group_removed", detail: `Kompetensgruppen ${current.name} togs bort (${current.members.length} ${current.members.length === 1 ? "person" : "personer"}).` } });
      return;
    }
    if (input.action === "save_instrument") {
      const value = input.instrument;
      const data = { name: value.name, serialNumber: value.serialNumber, calibratedAt: value.calibratedAt, nextCalibrationAt: value.nextCalibrationAt, note: value.note, isActive: value.active };
      if (value.id) {
        const changed = await tx.instrument.updateMany({ where: { id: value.id, organizationId }, data });
        if (!changed.count) throw new SelfInspectionError(404, "Instrumentet hittades inte.");
      } else await tx.instrument.create({ data: { organizationId, ...data } });
      return;
    }
    if (input.action === "remove_instrument") {
      const removed = await tx.instrument.deleteMany({ where: { id: input.id, organizationId } });
      if (!removed.count) throw new SelfInspectionError(404, "Instrumentet hittades inte.");
      return;
    }

    // Avvikelser (2026-10-30): the log needs no programme (the company row above is the lock); an entry is tied to
    // the programme when the company has one. Everything else changes the programme and locks it.
    const logAction = input.action === "save_deviation" || input.action === "withdraw_deviation" || input.action === "save_investigation" || input.action === "mark_deviation_done"
      || input.action === "reopen_deviation" || input.action === "mark_reported_to_authority" || input.action === "set_deviation_hold";
    const locked = logAction ? null : await lockProgram(tx, organizationId);
    const programId = locked?.id ?? "";
    const logProgramId = logAction ? (await tx.selfInspectionProgram.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey: SCOPE } }, select: { id: true } }))?.id ?? null : null;
    if (input.action === "confirm_read") {
      const latest = await tx.selfInspectionVersion.findFirst({ where: { programId, organizationId }, orderBy: { number: "desc" }, select: { id: true, number: true } });
      if (!latest || latest.number !== input.versionNumber) throw new SelfInspectionError(409, "Det finns en nyare version av programmet. Läs den och bekräfta igen.");
      await tx.selfInspectionReadConfirmation.createMany({ data: [{ organizationId, versionId: latest.id, userId: actorId }], skipDuplicates: true });
      return;
    }
    if (input.action === "add_review") {
      const latest = await tx.selfInspectionVersion.findFirst({ where: { programId, organizationId }, orderBy: { number: "desc" }, select: { number: true } });
      await tx.selfInspectionReview.create({ data: { organizationId, programId, ...input.review, reviewedById: actorId, versionNumber: latest?.number ?? null } });
      return;
    }
    if (input.action === "save_deviation") {
      const value = input.deviation;
      if (value.responsibleId) await requireActivePerson(tx, organizationId, value.responsibleId);
      // Ansvarig for a near miss or an accident: an admin or someone with Teamet only (privacy first, 2026-10-30).
      const responsibleRefusal = isIncidentType(value.type) && value.responsibleId ? incidentResponsibleRefusal(value.type, value.responsibleId, await memberRights(tx, organizationId, value.responsibleId)) : null;
      if (responsibleRefusal) throw new SelfInspectionError(400, responsibleRefusal);
      // Tillbud och olycksfall (2026-10-30): the type and, for a near miss or an accident, its investigation and marks.
      const incident = storedIncident(incidentFields(value));
      if (value.id) {
        const current = await tx.selfInspectionDeviation.findFirst({ where: { id: value.id, organizationId }, select: { status: true, action: true, closedAt: true, closedById: true, closedByName: true, personalDataRemovedAt: true } });
        if (!current) throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
        if (current.personalDataRemovedAt) throw new SelfInspectionError(409, DEVIATION_PERSONAL_DATA_REFUSAL);
        // A near miss or an accident is closed only with its investigation (server-enforced).
        const refusal = value.status === "DONE" ? deviationCloseRefusal({ ...incidentFields(value), action: value.action }) : null;
        if (refusal) throw new SelfInspectionError(409, refusal);
        // Avvikelse ↔ arbetsorder (2026-10-10): the link stays as it is, and closing by hand records who did it.
        const closing = manualStatusPatch({ ...current, status: current.status as typeof value.status, closedAt: iso(current.closedAt) }, value.status, actor, new Date().toISOString());
        await tx.selfInspectionDeviation.update({ where: { id: value.id }, data: { kind: value.kind, title: value.title, description: value.description, category: value.category, systematic: value.systematic,
          status: value.status, action: value.action, responsibleUserId: value.responsibleId, dueDate: value.dueDate, followUp: value.followUp, ...incident,
          // Allvarlighetsgrad: left out, the entry keeps its own; a Förbättring has none.
          ...(value.kind === "IMPROVEMENT" ? { severity: "NORMAL" } : value.severity ? { severity: value.severity } : {}),
          ...(isIncidentType(value.type) && value.serious ? {} : { reportedToAuthorityAt: null, reportedToAuthorityById: null }),
          closedAt: closing.closedAt ? new Date(closing.closedAt) : null, closedById: closing.closedById ?? null, closedByName: closing.closedByName ?? "" } });
        if (current.status === "DONE" && value.status !== "DONE") await logDeviation(tx, value.id, "deviation_reopened", "öppnades igen");
        return;
      }
      // Numbered per company (@@unique([organizationId, number])), under the company's lock taken above.
      const last = await tx.selfInspectionDeviation.findFirst({ where: { organizationId }, orderBy: { number: "desc" }, select: { number: true } });
      // A member's report starts open, without a responsible person or plan; the admin takes it from there.
      // The way back is the source link, so a closing "Från <protokollet>." is not kept in the text as well (simulation 2026-10-10).
      const sent = { ...value, description: withoutSourceNote(value.description, value.source) };
      const report = ctx.admin ? sent : { ...sent, kind: "DEVIATION" as const, status: "OPEN" as const, action: "", responsibleId: null, dueDate: "" as const, followUp: "", systematic: false };
      // A row taken from a protocol (etapp 2) keeps its way back; the protocol must be one the person can read.
      const source = value.source ? await workTarget(ctx, { taskId: value.source.taskId }, "read").then(() => value.source) : null;
      const now = new Date().toISOString();
      const opened = manualStatusPatch({ status: "OPEN", action: "", closedAt: null }, report.status, actor, now);
      // A row that already has a work order: the entry starts linked to it – Pågår, or Åtgärdad when the order is finished.
      const order = source?.rowId ? await cloudOrderForRow(tx, organizationId, { taskId: source.taskId, rowId: source.rowId }) : null;
      const refusal = report.status === "DONE" ? deviationCloseRefusal({ ...incidentFields(value), action: report.action }) : null;
      if (refusal) throw new SelfInspectionError(409, refusal);
      const linked = order ? newEntryPatch({ status: report.status, action: report.action, closedAt: opened.closedAt ?? null, ...incidentFields(value) }, order, actor, now) : {};
      const closedAt = linked.closedAt ?? opened.closedAt;
      const created = await tx.selfInspectionDeviation.create({ data: { organizationId, programId: logProgramId, number: (last?.number ?? 0) + 1, kind: report.kind, title: report.title, description: report.description,
        category: report.category, systematic: report.systematic, status: linked.status ?? report.status, action: linked.action ?? report.action, responsibleUserId: report.responsibleId, dueDate: report.dueDate, followUp: report.followUp,
        reportedById: actorId, closedAt: closedAt ? new Date(closedAt) : null, closedById: linked.closedById ?? opened.closedById ?? null, closedByName: linked.closedByName ?? opened.closedByName ?? "",
        workOrderId: linked.workOrderId ?? null, sourceTaskId: source?.taskId ?? null, sourceTitle: source?.title ?? "", sourceRowId: source?.rowId ?? "", ...incident,
        severity: report.kind === "IMPROVEMENT" ? "NORMAL" : deviationSeverity(value.severity) }, select: { id: true } });
      createdDeviationId = created.id;
      return;
    }
    // Tillbud och olycksfall (2026-10-30): the handling of one entry by whoever may handle it (./incidents.ts mayHandleDeviation).
    if (input.action === "save_investigation" || input.action === "mark_deviation_done" || input.action === "reopen_deviation" || input.action === "mark_reported_to_authority" || input.action === "set_deviation_hold") {
      const current = await tx.selfInspectionDeviation.findFirst({ where: { id: input.id, organizationId } });
      const viewer = deviationViewerOf(ctx);
      const access = current ? { type: current.type, reportedById: current.reportedById, responsibleId: current.responsibleUserId } : null;
      // An entry the person may not read answers as one that does not exist.
      if (!current || !access || !mayReadDeviation(viewer, access)) throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
      if (!mayHandleDeviation(viewer, access)) throw new SelfInspectionError(403, "Du kan inte hantera den här avvikelsen.");
      // Spara tills vidare (2026-11-04, ./retention.ts): also after the names are gone, since the rest of the entry can still matter in a claim.
      if (input.action === "set_deviation_hold") {
        await tx.selfInspectionDeviation.update({ where: { id: current.id }, data: input.hold ? { retentionHoldAt: new Date(), retentionHoldById: actor.id } : { retentionHoldAt: null, retentionHoldById: null } });
        await logDeviation(tx, current.id, "deviation_retention_hold", input.hold ? "sparas tills vidare" : "följer lagringstiden igen");
        return;
      }
      if (current.personalDataRemovedAt) throw new SelfInspectionError(409, DEVIATION_PERSONAL_DATA_REFUSAL);
      const stored = { ...incidentRow(current), action: current.action };
      if (input.action === "save_investigation") {
        if (!isIncidentType(current.type)) throw new SelfInspectionError(400, "Utredningen hör till tillbud och olycksfall.");
        const next = { ...incidentFields({ ...input, type: deviationType(current.type) }), action: input.plan };
        if (current.status === "DONE") {
          const refusal = deviationCloseRefusal(next);
          if (refusal) throw new SelfInspectionError(409, refusal);
        }
        await tx.selfInspectionDeviation.update({ where: { id: current.id }, data: { ...storedIncident(next), action: next.action,
          ...(next.serious ? {} : { reportedToAuthorityAt: null, reportedToAuthorityById: null }) } });
        return;
      }
      if (input.action === "mark_deviation_done") {
        if (current.status === "DONE") throw new SelfInspectionError(409, "Avvikelsen är redan klar.");
        // What the dialog filled in is saved in the same write as the close (2026-11-02): both or neither.
        const merged = closedInvestigation(stored, input.investigation);
        const refusal = deviationCloseRefusal(merged);
        if (refusal) throw new SelfInspectionError(409, refusal);
        const filledIn = input.investigation && isIncidentType(current.type) ? { ...storedIncident(incidentFields({ ...merged, type: deviationType(current.type) })), action: merged.action } : {};
        // Keeps today's closedBy/closedAt (Avvikelse ↔ arbetsorder): who marked it, and when.
        await tx.selfInspectionDeviation.update({ where: { id: current.id }, data: { ...filledIn, status: "DONE", closedAt: new Date(), closedById: actor.id, closedByName: actor.name.slice(0, 160), doneNote: input.doneNote } });
        await logDeviation(tx, current.id, "deviation_done", "markerades klar");
        return;
      }
      if (input.action === "reopen_deviation") {
        if (current.status !== "DONE") throw new SelfInspectionError(409, "Avvikelsen är inte klar.");
        await tx.selfInspectionDeviation.update({ where: { id: current.id }, data: { status: current.workOrderId ? "IN_PROGRESS" : "OPEN", closedAt: null, closedById: null, closedByName: "" } });
        await logDeviation(tx, current.id, "deviation_reopened", "öppnades igen");
        return;
      }
      const refusal = reportToAuthorityRefusal(stored);
      if (refusal) throw new SelfInspectionError(409, refusal);
      // Workflow never reports anything itself: it keeps who said it was reported, and when.
      await tx.selfInspectionDeviation.update({ where: { id: current.id }, data: { reportedToAuthorityAt: new Date(), reportedToAuthorityById: actor.id } });
      await logDeviation(tx, current.id, "deviation_reported_to_authority", "markerades som anmäld till myndigheten");
      return;
    }
    // The protocol row is gone (2026-10-12): an untouched entry leaves the log, a handled one is kept and marked.
    if (input.action === "withdraw_deviation") {
      const current = await tx.selfInspectionDeviation.findFirst({ where: { id: input.id, organizationId }, select: { status: true, action: true, workOrderId: true, followUp: true, reportedById: true } });
      if (!current) throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
      if (!mayWithdraw(current, { id: actorId, admin: ctx.admin })) throw new SelfInspectionError(403, "Bara den som förde avvikelsen eller en administratör kan återkalla den.");
      if (!withdrawnDeviationKept({ ...current, status: current.status as ProgramDeviation["status"] })) {
        // Its photos go with it: the rows by the database's cascade, the bytes after the commit.
        removedFiles.push(...(await tx.selfInspectionDeviationAttachment.findMany({ where: { organizationId, deviationId: input.id }, select: { storagePath: true } })).map((file) => file.storagePath));
        await tx.selfInspectionDeviation.delete({ where: { id: input.id } });
      } else await tx.selfInspectionDeviation.update({ where: { id: input.id }, data: { followUp: withNoteOfWithdrawal(current.followUp) } });
      return;
    }

    // The draft: the person must have edited the revision that is stored.
    if (!locked || input.revision !== locked.revision) throw new SelfInspectionError(409, "Programmet har ändrats av någon annan. Ladda om och gör ändringen igen.");
    const bump = (data: Prisma.SelfInspectionProgramUpdateInput = {}) => tx.selfInspectionProgram.update({ where: { id: programId }, data: { ...data, revision: { increment: 1 }, updatedById: actorId } });
    // Who may do what follows a person's roles (their level), so every change of a person's roles is logged (administrationshistoriken).
    const logRoles = async (userId: string) => {
      const [user, held] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
        tx.selfInspectionRoleMember.findMany({ where: { organizationId, userId, role: { programId } }, select: { role: { select: { name: true, level: true } } } }),
      ]);
      const level = Math.max(0, ...held.map((item) => item.role.level));
      await tx.administrationEvent.create({ data: { actorId, organizationId, action: "person_roles_changed",
        detail: `${user?.name?.trim() || user?.email || "En person"} har nu ${held.length ? `rollerna ${held.map((item) => item.role.name).join(", ")} (nivå ${level})` : "ingen roll"}.` } });
    };
    if (input.action === "save_program") {
      const existing = await tx.selfInspectionSection.findMany({ where: { programId, organizationId }, select: { id: true } });
      const known = new Set(existing.map((section) => section.id));
      for (const section of input.sections) if (section.id && !known.has(section.id)) throw new SelfInspectionError(404, "Ett avsnitt hittades inte. Ladda om sidan.");
      const kept = new Set(input.sections.flatMap((section) => section.id ? [section.id] : []));
      await tx.selfInspectionSection.deleteMany({ where: { programId, organizationId, id: { notIn: [...kept] } } });
      for (const [sortOrder, section] of input.sections.entries()) {
        if (section.id) await tx.selfInspectionSection.update({ where: { id: section.id }, data: { title: section.title, body: section.body, legalRef: section.legalRef, sortOrder } });
        else await tx.selfInspectionSection.create({ data: { organizationId, programId, key: "", title: section.title, body: section.body, legalRef: section.legalRef, sortOrder } });
      }
      await bump({ title: input.title, activityTypes: [...new Set(input.activityTypes)], worksOnOthersInstallations: input.worksOnOthersInstallations, registrationCheckedAt: input.registrationCheckedAt });
      return;
    }
    if (input.action === "save_role") {
      const role = input.role;
      if (role.id) {
        const before = role.level ? await tx.selfInspectionRole.findFirst({ where: { id: role.id, programId, organizationId }, select: { level: true } }) : null;
        const changed = await tx.selfInspectionRole.updateMany({ where: { id: role.id, programId, organizationId }, data: { name: role.name, description: role.description, duties: role.duties, isEre: role.isEre, capabilities: role.capabilities, ...(role.level ? { level: role.level } : {}) } });
        if (!changed.count) throw new SelfInspectionError(404, "Rollen hittades inte.");
        // Who may do what changes with a level, so it is logged (administrationshistoriken).
        if (before && role.level && before.level !== role.level)
          await tx.administrationEvent.create({ data: { actorId, organizationId, action: "role_level_changed", detail: `Rollen ${role.name} fick nivå ${role.level} (var ${before.level}).` } });
        // An ERE flag taken away also takes away who stands in the registration.
        if (!role.isEre) await tx.selfInspectionRoleMember.updateMany({ where: { roleId: role.id, organizationId }, data: { registered: false } });
      } else {
        const roles = await tx.selfInspectionRole.findMany({ where: { programId, organizationId }, select: { name: true, sortOrder: true } });
        if (roles.some((item) => item.name.toLocaleLowerCase("sv") === role.name.toLocaleLowerCase("sv"))) throw new SelfInspectionError(409, "Det finns redan en roll med det namnet.");
        await tx.selfInspectionRole.create({ data: { organizationId, programId, key: "", name: role.name, description: role.description, duties: role.duties, isEre: role.isEre, capabilities: role.capabilities, level: role.level ?? 1,
          sortOrder: roles.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1 } });
      }
      await bump();
      return;
    }
    if (input.action === "remove_role") {
      const removed = await tx.selfInspectionRole.deleteMany({ where: { id: input.roleId, programId, organizationId } });
      if (!removed.count) throw new SelfInspectionError(404, "Rollen hittades inte.");
      await bump();
      return;
    }
    if (input.action === "assign_role") {
      const role = await tx.selfInspectionRole.findFirst({ where: { id: input.roleId, programId, organizationId }, select: { id: true, isEre: true } });
      if (!role) throw new SelfInspectionError(404, "Rollen hittades inte.");
      if (!input.personId) throw new SelfInspectionError(400, "Välj en person i företaget.");
      await requireActivePerson(tx, organizationId, input.personId);
      const data = { authorizationLevel: input.authorizationLevel, authorizationNumber: input.authorizationNumber, registered: role.isEre && input.registered };
      await tx.selfInspectionRoleMember.upsert({ where: { roleId_userId: { roleId: role.id, userId: input.personId } }, create: { organizationId, roleId: role.id, userId: input.personId, ...data }, update: data });
      await bump();
      await logRoles(input.personId);
      return;
    }
    if (input.action === "set_person_roles") {
      if (!input.personId) throw new SelfInspectionError(400, "Välj en person i företaget.");
      await requireActivePerson(tx, organizationId, input.personId);
      const roles = await tx.selfInspectionRole.findMany({ where: { programId, organizationId }, select: { id: true } });
      const known = new Set(roles.map((role) => role.id));
      for (const roleId of input.roleIds) if (!known.has(roleId)) throw new SelfInspectionError(404, "Rollen hittades inte.");
      const wanted = [...new Set(input.roleIds)];
      // Exactly these roles: the ones the person lost go, the new ones are added; the rest keep their details.
      await tx.selfInspectionRoleMember.deleteMany({ where: { organizationId, userId: input.personId, role: { programId }, roleId: { notIn: wanted } } });
      if (wanted.length) await tx.selfInspectionRoleMember.createMany({ data: wanted.map((roleId) => ({ organizationId, roleId, userId: input.personId! })), skipDuplicates: true });
      await bump();
      await logRoles(input.personId);
      return;
    }
    if (input.action === "unassign_role") {
      const removed = await tx.selfInspectionRoleMember.deleteMany({ where: { roleId: input.roleId, userId: input.personId, organizationId, role: { programId } } });
      if (!removed.count) throw new SelfInspectionError(404, "Personen har inte rollen.");
      await bump();
      await logRoles(input.personId);
      return;
    }
    if (input.action === "save_competence") {
      const value = input.competence;
      await requireActivePerson(tx, organizationId, value.personId);
      const data = { workTypes: [...new Set(value.workTypes)], scope: value.scope, assessment: value.assessment, assessedAt: value.assessedAt, limitations: value.limitations, supervised: value.supervised };
      await tx.selfInspectionCompetence.upsert({ where: { programId_userId: { programId, userId: value.personId } }, create: { organizationId, programId, userId: value.personId, ...data }, update: data });
      await bump();
      return;
    }
    if (input.action === "remove_competence") {
      const removed = await tx.selfInspectionCompetence.deleteMany({ where: { programId, organizationId, userId: input.personId } });
      if (!removed.count) throw new SelfInspectionError(404, "Personen har inga kompetensuppgifter i programmet.");
      await bump();
      return;
    }
    // approve: a new version from the draft as stored, never changed afterwards (a trigger refuses updates). The
    // people's names and competence are frozen in it, so later register changes never alter the version (2026-10-06), and
    // the names stay there after a person leaves or is erased – traceability, as the programme says (2026-10-09).
    const [doc, people] = await Promise.all([loadSelfInspectionDocument(organizationId, { id: actorId, admin: true }, tx), companyPeople(organizationId, tx)]);
    const names = new Map(people.all.map((person) => [person.id, person.name]));
    const content = programContent(doc.program!, names);
    const hash = await contentHash(content);
    const latest = doc.versions[0];
    if (latest && (await changeFingerprint(latest.content)) === (await changeFingerprint(content))) throw new SelfInspectionError(409, `Utkastet är oförändrat sedan version ${latest.number}.`);
    const number = (latest?.number ?? 0) + 1;
    await tx.selfInspectionVersion.create({ data: { organizationId, programId, number, content: content as unknown as Prisma.InputJsonValue, contentHash: hash, changeReason: input.changeReason, approvedById: actorId,
      approvedByName: (names.get(actorId) || ctx.user.name?.trim() || ctx.user.email).slice(0, 160) } });
    await tx.administrationEvent.create({ data: { actorId, organizationId, action: "self_inspection_approved", detail: `Egenkontrollprogrammet version ${number} fastställdes ${swedishDayKey(new Date())}.` } });
  });
  await removeStoredFiles(removedFiles);
  return createdDeviationId ? { createdDeviationId } : {};
}
