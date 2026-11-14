import {
  actionNeedsAdmin, cardChanged, changeFingerprint, contentHash, documentCardContent, latestVersion, LOCAL_CARD_VERSIONS, mayWithdraw, peopleOverview, programContent, selfInspectionActionSchema, SelfInspectionError,
  withdrawnDeviationKept, withNoteOfWithdrawal, type CompetenceCard, type ProgramDeviation, type SelfInspectionAction, type SelfInspectionDocument,
} from "./model";
import { programFromTemplate } from "./template";
import { manualStatusPatch, newEntryInDocument, withoutSourceNote, type DeviationOrderFacts, type DeviationRow } from "./deviation-link";
import { closedInvestigation, deviationCloseRefusal, deviationSeverity, deviationType, incidentFields, incidentResponsibleRefusal, isIncidentType, mayHandleDeviation, mayReadDeviation, reportToAuthorityRefusal } from "./incidents";

/**
 * The self-inspection programme kept as one document: the Local .hwf file and the demo apply every change here, with
 * the same rules as Cloud's tables (lib/self-inspection/server.ts). Pure – returns a new document, never mutates.
 */
export type DocumentActor = { id: string; name: string; admin: boolean; /** The Teamet right (a near miss or an accident, ./incidents.ts). */ team?: boolean };

const LEFT = "Personen har lämnat företaget. Kompetenskortet kan inte ändras, bara tas bort.";
const hasLeft = (doc: SelfInspectionDocument, personId: string) =>
  Boolean((doc.competenceCards ?? []).find((card) => card.personId === personId)?.leftAt || (doc.credentials ?? []).some((item) => item.personId === personId && item.leftAt));
const emptyCard = (personId: string, name: string, now: string): CompetenceCard => ({ personId, name, groupIds: [], licenceClasses: [], licenceValidUntil: null, languages: [],
  suggestion: "", suggestedAt: null, revision: 0, leftAt: null, createdAt: now, updatedAt: now });
/** What a save of the card's other parts changed, in a few words for the history. */
export function cardChangeText(before: Pick<CompetenceCard, "groupIds" | "licenceClasses" | "licenceValidUntil" | "languages"> | undefined, after: Pick<CompetenceCard, "groupIds" | "licenceClasses" | "licenceValidUntil" | "languages">) {
  const parts = [
    JSON.stringify([...(before?.groupIds ?? [])].sort()) !== JSON.stringify([...after.groupIds].sort()) ? "kompetensgrupper" : "",
    JSON.stringify([before?.licenceClasses ?? [], before?.licenceValidUntil ?? null]) !== JSON.stringify([after.licenceClasses, after.licenceValidUntil]) ? "körkort" : "",
    JSON.stringify(before?.languages ?? []) !== JSON.stringify(after.languages) ? "språk" : "",
  ].filter(Boolean);
  return parts.length ? `Ändrat: ${parts.join(", ")}` : "Kortet sparat";
}

/**
 * Every save of a card keeps a version of the whole card (kompetenskort v2, 2026-10-08) – unless the save changed
 * nothing, or the person has left (their card is kept as it was). A Local file keeps the latest LOCAL_CARD_VERSIONS per person.
 */
export function withCardVersion(doc: SelfInspectionDocument, personId: string, input: { name: string; change: string; actor: DocumentActor; now: string; newId: () => string }): SelfInspectionDocument {
  if (hasLeft(doc, personId)) return doc;
  const content = documentCardContent(doc, personId);
  const versions = doc.cardVersions ?? [];
  const mine = versions.filter((item) => item.personId === personId).sort((a, b) => b.number - a.number);
  if (!cardChanged(mine[0]?.content, content)) return doc;
  const cards = doc.competenceCards ?? [];
  const card = cards.find((item) => item.personId === personId);
  const number = Math.max(card?.revision ?? 0, mine[0]?.number ?? 0) + 1;
  const nextCard = { ...(card ?? emptyCard(personId, input.name, input.now)), revision: number, updatedAt: input.now };
  const version = { id: input.newId(), personId, number, content, change: input.change.slice(0, 200), savedById: input.actor.id, savedByName: input.actor.name, savedAt: input.now };
  return { ...doc, competenceCards: card ? cards.map((item) => item.personId === personId ? nextCard : item) : [...cards, nextCard],
    cardVersions: [...versions.filter((item) => item.personId !== personId), ...[version, ...mine].slice(0, LOCAL_CARD_VERSIONS)] };
}

export async function applySelfInspectionAction(
  doc: SelfInspectionDocument,
  raw: SelfInspectionAction,
  actor: DocumentActor,
  options: { now?: Date; newId?: () => string; people?: { id: string; name: string }[]; namedPeople?: boolean;
    /** Avvikelse ↔ arbetsorder (2026-10-10): the work order made from a protocol row, read from the file or the demo. */
    orderForRow?: (row: DeviationRow) => DeviationOrderFacts | null;
    /** The demo: a person's rights, for who may be Ansvarig for a near miss or an accident (./incidents.ts). */
    memberRights?: (personId: string) => { admin: boolean; team: boolean } | null } = {},
): Promise<SelfInspectionDocument> {
  const input = selfInspectionActionSchema.parse(raw);
  const now = (options.now ?? new Date()).toISOString();
  const newId = options.newId ?? (() => crypto.randomUUID());
  if (actionNeedsAdmin(input) && !actor.admin) throw new SelfInspectionError(403, "Bara företagets administratör kan ändra egenkontrollprogrammet.");

  if (input.action === "create_program") {
    if (doc.program) throw new SelfInspectionError(409, "Företaget har redan ett egenkontrollprogram.");
    return { ...doc, program: programFromTemplate({ id: newId(), now, newId }) };
  }
  if (input.action === "confirm_read") {
    const latest = latestVersion(doc);
    if (!latest || latest.number !== input.versionNumber) throw new SelfInspectionError(409, "Det finns en nyare version av programmet. Läs den och bekräfta igen.");
    if (doc.confirmations.some((item) => item.versionId === latest.id && item.personId === actor.id)) return doc;
    return { ...doc, confirmations: [...doc.confirmations, { versionId: latest.id, personId: actor.id, name: actor.name, confirmedAt: now }] };
  }
  if (input.action === "add_review") {
    const latest = latestVersion(doc);
    return { ...doc, reviews: [...doc.reviews, { id: newId(), ...input.review, reviewedById: actor.id, reviewedByName: actor.name, versionNumber: latest?.number ?? null, createdAt: now }] };
  }
  if (input.action === "save_deviation") {
    const value = input.deviation;
    const responsibleName = value.responsibleId ? options.people?.find((person) => person.id === value.responsibleId)?.name ?? "" : "";
    if (value.responsibleId && options.people && !options.people.some((person) => person.id === value.responsibleId)) throw new SelfInspectionError(400, "Den ansvariga finns inte bland företagets personer.");
    const responsibleRefusal = options.memberRights ? incidentResponsibleRefusal(value.type, value.responsibleId, value.responsibleId ? options.memberRights(value.responsibleId) : null) : null;
    if (responsibleRefusal) throw new SelfInspectionError(400, responsibleRefusal);
    if (value.id) {
      const current = doc.deviations.find((item) => item.id === value.id);
      if (!current) throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
      // Tillbud och olycksfall (2026-10-30): closed only with the investigation.
      const refusal = value.status === "DONE" ? deviationCloseRefusal({ ...incidentFields(value), action: value.action }) : null;
      if (refusal) throw new SelfInspectionError(409, refusal);
      // Avvikelse ↔ arbetsorder (2026-10-10): the link stays as it is, and closing by hand records who did it.
      const next: ProgramDeviation = { ...current, ...value, ...incidentFields(value), severity: value.kind === "IMPROVEMENT" ? "NORMAL" : value.severity ?? deviationSeverity(current.severity), id: current.id, source: current.source, responsibleName, updatedAt: now, ...manualStatusPatch(current, value.status, actor, now),
        ...(isIncidentType(value.type) && value.serious ? {} : { reportedToAuthorityAt: null, reportedToAuthorityById: null, reportedToAuthorityByName: "" }) };
      return { ...doc, deviations: doc.deviations.map((item) => item.id === current.id ? next : item) };
    }
    // A member's report starts open, without a responsible person or plan; the admin takes it from there.
    // The way back is the source link, so a closing "Från <protokollet>." is not kept in the text as well (simulation 2026-10-10).
    const sent = { ...value, description: withoutSourceNote(value.description, value.source) };
    const report = actor.admin ? sent : { ...sent, kind: "DEVIATION" as const, status: "OPEN" as const, action: "", responsibleId: null, dueDate: "" as const, followUp: "", systematic: false };
    const refusal = report.status === "DONE" ? deviationCloseRefusal({ ...incidentFields(value), action: report.action }) : null;
    if (refusal) throw new SelfInspectionError(409, refusal);
    const number = doc.deviations.reduce((max, item) => Math.max(max, item.number), 0) + 1;
    const entry: ProgramDeviation = { ...report, ...incidentFields(value), severity: report.kind === "IMPROVEMENT" ? "NORMAL" : deviationSeverity(value.severity), id: newId(), number, responsibleName: actor.admin ? responsibleName : "", reportedById: actor.id, reportedByName: actor.name,
      createdAt: now, updatedAt: now, ...manualStatusPatch({ status: "OPEN", action: "", closedAt: null }, report.status, actor, now), source: value.source };
    // A row that already has a work order: the entry starts linked to it (Pågår, or Åtgärdad when the order is finished).
    const order = value.source?.rowId && options.orderForRow ? options.orderForRow({ taskId: value.source.taskId, rowId: value.source.rowId }) : null;
    return { ...doc, deviations: [...doc.deviations, newEntryInDocument(entry, order, actor, now)] };
  }
  // The protocol row is gone (2026-10-12): an untouched entry leaves the log, a handled one is kept and marked.
  if (input.action === "withdraw_deviation") {
    const current = doc.deviations.find((item) => item.id === input.id);
    if (!current) throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
    if (!mayWithdraw(current, actor)) throw new SelfInspectionError(403, "Bara den som förde avvikelsen eller en administratör kan återkalla den.");
    if (!withdrawnDeviationKept(current)) return { ...doc, deviations: doc.deviations.filter((item) => item.id !== current.id) };
    return { ...doc, deviations: doc.deviations.map((item) => item.id === current.id ? { ...item, followUp: withNoteOfWithdrawal(item.followUp), updatedAt: now } : item) };
  }
  // Lagringstiden (2026-11-04, ./retention.ts) is Cloud's: a Local file is the company's own and nothing clears it.
  if (input.action === "set_deviation_hold") throw new SelfInspectionError(400, "Spara tills vidare finns bara med serverlagring.");
  // Tillbud och olycksfall (2026-10-30): the handling of one entry, with the same rules as Cloud (./incidents.ts).
  if (input.action === "save_investigation" || input.action === "mark_deviation_done" || input.action === "reopen_deviation" || input.action === "mark_reported_to_authority") {
    const current = doc.deviations.find((item) => item.id === input.id);
    if (!current || !mayReadDeviation(actor, current)) throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
    if (!mayHandleDeviation(actor, current)) throw new SelfInspectionError(403, "Du kan inte hantera den här avvikelsen.");
    const put = (patch: Partial<ProgramDeviation>) => ({ ...doc, deviations: doc.deviations.map((item) => item.id === current.id ? { ...item, ...patch, updatedAt: now } : item) });
    if (input.action === "save_investigation") {
      if (!isIncidentType(current.type)) throw new SelfInspectionError(400, "Utredningen hör till tillbud och olycksfall.");
      const next = { ...incidentFields({ ...input, type: deviationType(current.type) }), action: input.plan };
      const refusal = current.status === "DONE" ? deviationCloseRefusal(next) : null;
      if (refusal) throw new SelfInspectionError(409, refusal);
      return put({ ...next, ...(next.serious ? {} : { reportedToAuthorityAt: null, reportedToAuthorityById: null, reportedToAuthorityByName: "" }) });
    }
    if (input.action === "mark_deviation_done") {
      if (current.status === "DONE") throw new SelfInspectionError(409, "Avvikelsen är redan klar.");
      const merged = closedInvestigation(current, input.investigation);
      const refusal = deviationCloseRefusal(merged);
      if (refusal) throw new SelfInspectionError(409, refusal);
      return put({ occurredAt: merged.occurredAt, whatHappened: merged.whatHappened, cause: merged.cause, action: merged.action, status: "DONE", closedAt: now, closedById: actor.id, closedByName: actor.name.slice(0, 160), doneNote: input.doneNote });
    }
    if (input.action === "reopen_deviation") {
      if (current.status !== "DONE") throw new SelfInspectionError(409, "Avvikelsen är inte klar.");
      return put({ status: current.workOrderId ? "IN_PROGRESS" : "OPEN", closedAt: null, closedById: null, closedByName: "" });
    }
    const refusal = reportToAuthorityRefusal(current);
    if (refusal) throw new SelfInspectionError(409, refusal);
    return put({ reportedToAuthorityAt: now, reportedToAuthorityById: actor.id, reportedToAuthorityByName: actor.name.slice(0, 160) });
  }
  // Etapp 2–3: registers beside the draft; they never change its revision or an approved version.
  if (input.action === "set_assignment") {
    if (!doc.program) throw new SelfInspectionError(404, "Företaget har inget egenkontrollprogram.");
    // Only the kind of work is chosen now (2026-10-07: roles are given in advance, with a level). A performer or an
    // inspector an older file holds stays as it was; nothing new is written to them.
    const all = doc.assignments ?? [];
    const rest = all.filter((item) => !(item.target === input.target && item.targetId === input.targetId));
    const current = all.find((item) => item.target === input.target && item.targetId === input.targetId);
    if (!current && !input.activityType) return doc;
    if (current && !input.activityType && !current.performerId && !current.inspectorId) return { ...doc, assignments: rest };
    return { ...doc, assignments: [...rest, { performerId: null, performerName: "", inspectorId: null, inspectorName: "", ...current, id: current?.id ?? newId(), target: input.target, targetId: input.targetId,
      activityType: input.activityType, updatedAt: now }] };
  }
  if (input.action === "set_risk_class") {
    const riskClasses = { ...(doc.riskClasses ?? {}) };
    if (input.riskClass === null) delete riskClasses[input.key]; else riskClasses[input.key] = input.riskClass;
    return { ...doc, riskClasses };
  }
  // A person a card is for: a member of the company, or someone already in the programme (Local names people in the file).
  const cardPerson = (personId: string, kept: string) => {
    const known = options.people?.find((person) => person.id === personId);
    const inProgram = doc.program ? peopleOverview({ roles: doc.program.roles, people: doc.program.people }).find((person) => person.personId === personId) : undefined;
    const onCard = (doc.competenceCards ?? []).find((card) => card.personId === personId) ?? (doc.credentials ?? []).find((item) => item.personId === personId);
    if (!known && !inProgram && !onCard) throw new SelfInspectionError(400, "Välj en person i företaget.");
    return known?.name || inProgram?.name || onCard?.name || kept;
  };
  const version = (next: SelfInspectionDocument, personId: string, name: string, change: string) => withCardVersion(next, personId, { name, change, actor, now, newId });
  if (input.action === "save_credential") {
    const value = input.credential;
    const name = cardPerson(value.personId, value.name);
    const credentials = doc.credentials ?? [];
    if (value.id) {
      const current = credentials.find((item) => item.id === value.id);
      if (!current) throw new SelfInspectionError(404, "Utbildningen hittades inte.");
      // The card of a person who left is kept as it was until it is deleted; it can only be removed.
      if (current.leftAt || hasLeft(doc, value.personId)) throw new SelfInspectionError(409, LEFT);
      const next = { ...doc, credentials: credentials.map((item) => item.id === value.id ? { ...current, ...value, id: current.id, name, updatedAt: now } : item) };
      return version(next, value.personId, name, `Utbildning ändrad: ${value.title}`);
    }
    if (hasLeft(doc, value.personId)) throw new SelfInspectionError(409, LEFT);
    return version({ ...doc, credentials: [...credentials, { ...value, id: newId(), name, leftAt: null, files: [], createdAt: now, updatedAt: now }] }, value.personId, name, `Utbildning tillagd: ${value.title}`);
  }
  if (input.action === "remove_credential") {
    const credentials = doc.credentials ?? [];
    const current = credentials.find((item) => item.id === input.id);
    if (!current) throw new SelfInspectionError(404, "Utbildningen hittades inte.");
    return version({ ...doc, credentials: credentials.filter((item) => item.id !== input.id) }, current.personId, current.name, `Utbildning borttagen: ${current.title}`);
  }
  // A whole card at any time (2026-10-07): every line of the person goes, files with them – and since v2 the rest of the card and its versions.
  if (input.action === "remove_credential_card") {
    const credentials = doc.credentials ?? [];
    const cards = doc.competenceCards ?? [];
    if (!credentials.some((item) => item.personId === input.personId) && !cards.some((card) => card.personId === input.personId)) throw new SelfInspectionError(404, "Personen har inget kompetenskort.");
    return { ...doc, credentials: credentials.filter((item) => item.personId !== input.personId), competenceCards: cards.filter((card) => card.personId !== input.personId),
      cardVersions: (doc.cardVersions ?? []).filter((item) => item.personId !== input.personId) };
  }
  if (input.action === "save_competence_card") {
    const value = input.card;
    const name = cardPerson(value.personId, value.name);
    if (hasLeft(doc, value.personId)) throw new SelfInspectionError(409, LEFT);
    const known = new Set((doc.competenceGroups ?? []).map((group) => group.id));
    for (const groupId of value.groupIds) if (!known.has(groupId)) throw new SelfInspectionError(404, "Kompetensgruppen hittades inte.");
    const cards = doc.competenceCards ?? [];
    const current = cards.find((card) => card.personId === value.personId);
    const fields = { groupIds: [...new Set(value.groupIds)], licenceClasses: [...new Set(value.licenceClasses)], licenceValidUntil: value.licenceValidUntil, languages: value.languages };
    const card = { ...(current ?? emptyCard(value.personId, name, now)), ...fields, name, updatedAt: now };
    return version({ ...doc, competenceCards: current ? cards.map((item) => item.personId === value.personId ? card : item) : [...cards, card] }, value.personId, name, cardChangeText(current, fields));
  }
  if (input.action === "suggest_competence_change") {
    // Only about one's own card; a member suggests, an admin edits.
    const name = cardPerson(actor.id, actor.name);
    if (hasLeft(doc, actor.id)) throw new SelfInspectionError(409, LEFT);
    const cards = doc.competenceCards ?? [];
    const current = cards.find((card) => card.personId === actor.id);
    const card = { ...(current ?? emptyCard(actor.id, name, now)), suggestion: input.text, suggestedAt: now, updatedAt: now };
    return { ...doc, competenceCards: current ? cards.map((item) => item.personId === actor.id ? card : item) : [...cards, card] };
  }
  if (input.action === "clear_competence_suggestion") {
    const cards = doc.competenceCards ?? [];
    const current = cards.find((card) => card.personId === input.personId);
    if (!current?.suggestion) throw new SelfInspectionError(404, "Det finns inget förslag att ta bort.");
    return { ...doc, competenceCards: cards.map((card) => card.personId === input.personId ? { ...card, suggestion: "", suggestedAt: null, updatedAt: now } : card) };
  }
  if (input.action === "save_competence_group") {
    const value = input.group;
    const groups = doc.competenceGroups ?? [];
    if (groups.some((group) => group.id !== value.id && group.name.toLocaleLowerCase("sv") === value.name.toLocaleLowerCase("sv"))) throw new SelfInspectionError(409, "Det finns redan en kompetensgrupp med det namnet.");
    if (value.id) {
      const current = groups.find((group) => group.id === value.id);
      if (!current) throw new SelfInspectionError(404, "Kompetensgruppen hittades inte.");
      let next: SelfInspectionDocument = { ...doc, competenceGroups: groups.map((group) => group.id === value.id ? { ...current, name: value.name, description: value.description, updatedAt: now } : group) };
      // A new name is part of every card in the group, so each keeps a version.
      if (current.name !== value.name) for (const card of (doc.competenceCards ?? []).filter((item) => item.groupIds.includes(value.id!)))
        next = version(next, card.personId, card.name, `Kompetensgruppen ${current.name} heter nu ${value.name}`);
      return next;
    }
    if (groups.length >= 100) throw new SelfInspectionError(400, "Högst 100 kompetensgrupper.");
    return { ...doc, competenceGroups: [...groups, { id: newId(), name: value.name, description: value.description, sortOrder: groups.reduce((max, group) => Math.max(max, group.sortOrder), -1) + 1, createdAt: now, updatedAt: now }] };
  }
  if (input.action === "remove_competence_group") {
    const groups = doc.competenceGroups ?? [];
    const current = groups.find((group) => group.id === input.id);
    if (!current) throw new SelfInspectionError(404, "Kompetensgruppen hittades inte.");
    const members = (doc.competenceCards ?? []).filter((card) => card.groupIds.includes(input.id));
    let next: SelfInspectionDocument = { ...doc, competenceGroups: groups.filter((group) => group.id !== input.id),
      competenceCards: (doc.competenceCards ?? []).map((card) => card.groupIds.includes(input.id) ? { ...card, groupIds: card.groupIds.filter((groupId) => groupId !== input.id), updatedAt: now } : card) };
    for (const card of members) next = version(next, card.personId, card.name, `Kompetensgruppen ${current.name} togs bort`);
    return next;
  }
  if (input.action === "save_instrument") {
    const value = input.instrument;
    const instruments = doc.instruments ?? [];
    if (value.id) {
      const current = instruments.find((item) => item.id === value.id);
      if (!current) throw new SelfInspectionError(404, "Instrumentet hittades inte.");
      return { ...doc, instruments: instruments.map((item) => item.id === value.id ? { ...current, ...value, id: current.id, updatedAt: now } : item) };
    }
    return { ...doc, instruments: [...instruments, { ...value, id: newId(), createdAt: now, updatedAt: now }] };
  }
  if (input.action === "remove_instrument") {
    const instruments = doc.instruments ?? [];
    if (!instruments.some((item) => item.id === input.id)) throw new SelfInspectionError(404, "Instrumentet hittades inte.");
    return { ...doc, instruments: instruments.filter((item) => item.id !== input.id) };
  }

  // Everything below changes the draft: it must exist and be the revision the person edited.
  const program = doc.program;
  if (!program) throw new SelfInspectionError(404, "Skapa programmet från mallen först.");
  if (input.revision !== program.revision) throw new SelfInspectionError(409, "Programmet har ändrats av någon annan. Ladda om och gör ändringen igen.");
  const bump = (changes: Partial<typeof program>) => ({ ...doc, program: { ...program, ...changes, revision: program.revision + 1, updatedAt: now } });

  if (input.action === "save_program") {
    const known = new Map(program.sections.map((section) => [section.id, section]));
    for (const section of input.sections) if (section.id && !known.has(section.id)) throw new SelfInspectionError(404, "Ett avsnitt hittades inte. Ladda om sidan.");
    return bump({
      title: input.title, activityTypes: [...new Set(input.activityTypes)], worksOnOthersInstallations: input.worksOnOthersInstallations, registrationCheckedAt: input.registrationCheckedAt,
      sections: input.sections.map((section, index) => section.id
        ? { ...known.get(section.id)!, title: section.title, body: section.body, legalRef: section.legalRef, sortOrder: index }
        : { id: newId(), key: "", title: section.title, body: section.body, legalRef: section.legalRef, sortOrder: index }),
    });
  }
  if (input.action === "save_role") {
    const role = input.role;
    if (role.id) {
      if (!program.roles.some((item) => item.id === role.id)) throw new SelfInspectionError(404, "Rollen hittades inte.");
      // An ERE flag taken away also takes away who stands in the registration.
      return bump({ roles: program.roles.map((item) => item.id === role.id ? { ...item, name: role.name, description: role.description, duties: role.duties, isEre: role.isEre, capabilities: role.capabilities, level: role.level ?? item.level,
        members: role.isEre ? item.members : item.members.map((member) => ({ ...member, registered: false })) } : item) });
    }
    if (program.roles.some((item) => item.name.toLocaleLowerCase("sv") === role.name.toLocaleLowerCase("sv"))) throw new SelfInspectionError(409, "Det finns redan en roll med det namnet.");
    return bump({ roles: [...program.roles, { id: newId(), key: "", name: role.name, description: role.description, duties: role.duties, isEre: role.isEre, capabilities: role.capabilities, level: role.level ?? 1,
      sortOrder: program.roles.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1, members: [] }] });
  }
  if (input.action === "remove_role") {
    if (!program.roles.some((item) => item.id === input.roleId)) throw new SelfInspectionError(404, "Rollen hittades inte.");
    return bump({ roles: program.roles.filter((item) => item.id !== input.roleId) });
  }
  if (input.action === "assign_role") {
    const role = program.roles.find((item) => item.id === input.roleId);
    if (!role) throw new SelfInspectionError(404, "Rollen hittades inte.");
    // Local has no member list: a person is named in the file (namedPeople); otherwise the person must be known.
    const known = input.personId ? options.people?.find((person) => person.id === input.personId) : undefined;
    let personId = input.personId;
    let name = known?.name ?? input.name;
    if (!known) {
      if (!options.namedPeople || !input.name) throw new SelfInspectionError(400, "Välj en person i företaget.");
      const sameName = options.people?.find((person) => person.name.toLocaleLowerCase("sv") === input.name.toLocaleLowerCase("sv"));
      personId = sameName?.id ?? `named:${input.name.toLocaleLowerCase("sv")}`;
      name = sameName?.name ?? input.name;
    }
    const member = { personId: personId!, name, authorizationLevel: input.authorizationLevel, authorizationNumber: input.authorizationNumber, registered: role.isEre && input.registered };
    const exists = role.members.some((item) => item.personId === member.personId);
    return bump({ roles: program.roles.map((item) => item.id === role.id ? { ...item, members: exists ? item.members.map((entry) => entry.personId === member.personId ? member : entry) : [...item.members, member] } : item) });
  }
  if (input.action === "set_person_roles") {
    for (const roleId of input.roleIds) if (!program.roles.some((item) => item.id === roleId)) throw new SelfInspectionError(404, "Rollen hittades inte.");
    // The person is a member of the company, someone already in the programme, or (Local) named in the file.
    const known = input.personId ? options.people?.find((person) => person.id === input.personId) : undefined;
    let personId = input.personId;
    let name = known?.name ?? input.name;
    if (!known) {
      const inProgram = input.personId ? program.roles.flatMap((role) => role.members).find((member) => member.personId === input.personId) ?? program.people.find((person) => person.personId === input.personId) : undefined;
      if (inProgram) name = inProgram.name || name;
      else {
        if (!options.namedPeople || !input.name) throw new SelfInspectionError(400, "Välj en person i företaget.");
        const sameName = options.people?.find((person) => person.name.toLocaleLowerCase("sv") === input.name.toLocaleLowerCase("sv"));
        personId = sameName?.id ?? `named:${input.name.toLocaleLowerCase("sv")}`;
        name = sameName?.name ?? input.name;
      }
    }
    const wanted = new Set(input.roleIds);
    return bump({ roles: program.roles.map((role) => {
      const has = role.members.some((member) => member.personId === personId);
      if (wanted.has(role.id) && !has) return { ...role, members: [...role.members, { personId: personId!, name, authorizationLevel: "", authorizationNumber: "", registered: false }] };
      if (!wanted.has(role.id) && has) return { ...role, members: role.members.filter((member) => member.personId !== personId) };
      return role;
    }) });
  }
  if (input.action === "unassign_role") {
    const role = program.roles.find((item) => item.id === input.roleId);
    if (!role?.members.some((item) => item.personId === input.personId)) throw new SelfInspectionError(404, "Personen har inte rollen.");
    return bump({ roles: program.roles.map((item) => item.id === role.id ? { ...item, members: item.members.filter((entry) => entry.personId !== input.personId) } : item) });
  }
  if (input.action === "save_competence") {
    const value = input.competence;
    // The person is a member of the company, someone already in the programme, or (Local) named in the file.
    const known = options.people?.find((person) => person.id === value.personId);
    const inProgram = program.roles.flatMap((role) => role.members).find((member) => member.personId === value.personId) ?? program.people.find((person) => person.personId === value.personId);
    let personId = value.personId;
    let name = known?.name ?? inProgram?.name ?? "";
    if (!known && !inProgram) {
      if (!options.namedPeople || !value.name) throw new SelfInspectionError(400, "Välj en person i företaget.");
      personId = `named:${value.name.toLocaleLowerCase("sv")}`;
      name = value.name;
    }
    const entry = { ...value, personId, name, workTypes: [...new Set(value.workTypes)] };
    const exists = program.people.some((person) => person.personId === personId);
    return bump({ people: exists ? program.people.map((person) => person.personId === personId ? entry : person) : [...program.people, entry] });
  }
  if (input.action === "remove_competence") {
    if (!program.people.some((person) => person.personId === input.personId)) throw new SelfInspectionError(404, "Personen har inga kompetensuppgifter i programmet.");
    return bump({ people: program.people.filter((person) => person.personId !== input.personId) });
  }
  // approve: a new, unchangeable version from the draft as it stands, with the names and competence frozen in it.
  const names = new Map((options.people ?? []).map((person) => [person.id, person.name]));
  const content = programContent(program, names);
  const hash = await contentHash(content);
  const latest = latestVersion(doc);
  if (latest && (await changeFingerprint(latest.content)) === (await changeFingerprint(content))) throw new SelfInspectionError(409, `Utkastet är oförändrat sedan version ${latest.number}.`);
  return {
    ...doc,
    versions: [...doc.versions, { id: newId(), number: (latest?.number ?? 0) + 1, content, hash, changeReason: input.changeReason, approvedById: actor.id, approvedByName: actor.name, approvedAt: now }],
  };
}
