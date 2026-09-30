import { prisma } from "@/lib/db";
import { visibleFormsWhere } from "@/lib/kfid/form-server";
import type { Context } from "@/lib/kfid/server";
import { formScheduleRuleSchema, parseScheduleReminders, scheduleViews, type FormSchedule } from "@/lib/workflow/form-schedule";
import { formPermissionArea, hasWorkflowPermission } from "@/lib/workflow/permissions";

export const ROUND_WINDOW_DAYS = 45;

/**
 * The company's rounds as the person may see them (2026-09-28): schedules of forms they may read, each with what is due,
 * missed and coming from the protocols of the last 45 days. Shared by Driftronder and the bell (2026-09-30).
 */
export async function loadScheduleViews(ctx: Pick<Context, "organizationId" | "admin" | "workflowPermissions">, today: string) {
  const rows = await prisma.formSchedule.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null }, orderBy: { title: "asc" }, take: 300,
    include: { customer: { select: { name: true, company: true } }, facility: { select: { name: true } } },
  });
  const templates = rows.length ? await prisma.formTemplate.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.templateId))] }, ...visibleFormsWhere(ctx.organizationId) }, select: { id: true, name: true, displayName: true, permissionArea: true } }) : [];
  const readable = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    return ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, formPermissionArea(template?.permissionArea), "read");
  };
  const projectIds = [...new Set(rows.flatMap((row) => row.projectId ? [row.projectId] : []))];
  const projects = projectIds.length ? await prisma.project.findMany({ where: { id: { in: projectIds }, organizationId: ctx.organizationId }, select: { id: true, name: true } }) : [];
  const schedules: FormSchedule[] = rows.filter((row) => readable(row.templateId)).flatMap((row) => {
    const rule = formScheduleRuleSchema.safeParse(row.rule);
    if (!rule.success) return [];
    const template = templates.find((item) => item.id === row.templateId);
    return [{
      id: row.id, version: row.version, title: row.title, templateId: row.templateId, customerId: row.customerId, facilityId: row.facilityId, projectId: row.projectId,
      assignedToUserId: row.assignedToUserId, assignedToName: row.assignedToName, active: row.active, rule: rule.data, reminders: parseScheduleReminders(row.reminders),
      templateName: template ? template.displayName || template.name : "Formuläret finns inte längre", facilityName: row.facility?.name ?? "",
      customerName: row.customer ? row.customer.company || row.customer.name : "", projectName: projects.find((project) => project.id === row.projectId)?.name ?? "",
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    }];
  });
  // Only the protocols of these schedules, and only from the window the overview shows.
  const since = new Date(Date.now() - ROUND_WINDOW_DAYS * 86_400_000);
  const tasks = schedules.length ? await prisma.workflowTask.findMany({
    where: { organizationId: ctx.organizationId, kind: "FORM", updatedAt: { gte: since }, OR: schedules.map((schedule) => ({ data: { path: ["details", "values", "round", "scheduleId"], equals: schedule.id } })) },
    select: { id: true, status: true, data: true }, take: 3000,
  }) : [];
  return scheduleViews(schedules, tasks, today);
}
