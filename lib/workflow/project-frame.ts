import { z } from "zod";
import { swedishDayKey } from "@/lib/swedish-time";
import { facilityLabel } from "./customer-facility";

/** One entry in the project's append-only decision log (2026-09-26): date, text and who decided. */
export const projectDecisionInputSchema = z.object({
  decidedOn: z.iso.date(),
  text: z.string().trim().min(1, "Beskriv beslutet.").max(2000),
  decidedBy: z.string().trim().min(1, "Ange vem som beslutade.").max(160),
});
export type ProjectDecision = z.infer<typeof projectDecisionInputSchema> & { id: string; actorName: string; createdAt: string };

/**
 * The project is the frame (2026-09-26, decisions 1–4). A project's frame is its start and end date (YYYY-MM-DD,
 * Swedish calendar days). Existing projects may lack a frame; they are then shown with a prompt to set one, and no
 * frame rule applies. Pure functions, shared by Cloud, Local and the demo.
 */
export type ProjectFrame = { startDate: string; dueDate: string };

export const hasProjectFrame = (frame: Partial<ProjectFrame> | null | undefined): frame is ProjectFrame => Boolean(frame?.startDate && frame?.dueDate);

/** Both or neither; start on or before end. Returns an error message or null. */
export function projectFrameError(frame: ProjectFrame, required: boolean) {
  if (!frame.startDate && !frame.dueDate) return required ? "Ange projektets start- och slutdatum." : null;
  if (!frame.startDate || !frame.dueDate) return "Ange både start- och slutdatum för projektets tidsram.";
  if (frame.startDate > frame.dueDate) return "Projektets startdatum måste vara före eller samma dag som slutdatumet.";
  return null;
}

export const dayInFrame = (day: string, frame: ProjectFrame) => day >= frame.startDate && day <= frame.dueDate;

/** A task's "Klart senast" must lie within the project's frame. */
export function taskDueDateError(dueDate: string, frame: Partial<ProjectFrame> | null | undefined) {
  if (!dueDate || !hasProjectFrame(frame) || dayInFrame(dueDate, frame)) return null;
  return `Klart senast måste ligga inom projektets tidsram (${frame.startDate}–${frame.dueDate}).`;
}

/**
 * Planning must stay within the project's frame (decision 4): its first and last Swedish day inside start–end.
 * An activity ending exactly at midnight belongs to the day before.
 */
export function planningFrameError(activity: { startsAt: string | Date; endsAt: string | Date }, frame: Partial<ProjectFrame> | null | undefined) {
  if (!hasProjectFrame(frame)) return null;
  const first = swedishDayKey(activity.startsAt);
  const last = swedishDayKey(new Date(new Date(activity.endsAt).getTime() - 1));
  if (first >= frame.startDate && last <= frame.dueDate) return null;
  return `Planeringen ligger utanför projektets tidsram (${frame.startDate}–${frame.dueDate}).`;
}

/** Advisory only: planning that ends after the linked task's "Klart senast". */
export function planningAfterTaskDue(activity: { endsAt: string | Date }, taskDueDate: string | undefined) {
  if (!taskDueDate) return false;
  return swedishDayKey(new Date(new Date(activity.endsAt).getTime() - 1)) > taskDueDate;
}

/** Whole Swedish days to add to every date when a frame moves: by the start's change, or the end's if only it moved. */
export function frameShiftDays(before: Partial<ProjectFrame>, after: ProjectFrame) {
  const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  if (before.startDate && before.startDate !== after.startDate) return days(before.startDate, after.startDate);
  if (before.dueDate && before.dueDate !== after.dueDate) return days(before.dueDate, after.dueDate);
  return 0;
}

/** A YYYY-MM-DD day moved by whole days. */
export function shiftDay(day: string, days: number) {
  if (!day || !days) return day;
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const formatFrame = (frame: ProjectFrame) => `${frame.startDate} – ${frame.dueDate}`;

export type FrameIssue = { taskId: string; title: string; kind: "DUE_OUTSIDE_FRAME" | "CUSTOMER_DIFFERS"; message: string };

/**
 * Deviations from the project's frame in existing data. They are shown as warnings (decision 15) and are never
 * corrected automatically.
 */
export function projectFrameIssues(project: Partial<ProjectFrame> & { customerId?: string | null }, tasks: { id: string; title: string; dueDate?: string; customerId?: string | null; status?: string }[]): FrameIssue[] {
  const issues: FrameIssue[] = [];
  for (const task of tasks) {
    const dueError = task.status === "COMPLETED" ? null : taskDueDateError(task.dueDate ?? "", project);
    if (dueError) issues.push({ taskId: task.id, title: task.title, kind: "DUE_OUTSIDE_FRAME", message: `Klart senast ${task.dueDate} ligger utanför projektets tidsram.` });
    if (project.customerId && task.customerId !== undefined && task.customerId !== project.customerId)
      issues.push({ taskId: task.id, title: task.title, kind: "CUSTOMER_DIFFERS", message: "Uppgiften har en annan kund än projektet." });
  }
  return issues;
}

/** The fixed project fields that every task in the project shows read-only and every report prints (decision 2). */
export type ProjectFields = { client: string; contactPerson: string; reference: string; workSite: string; description: string };
export const PROJECT_FIELD_LABELS: [keyof ProjectFields, string][] = [
  ["client", "Beställare"],
  ["contactPerson", "Kontaktperson"],
  ["reference", "Referens / ordernummer"],
  ["workSite", "Arbetsplats / anläggning"],
  ["description", "Arbetsbeskrivning"],
];

/** Label/value rows for the non-empty project fields, in a fixed order; the linked customer facility comes first. */
export function projectFieldRows(project: Partial<ProjectFields> & { name?: string; facility?: Parameters<typeof facilityLabel>[0] | null }) {
  const rows = PROJECT_FIELD_LABELS.map(([key, label]) => [label, (project[key] ?? "").trim()] as const).filter(([, value]) => value);
  return project.facility ? [["Anläggning", facilityLabel(project.facility)] as const, ...rows] : rows;
}
