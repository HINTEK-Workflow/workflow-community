import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { keyRing, openValue, ringHashSecrets, sealValue } from "@/lib/security/key-ring";
import { swedishDayKey } from "@/lib/swedish-time";
import { staffRegisterOf } from "@/lib/workflow/staff-register";
import {
  checkProblem, controlCsv, controlPeriod, controlScope, deserializeIdNumber, disclosureAuditDetail, disclosureRefusal, effectiveEvents, employerOrgNumber, formatIdNumber, idNumberFrom, isLate, maskIdNumber,
  NEEDS_ID_NUMBER, onSite, onSiteViewAuditDetail, personState, retentionCutoff, serializeIdNumber, staffRegisterAccess, StaffRegisterError,
  type PersonInput, type RegisterEvent, type StaffRegisterCaller, type StaffRegisterProject,
} from "./model";

/**
 * Personalliggare, steg 1 (2026-10-09, docs/proposals/personalliggare-krav-2026-10-11.md): everything that reads
 * or writes the register. Every call is scoped to the caller's company and checked again here; the register table is
 * append-only in the database (migration 20261011200000_staff_register_log). Identity numbers are sealed at rest with
 * the installation's key (AES-256-GCM, as the TOTP secrets) and opened only for the Kontrollvy and the export.
 */
// Since 2026-10-25 sealed with the key ring (lib/security/sealing.ts), bound to the company. The register's events are
// append-only (a legal record) and are never resealed: what they hold is opened with the secret that sealed it, which
// therefore stays in the ring as long as such rows are kept.
const seal = (organizationId: string, value: string) => sealValue("staff-register", value, organizationId);
const open = (organizationId: string, sealed: string) => openValue("staff-register", sealed, organizationId, "staff-register");
/** Finds the same person again in the company without opening every sealed number – under every secret in the ring. */
const idHashWith = (secret: string, organizationId: string, serialized: string) => createHmac("sha256", `staff-register-hash:${secret}`).update(`${organizationId}:${serialized}`).digest("hex");
const idHash = (organizationId: string, serialized: string) => idHashWith(keyRing().current, organizationId, serialized);
const idHashes = (organizationId: string, serialized: string) => ringHashSecrets().map((secret) => idHashWith(secret, organizationId, serialized));
/** How far back "who is on site" looks: someone checked in longer ago than this without checking out is not listed. */
const ON_SITE_WINDOW_DAYS = 14;
const MAX_CONTROL_ROWS = 5_000;

/** `project` (the register project) lets its responsible person open the Kontrollvy; see staffRegisterAccess. */
export function requireStaffRegister(caller: Pick<StaffRegisterCaller, "admin" | "permissions" | "storageMode"> & { userId?: string }, need: "self" | "control" | "others", project?: StaffRegisterProject) {
  // Identity numbers stay on Workflow's server only for Cloud companies; a Local (.hwf) company uses the system on site.
  // Rows kept from an earlier Cloud period are still read and exported in the Kontrollvy ("läs och exportera kvar").
  if (caller.storageMode !== "HINTEK_CLOUD" && need !== "control") throw new StaffRegisterError(409, "Personalliggaren i Workflow finns bara med serverlagring. I en lokal arbetsyta checkar personalen in i systemet på plats.");
  if (!staffRegisterAccess(caller, project)[need]) throw new StaffRegisterError(403, need === "control" ? "Du saknar behörighet att öppna personalliggarens kontrollvy." : need === "others" ? "Du saknar behörighet att registrera andra i personalliggaren." : "Du saknar behörighet att se projektet.");
}

async function registerProject(organizationId: string, projectId: string, write: boolean) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, staffRegister: true, archivedAt: true, responsibleUserId: true } });
  if (!project) throw new StaffRegisterError(404, "Projektet hittades inte.");
  const register = staffRegisterOf(project.staffRegister);
  // A register switched off later is still read (Kontrollvy, export) while its rows are kept; only new rows need it on.
  if ((!register.required || !register.inWorkflow) && (write || !(await prisma.staffRegisterEvent.count({ where: { organizationId, projectId: project.id } }))))
    throw new StaffRegisterError(409, "Projektet för inte personalliggaren i Workflow.");
  if (write && project.archivedAt) throw new StaffRegisterError(409, "Projektet är arkiverat. Återställ det för att registrera i personalliggaren.");
  return { id: project.id, name: project.name, siteId: register.siteId, responsibleUserId: project.responsibleUserId };
}
/** What the routes send about the project (never who is responsible). */
const shownProject = (project: Awaited<ReturnType<typeof registerProject>>) => ({ id: project.id, name: project.name, siteId: project.siteId });

export async function companyIdentity(organizationId: string, fallbackName: string) {
  const settings = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { companyName: true, profile: true } });
  const profile = (settings?.profile && typeof settings.profile === "object" && !Array.isArray(settings.profile) ? settings.profile : {}) as Record<string, unknown>;
  const orgNo = typeof profile.organizationNumber === "string" ? profile.organizationNumber.trim() : "";
  return { name: settings?.companyName?.trim() || fallbackName, orgNo };
}

const personSelect = { id: true, userId: true, name: true, idNumberMasked: true, employerName: true, employerOrgNo: true } as const;
export type RegisterPerson = { id: string; userId: string | null; name: string; idNumberMasked: string; employerName: string; employerOrgNo: string };

/** Your own identity number, kept for your next check-ins (name and employer follow you and the company). */
export async function saveOwnIdNumber(caller: StaffRegisterCaller, input: { idNumber: string; foreign?: boolean }, companyName: string) {
  requireStaffRegister(caller, "self");
  return upsertPerson(caller, { userId: caller.userId, name: caller.userName, idNumber: input.idNumber, foreign: input.foreign ?? false }, companyName);
}

/** A person registered by someone with staff-register:edit: a member, or someone who is not a member. */
export async function savePerson(caller: StaffRegisterCaller, input: PersonInput, companyName: string) {
  requireStaffRegister(caller, "others");
  if (input.userId) {
    const member = await prisma.organizationMember.findFirst({ where: { organizationId: caller.organizationId, userId: input.userId, isActive: true }, select: { user: { select: { name: true, email: true } } } });
    if (!member) throw new StaffRegisterError(400, "Personen är inte medlem i företaget.");
    return upsertPerson(caller, { ...input, name: member.user.name || member.user.email }, companyName);
  }
  if (!input.name) throw new StaffRegisterError(400, "Skriv personens namn.");
  if (!input.employerName) throw new StaffRegisterError(400, "Skriv arbetsgivarens namn.");
  return upsertPerson(caller, input, companyName);
}

async function upsertPerson(caller: StaffRegisterCaller, input: PersonInput & { name?: string }, companyName: string): Promise<RegisterPerson> {
  const id = idNumberFrom(input);
  const serialized = serializeIdNumber(id);
  const hash = idHash(caller.organizationId, serialized);
  const company = await companyIdentity(caller.organizationId, companyName);
  const member = Boolean(input.userId);
  const employerName = member ? company.name : input.employerName ?? "";
  const employerOrgNo = member ? company.orgNo : employerOrgNumber(input.employerOrgNo ?? "");
  const data = { name: (input.name ?? "").trim().slice(0, 120), idNumberSealed: seal(caller.organizationId, serialized), idNumberMasked: maskIdNumber(id), idNumberHash: hash, employerName: employerName.slice(0, 160), employerOrgNo };
  const sameNumber = await prisma.staffRegisterPerson.findFirst({ where: { organizationId: caller.organizationId, idNumberHash: { in: idHashes(caller.organizationId, serialized) } }, select: { id: true, userId: true, name: true } });
  const current = input.userId
    ? await prisma.staffRegisterPerson.findUnique({ where: { organizationId_userId: { organizationId: caller.organizationId, userId: input.userId } }, select: { id: true } })
    : input.id ? await prisma.staffRegisterPerson.findFirst({ where: { id: input.id, organizationId: caller.organizationId, userId: null }, select: { id: true } }) : sameNumber && !sameNumber.userId ? { id: sameNumber.id } : null;
  if (input.id && !current) throw new StaffRegisterError(404, "Personen hittades inte.");
  if (sameNumber && sameNumber.id !== current?.id) throw new StaffRegisterError(409, `Personnumret finns redan i liggaren för ${sameNumber.name}.`);
  if (current) return prisma.staffRegisterPerson.update({ where: { id: current.id }, data, select: personSelect });
  return prisma.staffRegisterPerson.create({ data: { ...data, organizationId: caller.organizationId, userId: input.userId ?? null, createdById: caller.userId }, select: personSelect });
}

type EventRow = Prisma.StaffRegisterEventGetPayload<object>;
const asRegisterEvent = (row: EventRow, full: boolean): RegisterEvent => {
  const id = full ? deserializeIdNumber(open(row.organizationId, row.idNumberSealed)) : null;
  return {
    id: row.id, personId: row.personId, personName: row.personName, idNumber: id ? formatIdNumber(id) : full ? "(kan inte läsas)" : row.idNumberMasked,
    employerName: row.employerName, employerOrgNo: row.employerOrgNo, kind: row.kind, occurredAt: row.occurredAt, registeredAt: row.registeredAt,
    registeredByName: row.registeredByName, correctsId: row.correctsId, reason: row.reason, siteId: row.siteId,
  };
};

async function recentEvents(organizationId: string, projectId: string, now: Date, personId?: string) {
  const since = new Date(now.getTime() - ON_SITE_WINDOW_DAYS * 86_400_000);
  // Corrections are read with their originals, whenever they were registered.
  return prisma.staffRegisterEvent.findMany({
    where: { organizationId, projectId, ...(personId ? { personId } : {}), OR: [{ occurredAt: { gte: since } }, { corrects: { occurredAt: { gte: since } } }] },
    orderBy: [{ occurredAt: "asc" }, { registeredAt: "asc" }], take: 2_000,
  });
}

/** The project's register page: your own state, and for those who may, who is on site and the people to pick from. */
export async function registerStatus(caller: StaffRegisterCaller, projectId: string, now = new Date()) {
  requireStaffRegister(caller, "self");
  const project = await registerProject(caller.organizationId, projectId, false);
  const access = staffRegisterAccess(caller, project);
  const me = await prisma.staffRegisterPerson.findUnique({ where: { organizationId_userId: { organizationId: caller.organizationId, userId: caller.userId } }, select: personSelect });
  const wide = access.control || access.others;
  const events = await recentEvents(caller.organizationId, project.id, now, wide ? undefined : me?.id ?? "-");
  const mine = me ? personState(events, me.id, now) : { onSite: false, since: null };
  const here = wide ? onSite(events, now) : [];
  const people = access.others ? await prisma.staffRegisterPerson.findMany({ where: { organizationId: caller.organizationId }, select: personSelect, orderBy: { name: "asc" }, take: 500 }) : [];
  return {
    project: shownProject(project),
    access,
    me: { person: me, onSite: mine.onSite, since: mine.since?.toISOString() ?? null },
    onSite: here.map((event) => ({ personId: event.personId, name: event.personName, idNumber: event.idNumberMasked, employer: event.employerName, since: event.occurredAt.toISOString() })),
    people,
    today: swedishDayKey(now),
  };
}

const lockPerson = (tx: Prisma.TransactionClient, personId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff-register:${personId}`}))`;

/** A check-in or check-out, now or late (with a reason). Yourself, or someone else with staff-register:edit. */
export async function registerCheck(caller: StaffRegisterCaller, input: { projectId: string; personId?: string; kind: "IN" | "OUT"; occurredAt?: string; reason?: string }, now = new Date()) {
  requireStaffRegister(caller, "self");
  const project = await registerProject(caller.organizationId, input.projectId, true);
  const own = await prisma.staffRegisterPerson.findUnique({ where: { organizationId_userId: { organizationId: caller.organizationId, userId: caller.userId } }, select: { id: true } });
  const personId = input.personId ?? own?.id;
  if (!personId) throw new StaffRegisterError(409, "Skriv ditt personnummer en gång, så kan du checka in.", NEEDS_ID_NUMBER);
  const self = personId === own?.id;
  if (!self) requireStaffRegister(caller, "others");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  if (Number.isNaN(occurredAt.getTime())) throw new StaffRegisterError(400, "Ogiltig tidpunkt.");
  if (occurredAt.getTime() > now.getTime() + 60_000) throw new StaffRegisterError(400, "Arbetspasset kan inte registreras i förväg.");
  const late = isLate(occurredAt, now);
  const reason = (input.reason ?? "").trim();
  if (late && !reason) throw new StaffRegisterError(400, "Skriv varför registreringen görs i efterhand.");
  return prisma.$transaction(async (tx) => {
    await lockPerson(tx, personId);
    const person = await tx.staffRegisterPerson.findFirst({ where: { id: personId, organizationId: caller.organizationId } });
    if (!person) throw new StaffRegisterError(404, "Personen hittades inte.");
    if (!late) {
      const events = await tx.staffRegisterEvent.findMany({ where: { organizationId: caller.organizationId, projectId: project.id, personId, OR: [{ occurredAt: { gte: new Date(now.getTime() - ON_SITE_WINDOW_DAYS * 86_400_000) } }, { correctsId: { not: null } }] }, take: 2_000 });
      const problem = checkProblem(personState(events, personId, now), input.kind, self);
      if (problem) throw new StaffRegisterError(409, problem);
    }
    const event = await tx.staffRegisterEvent.create({ data: {
      organizationId: caller.organizationId, projectId: project.id, siteId: project.siteId, personId, personName: person.name,
      idNumberSealed: person.idNumberSealed, idNumberMasked: person.idNumberMasked, employerName: person.employerName, employerOrgNo: person.employerOrgNo,
      kind: input.kind, occurredAt, registeredById: caller.userId, registeredByName: caller.userName, reason: reason.slice(0, 300),
    }, select: { id: true, kind: true, occurredAt: true, registeredAt: true } });
    await tx.staffRegisterPerson.update({ where: { id: personId }, data: { lastUsedAt: now } });
    return { id: event.id, kind: event.kind, occurredAt: event.occurredAt.toISOString(), registeredAt: event.registeredAt.toISOString(), name: person.name };
  });
}

/** A correction: a new row that replaces an original row (other kind or time, or VOID = registered by mistake). */
export async function registerCorrection(caller: StaffRegisterCaller, input: { eventId: string; kind: "IN" | "OUT" | "VOID"; occurredAt?: string; reason: string }, now = new Date()) {
  requireStaffRegister(caller, "self");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new StaffRegisterError(400, "Skriv varför raden rättas.");
  const original = await prisma.staffRegisterEvent.findFirst({ where: { id: input.eventId, organizationId: caller.organizationId }, include: { person: { select: { userId: true } } } });
  if (!original) throw new StaffRegisterError(404, "Raden hittades inte.");
  if (original.correctsId) throw new StaffRegisterError(400, "Rätta den ursprungliga raden, inte rättelsen.");
  if (original.person.userId !== caller.userId) requireStaffRegister(caller, "others");
  const project = await registerProject(caller.organizationId, original.projectId, true);
  const occurredAt = input.kind === "VOID" || !input.occurredAt ? original.occurredAt : new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new StaffRegisterError(400, "Ogiltig tidpunkt.");
  if (occurredAt.getTime() > now.getTime() + 60_000) throw new StaffRegisterError(400, "En tidpunkt i framtiden kan inte registreras.");
  const event = await prisma.staffRegisterEvent.create({ data: {
    organizationId: caller.organizationId, projectId: project.id, siteId: original.siteId, personId: original.personId, personName: original.personName,
    idNumberSealed: original.idNumberSealed, idNumberMasked: original.idNumberMasked, employerName: original.employerName, employerOrgNo: original.employerOrgNo,
    kind: input.kind, occurredAt, registeredById: caller.userId, registeredByName: caller.userName, correctsId: original.id, reason: reason.slice(0, 300),
  }, select: { id: true } });
  return { id: event.id };
}

/** Your own rows of the last days, so you can see and correct them (identity number masked). */
export async function ownRows(caller: StaffRegisterCaller, projectId: string, now = new Date()) {
  requireStaffRegister(caller, "self");
  const project = await registerProject(caller.organizationId, projectId, false);
  const me = await prisma.staffRegisterPerson.findUnique({ where: { organizationId_userId: { organizationId: caller.organizationId, userId: caller.userId } }, select: { id: true } });
  if (!me) return [];
  return (await recentEvents(caller.organizationId, project.id, now, me.id)).map((row) => asRegisterEvent(row, false));
}

/**
 * The Kontrollvy (SKVFS 2015:6 13–14 §§): every row of a period (one day by default), originals and corrections, with
 * identity numbers in full, optionally for one person; and who is on site right now. Admins, staff-register:read, and
 * the project's own responsible person (for this project only). "Visa för Skatteverket" (2026-10-10): a person
 * checked in on this site right now gets today's view of this site only, never the export (`exporting`), and every such
 * opening is written to the company's administration history (model.ts controlScope). `limited` says which it was.
 */
export async function controlView(caller: StaffRegisterCaller, input: { projectId: string; startAt: Date; endAt: Date; personId?: string }, companyName: string, now = new Date(), options: { exporting?: boolean } = {}) {
  const project = await registerProject(caller.organizationId, input.projectId, false);
  const access = staffRegisterAccess(caller, project);
  const checkedInHere = async () => {
    if (!access.self) return false;
    const me = await prisma.staffRegisterPerson.findUnique({ where: { organizationId_userId: { organizationId: caller.organizationId, userId: caller.userId } }, select: { id: true } });
    return me ? personState(await recentEvents(caller.organizationId, project.id, now, me.id), me.id, now).onSite : false;
  };
  const scope = controlScope({ control: access.control, checkedInHere: !access.control && await checkedInHere(), exporting: Boolean(options.exporting),
    startAt: input.startAt, endAt: input.endAt, today: controlPeriod(null, null, swedishDayKey(now)) });
  if (scope === "full") requireStaffRegister(caller, "control", project);
  const where = { organizationId: caller.organizationId, projectId: project.id, ...(input.personId ? { personId: input.personId } : {}) };
  const rows = await prisma.staffRegisterEvent.findMany({
    where: { ...where, OR: [{ occurredAt: { gte: input.startAt, lt: input.endAt } }, { corrects: { occurredAt: { gte: input.startAt, lt: input.endAt } } }] },
    orderBy: [{ occurredAt: "asc" }, { registeredAt: "asc" }], take: MAX_CONTROL_ROWS + 1,
  });
  if (rows.length > MAX_CONTROL_ROWS) throw new StaffRegisterError(413, "Perioden har för många rader. Välj färre dagar.");
  const recent = await recentEvents(caller.organizationId, project.id, now);
  const company = await companyIdentity(caller.organizationId, companyName);
  // Logged before anything is returned: without the history line, no view.
  if (scope === "today") await prisma.administrationEvent.create({ data: { actorId: caller.userId, organizationId: caller.organizationId, action: "staff_register_onsite_view",
    detail: onSiteViewAuditDetail({ siteId: project.siteId, day: swedishDayKey(now), rows: rows.length }) } });
  return {
    limited: scope === "today",
    project: shownProject(project), company,
    events: rows.map((row) => asRegisterEvent(row, true)),
    onSite: onSite(recent.map((row) => asRegisterEvent(row, true)), now),
    effective: effectiveEvents(rows.map((row) => asRegisterEvent(row, false))).length,
  };
}

/**
 * "Personalliggare på begäran" (2026-10-09 evening): the companies Workflow may hand a register out for – erased or
 * switched off by the product owner (no login: "avstängt är avstängt") – with their building sites and row counts.
 * Metadata only; nothing of the company's other business data.
 */
export async function disclosureCandidates() {
  const groups = await prisma.staffRegisterEvent.groupBy({ by: ["organizationId", "projectId"], where: { organization: { isActive: false } }, _count: { _all: true }, _min: { occurredAt: true }, _max: { occurredAt: true } });
  if (!groups.length) return [];
  const organizations = await prisma.organization.findMany({ where: { id: { in: [...new Set(groups.map((item) => item.organizationId))] } }, select: { id: true, name: true, slug: true } });
  const projects = await prisma.project.findMany({ where: { id: { in: groups.map((item) => item.projectId) } }, select: { id: true, name: true, staffRegister: true } });
  return organizations.map((organization) => ({
    id: organization.id, name: organization.name, erased: organization.slug === `raderat-${organization.id}`,
    sites: groups.filter((item) => item.organizationId === organization.id).map((item) => {
      const project = projects.find((candidate) => candidate.id === item.projectId);
      return { projectId: item.projectId, name: project?.name ?? "", siteId: staffRegisterOf(project?.staffRegister).siteId, rows: item._count._all,
        from: item._min.occurredAt ? swedishDayKey(item._min.occurredAt) : "", to: item._max.occurredAt ? swedishDayKey(item._max.occurredAt) : "" };
    }),
  }));
}

/**
 * Hands out every kept row of one building site of an inactive company as the ordinary CSV export (numbers in full),
 * for the superadmin only, with the reason and the count written to the company's administration history in the same
 * transaction as the read. The file is never stored.
 */
export async function discloseStaffRegister(input: { organizationId: string; projectId: string; reason: string; actorId: string; superadmin: boolean }) {
  const organization = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, name: true, isActive: true } });
  if (!organization) throw new StaffRegisterError(404, "Företaget hittades inte.");
  const refusal = disclosureRefusal({ superadmin: input.superadmin, companyActive: organization.isActive });
  if (refusal) throw new StaffRegisterError(input.superadmin ? 409 : 403, refusal);
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: input.projectId, organizationId: organization.id }, select: { id: true, name: true, staffRegister: true } });
    if (!project) throw new StaffRegisterError(404, "Byggarbetsplatsen hittades inte.");
    const rows = await tx.staffRegisterEvent.findMany({ where: { organizationId: organization.id, projectId: project.id }, orderBy: [{ occurredAt: "asc" }, { registeredAt: "asc" }], take: 50_001 });
    if (!rows.length) throw new StaffRegisterError(404, "Byggarbetsplatsen har inga sparade rader.");
    if (rows.length > 50_000) throw new StaffRegisterError(413, "För många rader för en fil.");
    const events = rows.map((row) => asRegisterEvent(row, true));
    const siteId = staffRegisterOf(project.staffRegister).siteId || rows[rows.length - 1]!.siteId;
    const company = await companyIdentity(organization.id, organization.name);
    const from = swedishDayKey(rows[0]!.occurredAt), to = swedishDayKey(rows[rows.length - 1]!.occurredAt);
    await tx.administrationEvent.create({ data: { actorId: input.actorId, organizationId: organization.id, action: "staff_register_disclosed", detail: disclosureAuditDetail({ rows: rows.length, siteId, reason: input.reason }) } });
    return { csv: controlCsv({ company: company.name, companyOrgNo: company.orgNo, siteId, project: project.name, from, to }, events), siteId, from, to, rows: rows.length };
  });
}

/** Whether a project has register rows: such a project cannot be deleted (the rows must be kept). */
export const projectHasRegister = async (organizationId: string, projectId: string) =>
  (await prisma.staffRegisterEvent.count({ where: { organizationId, projectId } })) > 0;

/**
 * Nightly (history:retention): rows older than the retention time (model.ts retentionCutoff) are deleted, a correction
 * only together with its original, then people who have no rows left and have not been used since the cutoff. Each
 * company gets one counted line in its administration history; never names or numbers. `dryRun` (T5, 2026-10-24) only
 * counts: the rows that would go, and the people whose every row would go and who have not been used since the cutoff.
 */
export async function purgeStaffRegister(now = new Date(), options: { dryRun?: boolean } = {}) {
  const cutoff = retentionCutoff(now);
  const old = { occurredAt: { lt: cutoff }, corrections: { none: { occurredAt: { gte: cutoff } } } } satisfies Prisma.StaffRegisterEventWhereInput;
  const companies = await prisma.staffRegisterEvent.groupBy({ by: ["organizationId"], where: old, _count: { _all: true } });
  const stalePeople = await prisma.staffRegisterPerson.groupBy({ by: ["organizationId"], where: { lastUsedAt: { lt: cutoff } } });
  const organizationIds = [...new Set([...companies.map((item) => item.organizationId), ...stalePeople.map((item) => item.organizationId)])];
  const results: { organizationId: string; events: number; people: number }[] = [];
  for (const organizationId of organizationIds) {
    if (options.dryRun) {
      const [events, people] = await Promise.all([
        prisma.staffRegisterEvent.count({ where: { organizationId, ...old } }),
        prisma.staffRegisterPerson.count({ where: { organizationId, lastUsedAt: { lt: cutoff }, events: { every: old } } }),
      ]);
      if (events || people) results.push({ organizationId, events, people });
      continue;
    }
    const result = await prisma.$transaction(async (tx) => {
      // The database lets the register be deleted only inside this transaction and only for old rows.
      await tx.$executeRawUnsafe("SET LOCAL workflow.staff_register_purge = 'on'");
      const events = await tx.staffRegisterEvent.deleteMany({ where: { organizationId, ...old } });
      const people = await tx.staffRegisterPerson.deleteMany({ where: { organizationId, lastUsedAt: { lt: cutoff }, events: { none: {} } } });
      // An erased company (lib/auth/erasure.ts) kept its building sites only for the register; with no rows left they go too.
      await tx.project.deleteMany({ where: { organizationId, organization: { isActive: false, slug: `raderat-${organizationId}` }, staffRegisterEvents: { none: {} } } });
      if (events.count || people.count) await tx.administrationEvent.create({ data: { actorId: "system:staff-register-retention", organizationId, action: "staff_register_retention",
        detail: `Personalliggaren rensades efter bevarandetiden: ${events.count} ${events.count === 1 ? "rad" : "rader"} från före ${swedishDayKey(cutoff)} och ${people.count} ${people.count === 1 ? "person" : "personer"} utan rader.` } });
      return { events: events.count, people: people.count };
    }, { timeout: 120_000 });
    results.push({ organizationId, ...result });
  }
  return results;
}
