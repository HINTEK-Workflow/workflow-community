import { MACHINE_ORDER_CREATORS, OPERATOR_FAULT_CREATOR } from "@/lib/machine/alarm-rules";
import { bookJobHref } from "@/lib/workflow/bookings";

/**
 * Tilldela på larmets arbetsorder (2026-11-07): the pure rules behind the button and its dialog. The responsible person is
 * saved through the work order's own save (app/api/workflow-tasks, action save), so the server stays the only judge; more people are
 * booked in Planering, where the booking form opens with them ticked (`bookPeople`) and the server judges the booking again.
 */

export type AssignMember = { id: string; name: string; canRead?: boolean };

/**
 * An automatic machine work order: made by a machine alarm (S3) or by a fault report from the operator page (kundresan 2026-11-07,
 * H1: the fault report's order gets the same box, Jag tar den and Tilldela). The system is its creator.
 */
export const isAlarmWorkOrder = (task: { kind: string; createdBy?: string | null }) => task.kind === "WORK_ORDER" && MACHINE_ORDER_CREATORS.includes(task.createdBy ?? "");
/** The automatic order came from the operator page's fault report (not from a machine's own alarm). */
export const isFaultWorkOrder = (task: { kind: string; createdBy?: string | null }) => task.kind === "WORK_ORDER" && task.createdBy === OPERATOR_FAULT_CREATOR;

/** Why Tilldela cannot be used here, or null. The button stays, grey with this reason (never hidden from someone who sees the order). */
export function assignRefusal(input: { canEdit: boolean; projectFrozen: boolean }): string | null {
  if (!input.canEdit) return "Du får läsa men inte ändra arbetsordern. Be en arbetsledare tilldela den.";
  if (input.projectFrozen) return "Projektet är stängt eller arkiverat. Öppna projektet igen först.";
  return null;
}

/**
 * What the dialog sends: the responsible person when among the people offered, and the others to book – known, not the responsible
 * person, each once, and none at all where booking is not offered.
 */
export function assignChoice(input: { responsibleId: string; more: readonly string[]; memberIds: readonly string[]; canBookMore: boolean }) {
  const known = new Set(input.memberIds);
  const responsibleId = known.has(input.responsibleId) ? input.responsibleId : "";
  const more = input.canBookMore && responsibleId ? [...new Set(input.more)].filter((id) => known.has(id) && id !== responsibleId) : [];
  return { responsibleId, more };
}

/** The order's address with the dialog asked for (from the bell's alarm row): the editor opens Tilldela once the order is read. */
export const assignHref = (orderHref: string) => `${orderHref}${orderHref.includes("?") ? "&" : "?"}assign=1`;

const PEOPLE_LIMIT = 50;
const peopleId = /^[A-Za-z0-9_:-]{1,100}$/;

/** The booking form's address with the people ticked: the responsible person first, then the others. */
export function bookPeopleHref(taskId: string, people: readonly string[]) {
  const list = [...new Set(people)].filter((id) => peopleId.test(id)).slice(0, PEOPLE_LIMIT);
  return list.length ? `${bookJobHref(taskId)}&bookPeople=${encodeURIComponent(list.join(","))}` : bookJobHref(taskId);
}

/** `bookPeople` read back: well-formed ids, each once, at most fifty. Nothing here is permission – the form and the server decide. */
export function parseBookPeople(raw: string | null | undefined) {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((id) => id.trim()).filter((id) => peopleId.test(id)))].slice(0, PEOPLE_LIMIT);
}
