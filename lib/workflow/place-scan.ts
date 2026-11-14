import { formLeafBlocks, formRowLabel, type FormBlock, type FormValues } from "./form-document";
import { roundFormNotice, roundHref, type RoundOrderRef } from "./form-schedule";

/**
 * What a scanned QR label opens (2026-10-22: "QR-etiketten leder bara till ett jobb som har skapats på förhand,
 * själva scanningen skapar inte jobbet"). The label belongs to the round: a scan opens a round protocol that already
 * exists and is not completed (started on its day or ahead of it), at the scanned place's point. A round due without a
 * protocol yet is no job to open by itself. Svar 10 (2026-10-24): then the app asks "<Rond> ska göras i dag – Starta
 * ronden?" (or "Starta en extra rond?" when it is not planned today), and only the person's Starta creates the protocol – the
 * same way as Starta under Driftronder – which opens at the scanned point. The scan itself still creates nothing.
 *
 * Which rounds a place has (2026-10-27 kväll: the place comes with the work order): the rounds held by a work order at
 * the place (or above or below it) whose period holds the day – `roundAtPlaceToday`. The protocol is started in that work
 * order and takes its customer, place and project.
 */
export type ScanRound = {
  id: string; title: string; templateId: string; active: boolean;
  /** The occurrences whose protocol exists and is not completed (`scheduleOverview(...).started`). */
  started?: { date: string; taskId: string }[] | null;
  /** The occurrence to start now (today's or a missed one) and the next one, as on Driftronder (`scheduleOverview`). */
  current?: { date: string; state: string; taskId?: string | null; workOrderId?: string | null } | null;
  next?: string | null;
  /** The form is removed or no longer published: the round cannot be started; templateUnpublished says which. */
  templateMissing?: boolean; templateUnpublished?: boolean;
  /** The round's responsible person follows into the protocol, as from Driftronder. */
  assignedToUserId?: string | null; assignedToName?: string;
  /** The work order that holds the round today (at the scanned place): the protocol of today's occurrence is started in it. */
  workOrderId?: string | null;
};

/** Whether the work order holds the round on the day: a period that holds it, or (0.24.0) made for exactly that day; not cancelled. */
export function roundOrderHoldsDay(order: Pick<RoundOrderRef, "status" | "occurrence" | "from" | "to"> | null | undefined, day: string) {
  if (!order || order.status === "CANCELLED") return false;
  return order.occurrence ? order.occurrence === day : Boolean(order.from && order.to && order.from <= day && day <= order.to);
}

/** A round at a place (the place itself, or above or below it, `placeIds`): its work order for today stands there. */
export function roundAtPlaceToday(holder: (Pick<RoundOrderRef, "status" | "occurrence" | "from" | "to" | "facilityId">) | null | undefined, placeIds: readonly string[], today: string) {
  return Boolean(holder?.facilityId && placeIds.includes(holder.facilityId) && roundOrderHoldsDay(holder, today));
}
export type ScanJob = { roundId: string; title: string; date: string; taskId: string; href: string };
/** A round at the place to start after a scan: its occurrence, whether it is planned today, and the protocol's new address. */
export type ScanStart = { roundId: string; title: string; date: string; today: boolean; href: string;
  /** 2026-10-24: the round's form is not published (or removed) – the question shows this instead of Starta, and href is empty. */
  formNotice?: string | null };
export type ScanOutcome = { kind: "open"; job: ScanJob } | { kind: "choose"; jobs: ScanJob[] } | { kind: "start"; starts: ScanStart[] } | { kind: "none" };
/** The new protocol's address marks that the person pressed Starta after a scan: the page creates it at once and records the scan. */
export const SCAN_START_PARAM = "scanStart";

/** The open round protocols a scan of the place may open, one per protocol, the earliest day first. Paused rounds are left out. */
export function scanJobs(rounds: readonly ScanRound[], placeId: string): ScanJob[] {
  const seen = new Set<string>();
  const jobs: ScanJob[] = [];
  for (const round of rounds) {
    if (!round.active) continue;
    for (const occurrence of round.started ?? []) {
      if (!occurrence.taskId || seen.has(occurrence.taskId)) continue;
      seen.add(occurrence.taskId);
      jobs.push({ roundId: round.id, title: round.title, date: occurrence.date, taskId: occurrence.taskId, href: roundHref(round, occurrence, placeId) });
    }
  }
  return jobs.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "sv"));
}

/**
 * The rounds at the place that a scan may offer to start (svar 10): active and nothing started – the
 * occurrence Driftronder's Starta would start (today's or a missed one, else the next). Today's first, then by name.
 */
export function scanStarts(rounds: readonly ScanRound[], placeId: string, today: string): ScanStart[] {
  const starts: ScanStart[] = [];
  for (const round of rounds) {
    if (!round.active || round.started?.length) continue;
    const date = round.current && !round.current.taskId && round.current.state !== "done" ? round.current.date : !round.current ? round.next ?? null : null;
    if (!date) continue;
    // A round whose form is not published is still asked about, with the warning and no Starta (2026-10-24).
    const formNotice = roundFormNotice(round);
    if (formNotice) { starts.push({ roundId: round.id, title: round.title, date, today: date === today, href: "", formNotice }); continue; }
    // In the work order that holds the day when it is known (today's at the place); else the server finds it by the day.
    const workOrderId = round.current && round.current.date === date ? round.current.workOrderId ?? null : date === today ? round.workOrderId ?? null : null;
    const href = roundHref(round, { date, workOrderId }, placeId);
    starts.push({ roundId: round.id, title: round.title, date, today: date === today, href: `${href}&${SCAN_START_PARAM}=1` });
  }
  return starts.sort((a, b) => Number(b.today) - Number(a.today) || a.title.localeCompare(b.title, "sv"));
}

/** The question for one round to start: planned today, or an extra round. */
export function scanStartQuestion(start: Pick<ScanStart, "title" | "today">): string {
  return start.today ? `${start.title} ska göras i dag – Starta ronden?` : "Starta en extra rond?";
}

/**
 * One job opens at once, several are a short choice; without a started protocol a round at the place is offered to start
 * (`today` is the Swedish day); none leaves the place open with a short notice.
 */
export function scanOutcome(rounds: readonly ScanRound[], placeId: string, today = ""): ScanOutcome {
  const jobs = scanJobs(rounds, placeId);
  if (jobs.length === 1) return { kind: "open", job: jobs[0]! };
  if (jobs.length) return { kind: "choose", jobs };
  const starts = today ? scanStarts(rounds, placeId, today) : [];
  return starts.length ? { kind: "start", starts } : { kind: "none" };
}

/**
 * The point of a round protocol a scanned place stands for: the first checklist point or table row that names the place
 * (two letters or more; by name only since 2026-10-24), with the block that holds it, so the form opens at that part and marks it.
 */
export function scanPoint(document: { blocks: FormBlock[] }, values: Pick<FormValues, "tables">, place: { name: string } | null | undefined): { point: string; blockId: string } | null {
  // By the name only (2026-10-24): the marking belongs to the work order now, not to the place.
  const needle = place ? place.name.trim().toLowerCase() : "";
  if (needle.length < 2) return null;
  const names = (text: string) => text.toLowerCase().includes(needle);
  for (const block of formLeafBlocks(document)) {
    const point = block.type === "checklist" ? block.items.find((item) => names(item.text))?.text
      : block.type === "table" ? (values.tables[block.key] ?? []).map((row, index) => formRowLabel(block, row, index)).find(names) : undefined;
    if (point) return { point, blockId: block.id };
  }
  return null;
}
