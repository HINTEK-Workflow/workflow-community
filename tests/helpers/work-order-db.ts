import type { PrismaClient } from "@prisma/client";

// Arbetsordern styr (2026-10-26): the database requires a work order for every task. Database tests about
// something else put their protocols and risk assessments in a plain work order made here, with the same project,
// customer and place as the task.
const emptyOrder = { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } };

export async function workOrderFor(prisma: Pick<PrismaClient, "workflowTask">, input: { organizationId: string; projectId?: string | null; customerId?: string | null; facilityId?: string | null; createdBy?: string; title?: string }) {
  const order = await prisma.workflowTask.create({ data: {
    organizationId: input.organizationId, kind: "WORK_ORDER", title: input.title ?? "Arbetsorder", projectId: input.projectId ?? null, customerId: input.customerId ?? null, facilityId: input.facilityId ?? null,
    data: emptyOrder, createdBy: input.createdBy ?? "qa", updatedBy: input.createdBy ?? "qa",
  }, select: { id: true } });
  return order.id;
}
