import { normalizeControl, validateForCompletion } from "@/lib/kfid/model";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { controlProgress } from "@/lib/workflow/project-progress";
import { workflowTaskProgress } from "@/lib/workflow/task-model";
import type { CustomerCardData, CustomerCardKind, CustomerCardTask } from "./customer-card";
import { localCustomerItem, type LocalWorkspaceDocument } from "./local-workspace-store";

const PAGE_SIZE = 12;

/**
 * The customer card from the open .hwf file: the same shape and paging as Cloud's /api/customer-card. The file owner
 * is the local administrator, so every module is readable and facilities can be paused.
 */
export function localCustomerCardData(workspace: LocalWorkspaceDocument, customerId: string, kind: CustomerCardKind, page: number): CustomerCardData {
  const customer = workspace.customers.find((item) => item.id === customerId);
  if (!customer) throw new Error("Kunden hittades inte i den lokala arbetsytan.");
  const facilities = workspace.customerFacilities.filter((facility) => facility.customerId === customerId);
  const links = (facilityId: string) => workspace.projects.filter((project) => project.facilityId === facilityId).length
    + workspace.workflowTasks.filter((task) => task.facilityId === facilityId).length
    + workspace.controls.filter((control) => control.facilityId === facilityId && !control.deletedAt).length;
  const projectName = (projectId: string | null) => projectId ? workspace.projects.find((project) => project.id === projectId)?.name ?? "" : "";
  const tasks: CustomerCardTask[] = [
    ...workspace.workflowTasks.filter((task) => task.customerId === customerId).map((task) => ({ id: task.id, kind: task.kind as string, title: task.title, status: task.status as string, progress: workflowTaskProgress(task), updatedAt: task.updatedAt, facilityId: task.facilityId, projectName: projectName(task.projectId) })),
    ...workspace.controls.filter((control) => control.customerId === customerId && !control.deletedAt).map((control) => ({
      id: control.id, number: control.number, kind: "COMMISSIONING_CONTROL", title: control.title, status: control.status as string, updatedAt: control.updatedAt, facilityId: control.facilityId, projectName: projectName(control.projectId),
      progress: controlProgress(control.status, validateForCompletion(normalizeControl(control.data), { attachmentCount: workspace.attachments.filter((attachment) => attachment.controlId === control.id).length }).progress.percent),
    })),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const counts: Record<CustomerCardKind, number> = {
    all: tasks.length,
    WORK_ORDER: tasks.filter((task) => task.kind === "WORK_ORDER").length,
    RISK_ASSESSMENT: tasks.filter((task) => task.kind === "RISK_ASSESSMENT").length,
    FORM: tasks.filter((task) => task.kind === "FORM").length,
    COMMISSIONING_CONTROL: tasks.filter((task) => task.kind === "COMMISSIONING_CONTROL").length,
  };
  const filtered = kind === "all" ? tasks : tasks.filter((task) => task.kind === kind);
  return {
    customer: { ...localCustomerItem(customer), lat: customer.lat ?? null, lng: customer.lng ?? null },
    facilities: [...facilities].sort((left, right) => Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name, "sv")).map((facility) => ({ ...facility, links: links(facility.id) })),
    projects: workspace.projects.filter((project) => project.customerId === customerId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((project) => ({
      id: project.id, name: project.name, startDate: project.startDate, dueDate: project.dueDate, facilityId: project.facilityId,
      status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate,
        tasks: [...workspace.workflowTasks.filter((task) => task.projectId === project.id), ...workspace.controls.filter((control) => control.projectId === project.id && !control.deletedAt)],
        activities: workspace.plannedActivities.filter((activity) => activity.projectId === project.id) }),
    })),
    canReadProjects: true,
    tasks: { items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: filtered.length, page, pages: Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), counts },
    canManageFacilities: true,
  };
}
