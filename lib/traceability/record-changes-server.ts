import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { customerTitle } from "@/lib/kfid/customer-name";
import {
  actorText, CHANGE_ACTIONS, CHANGE_PAGE_SIZE, changeLines, diffRecord, idsToName, parseChanges,
  type ChangeAction, type ChangeEntityType, type ChangeEntryView, type ChangeNames, type StoredChange,
} from "./record-changes";

/**
 * Ändringshistorik (K3.2) on the server. `recordChange` is called by the write paths inside their own transaction, so the
 * change and its history are saved together or not at all; the database chains the row (K3.1). `readChanges` gives one
 * record's history, newest first, a page at a time, with the names the company may see. The caller has already checked
 * that the person may read the record (app/api/record-changes); every query here is bound to the company too.
 * Raw SQL: the table is new and reads the same with any generated client.
 */
type Db = Prisma.TransactionClient | typeof prisma;

export type RecordChangeInput = {
  organizationId: string;
  entityType: ChangeEntityType;
  entityId: string;
  actorId: string | null;
  action: ChangeAction;
  /** The record before and after, in the shape of CHANGE_FIELDS (the snapshots in ./record-changes.ts); for UPDATED. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /**
   * An autosave (the editor saves by itself a few seconds after typing stops): a change of only the hidden content is kept
   * once per person and record in ten minutes, so typing a protocol does not fill the history.
   */
  autosave?: boolean;
};

const AUTOSAVE_WINDOW_MS = 10 * 60_000;

/** Writes one entry; an update where nothing tracked changed writes nothing. Returns the changes written, or null. */
export async function recordChange(db: Db, input: RecordChangeInput): Promise<StoredChange[] | null> {
  let changes = input.action === "UPDATED" ? diffRecord(input.entityType, input.before ?? null, input.after ?? null) : [];
  if (input.action === "UPDATED" && input.autosave && changes.length && changes.every((change) => change.from === undefined && change.to === undefined)) {
    const since = new Date(Date.now() - AUTOSAVE_WINDOW_MS);
    const [recent] = await db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "RecordChange" WHERE "organizationId" = ${input.organizationId} AND "entityType" = ${input.entityType} AND "entityId" = ${input.entityId}
        AND "actorId" IS NOT DISTINCT FROM ${input.actorId} AND "createdAt" >= ${since}`;
    if (recent?.n) changes = [];
  }
  if (input.action === "UPDATED" && !changes.length) return null;
  await db.$executeRaw`
    INSERT INTO "RecordChange" ("id", "organizationId", "entityType", "entityId", "action", "actorId", "changes")
    VALUES (${`rc_${randomUUID().replace(/-/g, "")}`}, ${input.organizationId}, ${input.entityType}, ${input.entityId}, ${input.action}, ${input.actorId}, ${JSON.stringify(changes)})`;
  return changes;
}

type Row = { id: string; action: string; actorId: string | null; changes: string; createdAt: Date };

/** The names of the ids in a page, read within the company; a work order's title only for someone who may read work orders. */
async function namesFor(organizationId: string, type: ChangeEntityType, rows: { actorId: string | null; changes: StoredChange[] }[], canReadWorkOrders: boolean): Promise<ChangeNames> {
  const ids = idsToName(type, rows.flatMap((row) => row.changes));
  for (const row of rows) if (row.actorId && !row.actorId.startsWith("system:")) ids.user.add(row.actorId);
  const list = (set: Set<string>) => [...set].slice(0, 500);
  const [users, customers, facilities, projects, tasks, parts, places, rounds] = await Promise.all([
    ids.user.size ? prisma.organizationMember.findMany({ where: { organizationId, userId: { in: list(ids.user) } }, select: { userId: true, user: { select: { name: true, email: true } } } }) : [],
    ids.customer.size ? prisma.customer.findMany({ where: { organizationId, id: { in: list(ids.customer) } }, select: { id: true, name: true, company: true, customerType: true } }) : [],
    ids.facility.size ? prisma.customerFacility.findMany({ where: { organizationId, id: { in: list(ids.facility) } }, select: { id: true, name: true } }) : [],
    ids.project.size ? prisma.project.findMany({ where: { organizationId, id: { in: list(ids.project) } }, select: { id: true, name: true } }) : [],
    ids.task.size ? prisma.workflowTask.findMany({ where: { organizationId, id: { in: list(ids.task) } }, select: { id: true, title: true } }) : [],
    ids.machinePart.size ? prisma.machinePart.findMany({ where: { organizationId, id: { in: list(ids.machinePart) } }, select: { id: true, name: true } }) : [],
    ids.place.size ? prisma.maintenancePlace.findMany({ where: { organizationId, id: { in: list(ids.place) } }, select: { id: true, name: true } }) : [],
    ids.round.size ? prisma.formSchedule.findMany({ where: { organizationId, id: { in: list(ids.round) } }, select: { id: true, title: true } }) : [],
  ]);
  return {
    user: Object.fromEntries(users.map((member) => [member.userId, member.user.name || member.user.email])),
    customer: Object.fromEntries(customers.map((row) => [row.id, customerTitle(row)])),
    facility: Object.fromEntries(facilities.map((row) => [row.id, row.name])),
    project: Object.fromEntries(projects.map((row) => [row.id, row.name])),
    // The link is told either way; its title only to someone who may read work orders.
    task: Object.fromEntries(tasks.map((row) => [row.id, canReadWorkOrders ? row.title || "(utan rubrik)" : "Arbetsorder"])),
    machinePart: Object.fromEntries(parts.map((row) => [row.id, row.name])),
    place: Object.fromEntries(places.map((row) => [row.id, row.name])),
    round: Object.fromEntries(rounds.map((row) => [row.id, row.title])),
  };
}

/**
 * One record's history: newest first, CHANGE_PAGE_SIZE at a time (`after` is the last entry's id of the previous page), the
 * total for "Visar 20 av 57", and each entry in words.
 */
export async function readChanges(input: { organizationId: string; entityType: ChangeEntityType; entityId: string; after?: string | null; canReadWorkOrders: boolean }) {
  const { organizationId, entityType, entityId } = input;
  // The chain's number is the order the rows were written in (two changes in one transaction share their time).
  const cursor = input.after
    ? (await prisma.$queryRaw<{ chainSeq: number | null }[]>`SELECT "chainSeq" FROM "RecordChange" WHERE "id" = ${input.after} AND "organizationId" = ${organizationId} AND "entityType" = ${entityType} AND "entityId" = ${entityId}`)[0] ?? null
    : null;
  const older = cursor?.chainSeq ? Prisma.sql`AND "chainSeq" < ${cursor.chainSeq}` : Prisma.empty;
  const [rows, [count]] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT "id", "action", "actorId", "changes", "createdAt" FROM "RecordChange"
      WHERE "organizationId" = ${organizationId} AND "entityType" = ${entityType} AND "entityId" = ${entityId} ${older}
      ORDER BY "chainSeq" DESC NULLS LAST, "createdAt" DESC, "id" DESC LIMIT ${CHANGE_PAGE_SIZE + 1}`,
    prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "RecordChange" WHERE "organizationId" = ${organizationId} AND "entityType" = ${entityType} AND "entityId" = ${entityId}`,
  ]);
  const page = rows.slice(0, CHANGE_PAGE_SIZE).map((row) => ({ ...row, changes: parseChanges(row.changes) }));
  const names = await namesFor(organizationId, entityType, page, input.canReadWorkOrders);
  const entries: ChangeEntryView[] = page.map((row) => {
    const action = (row.action in CHANGE_ACTIONS ? row.action : "UPDATED") as ChangeAction;
    return { id: row.id, at: row.createdAt.toISOString(), action, actionLabel: CHANGE_ACTIONS[action], actor: actorText(row.actorId, names), changes: changeLines(entityType, row.changes, names) };
  });
  return { entries, total: count?.n ?? entries.length, next: rows.length > CHANGE_PAGE_SIZE ? page[page.length - 1].id : null };
}
