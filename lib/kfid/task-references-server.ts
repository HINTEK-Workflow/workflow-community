import type { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { assertFacilityLink } from "@/lib/kfid/facility-server";
import { linkWorkOrder } from "@/lib/kfid/work-order-link-server";
import { taskDueDateError } from "@/lib/workflow/project-frame";
import type { workflowTaskInputSchema } from "@/lib/workflow/task-model";
import { assigneeReadRefusal, memberMayReadJob } from "@/lib/workflow/assignee-access";
import type { WorkflowPermissionSubject } from "@/lib/workflow/permissions";

/**
 * The customer and place of a project, task or round (2026-10-08): the customer belongs to the company and is
 * not deleted, and the place belongs to that customer in the same company (and is active unless already linked). The
 * page's picker follows the same rules, but only this decides. The database's composite keys refuse a row that points
 * at another company even if this were bypassed.
 */
export async function assertCustomerAndPlace(organizationId: string, input: { customerId: string | null | undefined; facilityId: string | null | undefined; previousFacilityId?: string | null }) {
  if (input.customerId && !(await prisma.customer.findFirst({ where: { id: input.customerId, organizationId, deletedAt: null }, select: { id: true } })))
    throw new ApiError(400, "Kunden hittades inte.");
  await assertFacilityLink(organizationId, input);
}

/**
 * Everything a saved task points at, within the company: its work order, project (open, its customer, its frame),
 * customer, place and responsible member. Moved out of the route (2026-10-08) so it can be tested on its own.
 */
export async function verifyTaskReferences(organizationId: string, input: z.infer<typeof workflowTaskInputSchema>, access: { canReadWorkOrders?: boolean; userId?: string | null; formArea?: string | null;
  /** The job's permission area: a newly chosen responsible person must be able to read it (simulation 2026-10-10). */
  subject?: WorkflowPermissionSubject } = {}) {
  // Hör till arbetsorder (Fas 2): the work order first, so a new task takes its project, customer and place before the checks below.
  await linkWorkOrder(organizationId, input, access);
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true, archivedAt: true, closedAt: true, customerId: true, startDate: true, dueDate: true } });
    if (!project) throw new ApiError(400, "Projektet hittades inte.");
    if (project.archivedAt) throw new ApiError(409, "Återställ projektet innan du sparar en uppgift i det.");
    if (project.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du lägger till eller ändrar uppgifter i det.");
    // The project is the frame (2026-09-26): its customer applies to its tasks, and a new or changed
    // "Klart senast" must lie within its start and end. An unchanged older date outside the frame stays a warning.
    if (project.customerId && input.customerId !== project.customerId) throw new ApiError(400, "En uppgift i projektet har projektets kund.");
    const previous = input.id ? await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId }, select: { dueDate: true, projectId: true } }) : null;
    const dueChanged = !previous || previous.dueDate !== input.dueDate || previous.projectId !== input.projectId;
    const dueError = dueChanged ? taskDueDateError(input.dueDate, project) : null;
    if (dueError) throw new ApiError(400, dueError);
  }
  const previousFacility = input.id && input.facilityId ? await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId }, select: { facilityId: true } }) : null;
  await assertCustomerAndPlace(organizationId, { customerId: input.customerId, facilityId: input.facilityId, previousFacilityId: previousFacility?.facilityId });
  if (!input.assignedToUserId) return;
  const member = await prisma.organizationMember.findFirst({ where: { organizationId, userId: input.assignedToUserId, isActive: true }, select: { role: true, workflowPermissions: true, user: { select: { name: true, email: true } } } });
  if (!member) throw new ApiError(400, "Ansvarig användare tillhör inte arbetsytan.");
  // Ansvarig must be able to read the job (simulation 2026-10-10): checked when the responsible person is chosen, so a
  // job whose person later lost the permission can still be saved (and given to someone else).
  if (!access.subject || memberMayReadJob(member, access.subject)) return;
  // A linked task's responsible person is its work order's (2026-10-30, Grunduppgifter are shared): chosen and checked
  // on the work order. Reading the task is still decided by the person's own rights on every read.
  if (input.kind !== "WORK_ORDER" && input.workOrderId) return;
  const stored = input.id ? await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId }, select: { assignedToUserId: true } }) : null;
  if (stored?.assignedToUserId === input.assignedToUserId) return;
  throw new ApiError(400, assigneeReadRefusal(member.user.name || input.assignedToName || member.user.email, access.subject));
}
