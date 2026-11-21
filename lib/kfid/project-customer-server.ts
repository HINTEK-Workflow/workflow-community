import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { customerDisplayName, movedJobPlace, projectCustomerChange, type ProjectCustomerChange } from "@/lib/workflow/project-customer";

/**
 * Kundbyte på projekt (2026-10-10), Cloud: the change needs an explicit choice, like the work order's customer
 * (lib/kfid/work-order-link-server.ts). The route answers 409 with `customerChange` so the form can offer the choice.
 */
export class ProjectCustomerChangeRequired extends ApiError {
  constructor(public change: ProjectCustomerChange) {
    super(409, change.message);
  }
}

type Actor = { organizationId: string; admin: boolean; workflowPermissions: WorkflowPermissionProfile };
export type ProjectJobMove = { id: string; facilityId: string | null };

/**
 * Checks a project's customer change and returns the jobs to move with it. Throws ProjectCustomerChangeRequired when the
 * person has not chosen "Flytta jobben" (or when completed work blocks the change), and 403 when a job to move is one the
 * person may not edit. Everything is read within the caller's company.
 */
export async function planProjectCustomerChange(actor: Actor, input: { projectId: string; fromCustomerId: string | null; toCustomerId: string | null; toFacilityId: string | null; move: boolean }) {
  const to = input.toCustomerId;
  if (!to || input.fromCustomerId === to) return { moves: [] as ProjectJobMove[], summary: "" };
  const [jobs, quotes, customers] = await Promise.all([
    prisma.workflowTask.findMany({
      where: { organizationId: actor.organizationId, projectId: input.projectId, customerId: { not: null }, NOT: { customerId: to } },
      select: { id: true, title: true, kind: true, formArea: true, status: true, customerId: true, facilityId: true, facility: { select: { customerId: true } } },
    }),
    prisma.quote.findMany({ where: { organizationId: actor.organizationId, projectId: input.projectId, customerId: { not: null }, NOT: { customerId: to } }, select: { status: true, customerId: true } }),
    prisma.customer.findMany({ where: { organizationId: actor.organizationId, id: { in: [to, ...(input.fromCustomerId ? [input.fromCustomerId] : [])] } }, select: { id: true, name: true, company: true, customerType: true } }),
  ]);
  const nameOf = (customerId: string | null) => customerDisplayName(customers.find((customer) => customer.id === customerId));
  const change = projectCustomerChange({
    fromCustomerId: input.fromCustomerId, toCustomerId: to, fromName: nameOf(input.fromCustomerId), toName: nameOf(to),
    jobs: jobs.map((job) => ({ id: job.id, title: job.title, status: job.status, customerId: job.customerId })), quotes,
  });
  if (!change) return { moves: [] as ProjectJobMove[], summary: "" };
  if (change.blocked || !input.move) throw new ProjectCustomerChangeRequired(change);
  const movable = jobs.filter((job) => job.status !== "COMPLETED");
  const denied = movable.filter((job) => !(actor.admin || hasWorkflowPermission(actor.workflowPermissions, workflowSubjectForTask(job.kind, job.formArea), "edit")));
  if (denied.length) throw new ApiError(403, `Du saknar behörighet att ändra ${denied.length === 1 ? "ett av jobben" : `${denied.length} av jobben`} (${denied.slice(0, 3).map((job) => job.title).join(", ")}${denied.length > 3 ? " …" : ""}). Be en företagsadministratör att byta kund.`);
  const moves = movable.map((job) => ({ id: job.id, facilityId: movedJobPlace({ facilityId: job.facilityId, facilityCustomerId: job.facility?.customerId ?? null }, to, input.toFacilityId) }));
  const summary = `Projektets kund ändrades från ${change.fromName} till ${change.toName}${moves.length ? `; ${moves.length} jobb flyttades till den nya kunden` : ""}${change.quotes ? `; ${change.quotes} ${change.quotes === 1 ? "offert behöll" : "offerter behöll"} sin kund` : ""}`;
  return { moves, summary };
}

/** The writes that move the jobs, for the route's transaction (the version moves so open editors see the change). */
export function projectJobMoveWrites(tx: Pick<Prisma.TransactionClient, "workflowTask">, organizationId: string, customerId: string, moves: readonly ProjectJobMove[]) {
  return moves.map((move) => tx.workflowTask.updateMany({ where: { id: move.id, organizationId }, data: { customerId, facilityId: move.facilityId, version: { increment: 1 } } }));
}
