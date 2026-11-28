import { z } from "zod";
import { formLeafBlocks, formRowFixedOnSite, type FormDocument, type FormTableBlock, type FormValues } from "@/lib/workflow/form-document";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Driftronden som tillsyn (2026-11-27, the round's follow-up): the round is an inspection plus small fixes. A brist found
 * in the round is either fixed on the spot (Åtgärdad direkt, counted as handled) or becomes a work order with one of two buttons:
 * Akut arbetsorder (priority Akut; arbetsledare and admin get a notice in the app and by e-mail) or Planerad arbetsorder (with a
 * suggested day). Every work order made from the round tells arbetsledare and admin in the app. The brist's comment and photo go
 * with it; the machine part comes from the round point, else the technician picks it or leaves it empty. The round's work order
 * lists them under "Från ronden". Pure: the kinds, the brister of a protocol, the counts, and the notices. The server is
 * lib/kfid/round-follow-up-server.ts; the work order is made by the ordinary save (app/api/workflow-tasks, `roundFollowUp`).
 */

export const ROUND_FOLLOW_UP_KINDS = ["URGENT", "PLANNED"] as const;
export type RoundFollowUpKind = (typeof ROUND_FOLLOW_UP_KINDS)[number];
export const ROUND_FOLLOW_UP_LABELS: Record<RoundFollowUpKind, string> = { URGENT: "Akut", PLANNED: "Planerad" };
export const ROUND_FOLLOW_UP_BUTTONS: Record<RoundFollowUpKind, string> = { URGENT: "Akut arbetsorder", PLANNED: "Planerad arbetsorder" };

/** What the protocol's button sends beside the new work order. `partId`: left out = the round point's machine; null = none. */
export const roundFollowUpInputSchema = z.object({
  kind: z.enum(ROUND_FOLLOW_UP_KINDS),
  partId: z.string().trim().min(1).max(100).nullable().optional(),
  /** The brist's photos: attachment ids of the protocol, copied to the work order. */
  imageIds: z.array(z.string().min(1).max(100)).max(20).default([]),
});
export type RoundFollowUpInput = z.output<typeof roundFollowUpInputSchema>;

/** The stored mark on a work order (task-model `details.roundFollowUp`), read safely. */
export function roundFollowUpOf(data: unknown): { kind: RoundFollowUpKind; roundOrderId: string } | null {
  const value = (data as { details?: { roundFollowUp?: { kind?: unknown; roundOrderId?: unknown } } } | null)?.details?.roundFollowUp;
  if (!value || (value.kind !== "URGENT" && value.kind !== "PLANNED") || typeof value.roundOrderId !== "string" || !value.roundOrderId) return null;
  return { kind: value.kind, roundOrderId: value.roundOrderId };
}

/** A saved work order keeps its stored mark whatever the page sends (only the server sets it, when the order is made). */
export function withStoredRoundFollowUp<T>(data: T, stored: unknown): T {
  const value = data as { kind?: string; details?: Record<string, unknown> } | null;
  if (value?.kind !== "WORK_ORDER" || !value.details) return data;
  const kept = roundFollowUpOf(stored);
  const { roundFollowUp: _sent, ...rest } = value.details;
  void _sent;
  return { ...value, details: kept ? { ...rest, roundFollowUp: kept } : rest } as T;
}

// ---------- the brister of a protocol ----------

export type RoundFinding = {
  tableKey: string; rowId: string; point: string; description: string;
  /** Föreslagen åtgärd or the row's other long text: the comment that follows into the work order. */
  comment: string; severity: string; fixedOnSite: boolean; workOrderId: string | null; partId: string | null; images: string[];
};

/** A brist as the machine's Historik reads it: which protocol, its day and the machine (lib/kfid/round-follow-up-server.ts partFindings). */
export type RoundFindingEntry = RoundFinding & { protocolId: string; protocolTitle: string; partName: string; day: string; at: string };

/** Historik's words for a brist: what was done about it, and its tone. */
export function findingState(finding: Pick<RoundFinding, "fixedOnSite" | "workOrderId">): { label: string; tone: "success" | "info" | "warning" } {
  if (finding.workOrderId) return { label: "Arbetsorder skapad", tone: "info" };
  if (finding.fixedOnSite) return { label: "Åtgärdad direkt", tone: "success" };
  return { label: "Öppen brist", tone: "warning" };
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** The tables a protocol follows up as work orders (a table of remarks, `workOrders`), e.g. the built-in round's Brister. */
const findingTables = (document: FormDocument) => formLeafBlocks(document).filter((block): block is FormTableBlock => block.type === "table" && Boolean(block.workOrders));

/** The protocol's brister: every filled, non-example row of its tables of remarks, with what the follow-up and Historik need. */
export function roundFindings(document: FormDocument, values: FormValues): RoundFinding[] {
  const out: RoundFinding[] = [];
  for (const block of findingTables(document)) {
    const by = (input: string) => block.columns.filter((column) => column.input === input);
    const first = (input: string, preferred: string) => block.columns.find((column) => column.input === input && column.key === preferred) ?? by(input)[0];
    const pointColumn = first("text", "punkt");
    const descriptionColumn = first("textarea", "beskrivning");
    const commentColumn = block.columns.find((column) => column.input === "textarea" && column.key === "atgard") ?? by("textarea").find((column) => column !== descriptionColumn);
    const severityColumn = block.columns.find((column) => column.input === "choice" && column.deviationOptions.length);
    const imageColumns = by("images");
    for (const row of values.tables[block.key] ?? []) {
      if (row.example) continue;
      const filled = Object.values(row.cells).some((value) => value !== null && value !== "" && value !== false && !(Array.isArray(value) && !value.length));
      if (!filled && !row.workOrderId) continue;
      out.push({
        tableKey: block.key, rowId: row.id, point: text(pointColumn ? row.cells[pointColumn.key] : ""), description: text(descriptionColumn ? row.cells[descriptionColumn.key] : ""),
        comment: text(commentColumn ? row.cells[commentColumn.key] : ""), severity: text(severityColumn ? row.cells[severityColumn.key] : ""),
        fixedOnSite: formRowFixedOnSite(block, row), workOrderId: row.workOrderId ?? null, partId: row.partId ?? null,
        images: imageColumns.flatMap((column) => Array.isArray(row.cells[column.key]) ? (row.cells[column.key] as string[]) : []).slice(0, 20),
      });
    }
  }
  return out;
}

/**
 * Uppföljningen: how the round's brister are handled. Åtgärdad direkt and those with a work order count as handled; the rest
 * are open (they show as "Brister utan arbetsorder" on Driftronder).
 */
export function roundFollowUpCounts(findings: readonly Pick<RoundFinding, "fixedOnSite" | "workOrderId">[]) {
  let fixedOnSite = 0, withOrder = 0, open = 0;
  for (const finding of findings) {
    if (finding.workOrderId) withOrder += 1;
    else if (finding.fixedOnSite) fixedOnSite += 1;
    else open += 1;
  }
  return { total: findings.length, fixedOnSite, withOrder, open, handled: fixedOnSite + withOrder };
}

/** The work order's title and description from the brist: its own words, the comment beside them. */
export function followUpOrderText(finding: Pick<RoundFinding, "point" | "description" | "comment">, roundTitle: string) {
  const name = finding.point || finding.description.split("\n")[0] || "Brist";
  const title = `Åtgärda: ${name}`.slice(0, 200);
  const description = [finding.description, finding.comment ? `Kommentar: ${finding.comment}` : "", roundTitle ? `Från driftronden ${roundTitle}.` : ""].filter(Boolean).join("\n").slice(0, 4000);
  return { title, description };
}

// ---------- Från ronden: the round's work order lists its follow-ups ----------

export type RoundFollowUpRow = { id: string; title: string; kind: RoundFollowUpKind; open: boolean; status: string; label: string };
const CLOSED = new Set(["COMPLETED", "CANCELLED"]);
/** A follow-up work order as the box shows it: Akut or Planerad, Öppen or Klar (Utgått too counts as closed). */
export function followUpRow(order: { id: string; title: string; status: string; data: unknown }): RoundFollowUpRow | null {
  const mark = roundFollowUpOf(order.data);
  if (!mark) return null;
  const open = !CLOSED.has(order.status);
  return { id: order.id, title: order.title, kind: mark.kind, open, status: order.status, label: open ? "Öppen" : order.status === "CANCELLED" ? "Utgått" : "Klar" };
}
/** Akut first, then the open ones, then by title. */
export const sortFollowUpRows = (rows: readonly RoundFollowUpRow[]) => [...rows].sort((a, b) => Number(b.open) - Number(a.open) || (a.kind === b.kind ? 0 : a.kind === "URGENT" ? -1 : 1) || a.title.localeCompare(b.title, "sv"));

// ---------- the notices ----------

/**
 * A new work order from the round tells the company's arbetsledare (the work profiles Arbetsledare and Underhållsledare) and
 * administrators – never the person who made it, only active members. A NoticeDelivery row with the channel ROUND_FOLLOW_UP and
 * the key `ROUND_FOLLOW_UP:<work order id>` (as "Hinder rapporterat"). An Akut one stands under Kräver åtgärd, so it also goes
 * by e-mail and push from the start (lib/workflow/notification-list.ts); a planned one is in the app (and by e-mail for those
 * who chose Driftronder). It is shown while the work order is open, at most ROUND_FOLLOW_UP_NOTICE_DAYS.
 */
export const ROUND_FOLLOW_UP_CHANNEL = "ROUND_FOLLOW_UP";
export const ROUND_FOLLOW_UP_PREFIX = "ROUND_FOLLOW_UP:";
/** The bell's id of an Akut one: what "Kräver åtgärd" looks for. */
export const ROUND_FOLLOW_UP_URGENT_PREFIX = "ROUND_FOLLOW_UP:URGENT:";
export const ROUND_FOLLOW_UP_NOTICE_LIMIT = 50;
export const ROUND_FOLLOW_UP_NOTICE_DAYS = 14;
export const LEAD_WORK_PROFILES: readonly string[] = ["work_lead", "maintenance_lead"];

export const roundFollowUpNoticeKey = (workOrderId: string) => `${ROUND_FOLLOW_UP_PREFIX}${workOrderId}`;
export function parseRoundFollowUpNoticeKey(key: string) {
  if (!key.startsWith(ROUND_FOLLOW_UP_PREFIX)) return null;
  const id = key.slice(ROUND_FOLLOW_UP_PREFIX.length);
  return id && !id.includes("|") && !id.includes(":") ? { workOrderId: id } : null;
}

export function roundFollowUpRecipients(input: { actorId: string; members: readonly { userId: string; admin: boolean; profile: string | null }[] }): string[] {
  const wanted = input.members.filter((member) => member.admin || (member.profile !== null && LEAD_WORK_PROFILES.includes(member.profile)));
  return [...new Set(wanted.map((member) => member.userId).filter((id) => id !== input.actorId))];
}

const oneLine = (value: string, max: number) => value.replace(/[\r\n*[\]()]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

/** The bell's items: kind ROUND (the Driftronder choice), newest first; a closed, unreadable or old work order is not shown. */
export function roundFollowUpNotifications(rows: readonly { createdAt: Date; byName: string; order: { id: string; title: string; status: string; dueDate: string; plannedStartDate?: string; data: unknown } | null }[], now: Date): TaskNotification[] {
  const oldest = now.getTime() - ROUND_FOLLOW_UP_NOTICE_DAYS * 86_400_000;
  return rows.flatMap((row): TaskNotification[] => {
    const order = row.order;
    const mark = order ? roundFollowUpOf(order.data) : null;
    if (!order || !mark || CLOSED.has(order.status) || row.createdAt.getTime() < oldest) return [];
    const urgent = mark.kind === "URGENT";
    const by = oneLine(row.byName, 80) || "En kollega";
    const day = /^\d{4}-\d{2}-\d{2}$/.test(order.plannedStartDate ?? "") ? order.plannedStartDate! : /^\d{4}-\d{2}-\d{2}$/.test(order.dueDate) ? order.dueDate : "";
    return [{
      id: `${ROUND_FOLLOW_UP_PREFIX}${mark.kind}:${order.id}`, title: order.title, kind: "ROUND", label: urgent ? "Akut från ronden" : "Från ronden",
      detail: urgent ? `${by} hittade en brist i ronden och skapade en akut arbetsorder.` : `${by} hittade en brist i ronden och skapade en planerad arbetsorder${day ? ` till ${day}` : ""}.`,
      href: `/?view=workflow_task&taskId=${encodeURIComponent(order.id)}&taskType=WORK_ORDER`, dueDate: day, deadline: null, needsAction: urgent,
      assignedBy: by, assignedAt: row.createdAt.toISOString(),
    }];
  }).sort((a, b) => (b.assignedAt ?? "").localeCompare(a.assignedAt ?? "") || a.id.localeCompare(b.id));
}
