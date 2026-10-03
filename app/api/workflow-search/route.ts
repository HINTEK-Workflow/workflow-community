import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { listRecords, recordQuery } from "@/lib/kfid/records";
import { hasWorkflowPermission, readableTaskScope, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";

const querySchema = z.string().trim().min(2).max(100);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const q = querySchema.parse(new URL(request.url).searchParams.get("q"));
    const can = (subject: WorkflowPermissionSubject) =>
      ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    // Protocols follow their form's permission area (2026-09-27).
    const readable = readableTaskScope(can).any ? readableTaskWhere(can) : null;
    const text = { contains: q, mode: "insensitive" as const };
    // Files by name as well (2026-09-30), so the app, Workflow AI and MCP share one search: control attachments with the
    // control read right, task attachments within the readable tasks.
    const [projects, tasks, controls, customers, controlFiles, taskFiles] = await Promise.all([
      can("projects") ? prisma.project.findMany({
        where: { organizationId: ctx.organizationId, OR: [{ name: text }, { description: text }, { responsibleName: text }, { customer: { is: { OR: [{ name: text }, { company: text }] } } }] },
        orderBy: { updatedAt: "desc" }, take: 6,
        select: { id: true, name: true, description: true, responsibleName: true, archivedAt: true },
      }) : [],
      readable ? prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, AND: [readable], OR: [{ title: text }, { description: text }, { assignedToName: text }, { project: { is: { name: text } } }, { customer: { is: { OR: [{ name: text }, { company: text }] } } }] },
        orderBy: { updatedAt: "desc" }, take: 6,
        select: { id: true, title: true, description: true, kind: true, status: true, projectId: true, assignedToName: true },
      }) : [],
      can("kfid") ? listRecords(ctx, recordQuery.parse({ kind: "controls", q, limit: 6 })) : Promise.resolve({ items: [] }),
      listRecords(ctx, recordQuery.parse({ kind: "customers", q, limit: 6 })),
      can("kfid") ? prisma.attachment.findMany({
        where: { organizationId: ctx.organizationId, filename: text, control: { is: { deletedAt: null } } }, orderBy: { createdAt: "desc" }, take: 6,
        select: { id: true, filename: true, control: { select: { id: true, number: true, title: true } } },
      }) : [],
      readable ? prisma.workflowTaskAttachment.findMany({
        where: { organizationId: ctx.organizationId, filename: text, task: { is: { AND: [readable] } } }, orderBy: { createdAt: "desc" }, take: 6,
        select: { id: true, filename: true, task: { select: { id: true, title: true, kind: true } } },
      }) : [],
    ]);
    return NextResponse.json({
      projects: projects.map((project) => ({ ...project, archivedAt: project.archivedAt?.toISOString() ?? null })),
      tasks,
      controls: controls.items,
      customers: customers.items,
      files: [
        ...controlFiles.map((file) => ({ id: file.id, filename: file.filename, ownerTitle: `Kontroll #${file.control.number} ${file.control.title}`, href: `/?view=new&id=${encodeURIComponent(file.control.id)}` })),
        ...taskFiles.map((file) => ({ id: file.id, filename: file.filename, ownerTitle: file.task.title, href: `/?view=workflow_task&taskId=${encodeURIComponent(file.task.id)}&taskType=${file.task.kind}` })),
      ],
    });
  } catch (error) {
    return failure(error);
  }
}
