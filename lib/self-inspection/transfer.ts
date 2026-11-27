import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ACTIVITY_TYPES, cardContentSchema, type SelfInspectionDocument } from "./model";
import { deviationSeverity, incidentFields, isIncidentType } from "./incidents";
import { isRiskClassKey } from "./levels";
import { riskClassKeyExists } from "./levels-server";
import { companyPeople, loadSelfInspectionDocument } from "./server";

/**
 * Egenkontroll in Cloud export and re-import (etapp 2, 2026-10-06). The export writes the programme into the
 * .hwf file as Local keeps it: people named, the exporting person as the file's owner (Local knows them by e-mail), and
 * projects, tasks and customers under the file's ids. The re-import never overwrites Cloud: a programme comes back only
 * when Cloud has none, and otherwise only what the file added (deviations, reviews, instruments, competence lines,
 * risk classes and the kind of work per assignment that Cloud lacks). Roles carry their level. A customer's special
 * requirements are a field on the customer (2026-10-07) and follow the customers (lib/kfid/cloud-import.ts).
 */
type Ids = { customers: Map<string, string>; projects: Map<string, string>; tasks: Map<string, string> };
type Db = Prisma.TransactionClient | typeof prisma;

/** Replaces every string equal to `from` with `to`, deep (ids are unique, so nothing else matches). */
function replaceId<T>(value: T, from: string, to: string): T {
  if (value === from) return to as T;
  if (Array.isArray(value)) return value.map((item) => replaceId(item, from, to)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceId(item, from, to)])) as T;
  return value;
}

export async function selfInspectionForExport(input: { organizationId: string; user: { id: string; email: string }; ids: Ids }): Promise<SelfInspectionDocument> {
  const { organizationId } = input;
  const [doc, people, assignments, cardVersions] = await Promise.all([
    loadSelfInspectionDocument(organizationId, { id: input.user.id, admin: true }),
    companyPeople(organizationId),
    prisma.selfInspectionAssignment.findMany({ where: { organizationId }, take: 5000 }),
    // Kompetenskort v2: the cards' versions travel with the cards (the latest ones), so the history is in the file too.
    prisma.selfInspectionCompetenceCardVersion.findMany({ where: { organizationId, card: { leftAt: null } }, orderBy: { number: "desc" }, take: 5000 }),
  ]);
  const names = new Map(people.all.map((person) => [person.id, person.name]));
  const name = (id: string | null | undefined, kept = "") => (id && names.get(id)) || kept;
  const program = doc.program ? {
    ...doc.program, customerId: null,
    roles: doc.program.roles.map((role) => ({ ...role, members: role.members.map((member) => ({ ...member, name: name(member.personId, member.name) })) })),
    people: doc.program.people.map((person) => ({ ...person, name: name(person.personId, person.name) })),
  } : null;
  const named: SelfInspectionDocument = {
    program,
    // The name kept at approval goes first (traceability, 2026-10-09); older versions read it from the person.
    versions: doc.versions.map((version) => ({ ...version, approvedByName: version.approvedByName || name(version.approvedById) })),
    confirmations: doc.confirmations.map((item) => ({ ...item, name: name(item.personId, item.name) })),
    reviews: doc.reviews.map((item) => ({ ...item, reviewedByName: name(item.reviewedById, item.reviewedByName) })),
    deviations: doc.deviations.map((item) => ({ ...item, responsibleName: name(item.responsibleId, item.responsibleName), reportedByName: name(item.reportedById, item.reportedByName),
      source: item.source ? { ...item.source, taskId: input.ids.tasks.get(item.source.taskId) ?? item.source.taskId } : null,
      // Avvikelse ↔ arbetsorder (2026-10-10): the link travels only with a work order that is in the same file.
      workOrderId: item.workOrderId ? input.ids.tasks.get(item.workOrderId) ?? null : null,
      // Photos stay in Cloud (a Local file keeps no bytes); who marked it reported travels by name.
      attachments: undefined, reportedToAuthorityByName: name(item.reportedToAuthorityById, item.reportedToAuthorityByName ?? "") })),
    assignments: assignments.flatMap((item) => {
      const targetId = item.taskId ? input.ids.tasks.get(item.taskId) : item.projectId ? input.ids.projects.get(item.projectId) : undefined;
      return targetId ? [{ id: item.id, target: item.taskId ? "task" as const : "project" as const, targetId, performerId: item.performerUserId, performerName: name(item.performerUserId),
        inspectorId: item.inspectorUserId, inspectorName: name(item.inspectorUserId),
        activityType: ACTIVITY_TYPES.find((type) => type.key === item.activityType)?.key ?? null, updatedAt: item.updatedAt.toISOString() }] : [];
    }),
    // The customers' special requirements travel on the customers themselves (2026-10-07), not in the programme.
    customerRequirements: [],
    // The card of a person who left is kept in Cloud for three months and then deleted; it never goes into a file that
    // outlives that. Attached certificates stay in Cloud's private storage and are not part of the file.
    credentials: doc.credentials.filter((item) => !item.leftAt).map((item) => ({ ...item, name: name(item.personId, item.name), leftAt: null, files: [] })),
    // Kompetenskort v2 (2026-10-08): groups, the rest of the cards of members and their versions; never a card kept after leaving.
    competenceGroups: doc.competenceGroups,
    competenceCards: doc.competenceCards.filter((card) => !card.leftAt).map((card) => ({ ...card, name: name(card.personId, card.name) })),
    cardVersions: cardVersions.flatMap((row) => {
      const content = cardContentSchema.safeParse(row.content);
      return content.success ? [{ id: row.id, personId: row.userId, number: row.number, content: content.data, change: row.change, savedById: row.savedById, savedByName: name(row.savedById), savedAt: row.savedAt.toISOString() }] : [];
    }),
    instruments: doc.instruments,
    riskClasses: doc.riskClasses,
    // Ny struktur (2026-11-24): the company's experience areas and its hired staff (an account link stays in Cloud).
    experienceAreas: doc.experienceAreas ?? [],
    externalPeople: (doc.externalPeople ?? []).map((person) => ({ ...person, userId: null })),
  };
  // Local knows its owner by e-mail. An approved version keeps its content exactly, so its checksum still holds.
  const local = replaceId(named, input.user.id, input.user.email);
  return { ...local, versions: local.versions.map((version, index) => ({ ...version, content: named.versions[index].content })) };
}

/** Inside the re-import's transaction; `ids` map the file's ids to Cloud's. Answers the entries it had to create, by the file's id. */
export async function importSelfInspection(tx: Prisma.TransactionClient, input: { organizationId: string; userId: string; doc: SelfInspectionDocument | undefined; ids: Ids }) {
  const createdDeviations = new Map<string, string>();
  const doc = input.doc;
  if (!doc) return { createdDeviations };
  const { organizationId, userId } = input;
  const members = await tx.organizationMember.findMany({ where: { organizationId, isActive: true }, select: { userId: true, user: { select: { email: true } } } });
  const byEmail = new Map(members.map((member) => [member.user.email.toLowerCase(), member.userId]));
  const active = new Set(members.map((member) => member.userId));
  // A person in the file is a Cloud member by id, or by e-mail (the file's owner); anyone else is left out.
  const person = (id: string | null | undefined) => !id ? null : active.has(id) ? id : byEmail.get(id.toLowerCase()) ?? null;
  const db: Db = tx;

  let program = await db.selfInspectionProgram.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey: "company" } }, select: { id: true } });
  if (!program && doc.program) {
    const draft = doc.program;
    program = await db.selfInspectionProgram.create({ data: { organizationId, scopeKey: "company", title: draft.title, templateVersion: draft.templateVersion, activityTypes: draft.activityTypes,
      worksOnOthersInstallations: draft.worksOnOthersInstallations, registrationCheckedAt: draft.registrationCheckedAt, createdById: userId, updatedById: userId }, select: { id: true } });
    const programId = program.id;
    await db.selfInspectionSection.createMany({ data: draft.sections.map((section) => ({ organizationId, programId, key: section.key, title: section.title, body: section.body, legalRef: section.legalRef, sortOrder: section.sortOrder })) });
    for (const role of draft.roles) {
      const created = await db.selfInspectionRole.create({ data: { organizationId, programId, key: role.key, name: role.name, description: role.description, duties: role.duties, isEre: role.isEre,
        capabilities: role.capabilities, level: role.level, sortOrder: role.sortOrder }, select: { id: true } });
      const roleMembers = role.members.flatMap((member) => { const id = person(member.personId); return id ? [{ organizationId, roleId: created.id, userId: id, authorizationLevel: member.authorizationLevel,
        authorizationNumber: member.authorizationNumber, registered: role.isEre && member.registered }] : []; });
      if (roleMembers.length) await db.selfInspectionRoleMember.createMany({ data: roleMembers, skipDuplicates: true });
    }
    const competence = draft.people.flatMap((item) => { const id = person(item.personId); return id ? [{ organizationId, programId, userId: id, workTypes: item.workTypes, scope: item.scope,
      assessment: item.assessment, assessedAt: item.assessedAt, limitations: item.limitations, supervised: item.supervised }] : []; });
    if (competence.length) await db.selfInspectionCompetence.createMany({ data: competence, skipDuplicates: true });
    // Approved versions are documentation: they come back as they were (their content holds the frozen names).
    for (const version of [...doc.versions].sort((a, b) => a.number - b.number))
      await db.selfInspectionVersion.create({ data: { organizationId, programId, number: version.number, content: version.content as unknown as Prisma.InputJsonValue, contentHash: version.hash,
        changeReason: version.changeReason, approvedById: person(version.approvedById) ?? version.approvedById, approvedByName: version.approvedByName.slice(0, 160), approvedAt: new Date(version.approvedAt) } });
    await db.administrationEvent.create({ data: { actorId: userId, organizationId, action: "self_inspection_imported", detail: "Egenkontrollprogrammet lästes in från en lokal arbetsyta." } });
  }

  // Avvikelser (2026-10-30): the log is the company's and comes back with or without a programme, numbered per company.
  {
    const programId = program?.id ?? null;
    const knownDeviations = await db.selfInspectionDeviation.findMany({ where: { organizationId, id: { in: doc.deviations.map((item) => item.id) } }, select: { id: true } });
    const seenDeviations = new Set(knownDeviations.map((item) => item.id));
    let number = (await db.selfInspectionDeviation.findFirst({ where: { organizationId }, orderBy: { number: "desc" }, select: { number: true } }))?.number ?? 0;
    // Avvikelse ↔ arbetsorder (2026-10-10): a link is kept when its work order came in with the same import, else dropped.
    const fileOrders = [...new Set(doc.deviations.flatMap((item) => item.workOrderId && input.ids.tasks.has(item.workOrderId) ? [input.ids.tasks.get(item.workOrderId)!] : []))];
    const orders = new Set(fileOrders.length ? (await db.workflowTask.findMany({ where: { organizationId, kind: "WORK_ORDER", id: { in: fileOrders } }, select: { id: true } })).map((order) => order.id) : []);
    for (const item of [...doc.deviations].sort((a, b) => a.number - b.number)) {
      if (seenDeviations.has(item.id)) continue;
      const sourceTaskId = item.source ? input.ids.tasks.get(item.source.taskId) ?? null : null;
      const workOrderId = item.workOrderId ? input.ids.tasks.get(item.workOrderId) ?? null : null;
      const created = await db.selfInspectionDeviation.create({ select: { id: true }, data: { organizationId, programId, number: ++number, kind: item.kind, title: item.title, description: item.description, category: item.category,
        systematic: item.systematic, status: item.status, action: item.action, responsibleUserId: person(item.responsibleId), dueDate: item.dueDate, followUp: item.followUp,
        reportedById: person(item.reportedById) ?? userId, closedAt: item.closedAt ? new Date(item.closedAt) : null, sourceTaskId,
        workOrderId: workOrderId && orders.has(workOrderId) ? workOrderId : null, closedById: person(item.closedById), closedByName: (item.closedByName ?? "").slice(0, 160), sourceTitle: sourceTaskId ? item.source?.title ?? "" : "", sourceRowId: sourceTaskId ? item.source?.rowId ?? "" : "",
        // Tillbud och olycksfall (2026-10-30): the type and the investigation come back with the entry.
        ...incidentFields({ ...item, type: item.type ?? "SELF_INSPECTION" }), occurredAt: isIncidentType(item.type) && item.occurredAt ? new Date(item.occurredAt) : null, doneNote: item.doneNote ?? "", severity: deviationSeverity(item.severity),
        reportedToAuthorityAt: isIncidentType(item.type) && item.serious && item.reportedToAuthorityAt ? new Date(item.reportedToAuthorityAt) : null, reportedToAuthorityById: isIncidentType(item.type) && item.serious ? person(item.reportedToAuthorityById) : null } });
      createdDeviations.set(item.id, created.id);
    }
  }
  if (program) {
    const programId = program.id;
    const knownReviews = await db.selfInspectionReview.findMany({ where: { organizationId, programId, id: { in: doc.reviews.map((item) => item.id) } }, select: { id: true } });
    const seenReviews = new Set(knownReviews.map((item) => item.id));
    const reviews = doc.reviews.filter((item) => !seenReviews.has(item.id));
    if (reviews.length) await db.selfInspectionReview.createMany({ data: reviews.map((item) => ({ organizationId, programId, reviewedAt: item.reviewedAt, reviewedById: person(item.reviewedById) ?? userId,
      versionNumber: item.versionNumber, registrationChecked: item.registrationChecked, deviationsReviewed: item.deviationsReviewed, competenceFollowed: item.competenceFollowed, outcome: item.outcome, notes: item.notes })) });
  }

  const [instruments, credentials] = await Promise.all([
    db.instrument.findMany({ where: { organizationId, id: { in: doc.instruments.map((item) => item.id) } }, select: { id: true } }),
    db.selfInspectionCredential.findMany({ where: { organizationId, id: { in: doc.credentials.map((item) => item.id) } }, select: { id: true } }),
  ]);
  const seenInstruments = new Set(instruments.map((item) => item.id));
  const newInstruments = doc.instruments.filter((item) => !seenInstruments.has(item.id));
  if (newInstruments.length) await db.instrument.createMany({ data: newInstruments.map((item) => ({ organizationId, name: item.name, serialNumber: item.serialNumber, calibratedAt: item.calibratedAt,
    nextCalibrationAt: item.nextCalibrationAt, note: item.note, isActive: item.active })) });
  // The company's risk classes: only the task types Cloud has no class for, and only types Cloud knows.
  const classes = Object.entries(doc.riskClasses ?? {}).filter(([key, value]) => isRiskClassKey(key) && Number.isInteger(value) && value >= 1 && value <= 3);
  if (classes.length) {
    const have = new Set((await db.taskRiskClass.findMany({ where: { organizationId, key: { in: classes.map(([key]) => key) } }, select: { key: true } })).map((item) => item.key));
    for (const [key, riskClass] of classes) {
      if (have.has(key) || !(await riskClassKeyExists(organizationId, key, db))) continue;
      await db.taskRiskClass.create({ data: { organizationId, key, riskClass, updatedById: userId } });
    }
  }
  const seenCredentials = new Set(credentials.map((item) => item.id));
  const newCredentials = doc.credentials.flatMap((item) => { const id = person(item.personId); return id && !seenCredentials.has(item.id) ? [{ organizationId, userId: id, title: item.title, provider: item.provider ?? "", issuedAt: item.issuedAt, validUntil: item.validUntil, note: item.note }] : []; });
  if (newCredentials.length) await db.selfInspectionCredential.createMany({ data: newCredentials });
  // Kompetenskort v2 (2026-10-08): groups Cloud lacks (by name), and the rest of a card only for a member who has none in
  // Cloud yet – with the file's versions. A card in Cloud is never overwritten.
  const cloudGroups = await db.selfInspectionCompetenceGroup.findMany({ where: { organizationId }, select: { id: true, name: true, sortOrder: true } });
  const groupIds = new Map<string, string>();
  let sortOrder = cloudGroups.reduce((max, group) => Math.max(max, group.sortOrder), -1);
  for (const group of doc.competenceGroups ?? []) {
    const same = cloudGroups.find((item) => item.name.toLocaleLowerCase("sv") === group.name.toLocaleLowerCase("sv"));
    if (same) { groupIds.set(group.id, same.id); continue; }
    if (cloudGroups.length + groupIds.size >= 100) break;
    const created = await db.selfInspectionCompetenceGroup.create({ data: { organizationId, name: group.name, description: group.description, sortOrder: ++sortOrder }, select: { id: true, name: true, sortOrder: true } });
    cloudGroups.push(created);
    groupIds.set(group.id, created.id);
  }
  const fileCards = (doc.competenceCards ?? []).flatMap((card) => { const id = person(card.personId); return id && !card.leftAt ? [{ card, userId: id }] : []; });
  const haveCards = new Set((await db.selfInspectionCompetenceCard.findMany({ where: { organizationId, userId: { in: fileCards.map((item) => item.userId) } }, select: { userId: true } })).map((item) => item.userId));
  for (const { card, userId: cardUser } of fileCards) {
    if (haveCards.has(cardUser)) continue;
    haveCards.add(cardUser);
    const versions = (doc.cardVersions ?? []).filter((item) => item.personId === card.personId).sort((a, b) => a.number - b.number);
    await db.selfInspectionCompetenceCard.create({ data: { organizationId, userId: cardUser, licenceClasses: card.licenceClasses, licenceValidUntil: card.licenceValidUntil,
      languages: card.languages as unknown as Prisma.InputJsonValue, revision: versions.reduce((max, item) => Math.max(max, item.number), 0) } });
    const places = [...new Set(card.groupIds.flatMap((groupId) => groupIds.has(groupId) ? [groupIds.get(groupId)!] : []))];
    if (places.length) await db.selfInspectionCompetenceGroupMember.createMany({ data: places.map((groupId) => ({ organizationId, groupId, userId: cardUser })), skipDuplicates: true });
    if (versions.length) await db.selfInspectionCompetenceCardVersion.createMany({ data: versions.map((item) => ({ organizationId, userId: cardUser, number: item.number,
      content: item.content as unknown as Prisma.InputJsonValue, change: item.change, savedById: person(item.savedById) ?? userId, savedAt: new Date(item.savedAt) })), skipDuplicates: true });
  }
  for (const item of doc.assignments) {
    const taskId = item.target === "task" ? input.ids.tasks.get(item.targetId) : undefined;
    const projectId = item.target === "project" ? input.ids.projects.get(item.targetId) : undefined;
    if (!taskId && !projectId) continue;
    const exists = await db.selfInspectionAssignment.findFirst({ where: { organizationId, ...(taskId ? { taskId } : { projectId }) }, select: { id: true } });
    if (exists) continue;
    await db.selfInspectionAssignment.create({ data: { organizationId, taskId: taskId ?? null, projectId: projectId ?? null, performerUserId: person(item.performerId), inspectorUserId: person(item.inspectorId),
      activityType: item.activityType, updatedById: userId } });
  }
  return { createdDeviations };
}
