import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { read } from "@/lib/kfid/storage";
import { workflowTaskDataSchema, workflowTaskKinds } from "./task-model";
import { workflowReportSectionKeys, type WorkflowReportOptions, type WorkflowReportTask } from "./report";
import { projectFieldRows } from "./project-frame";
import { facilityLabel } from "./customer-facility";
import { facilitySummarySelect } from "@/lib/kfid/facility-server";

export function workflowReportOptionsFromUrl(url: string): WorkflowReportOptions {
  const selected = new Set(new URL(url).searchParams.get("sections")?.split(",").filter(Boolean) ?? workflowReportSectionKeys);
  return Object.fromEntries(workflowReportSectionKeys.map((key) => [key, selected.has(key)])) as WorkflowReportOptions;
}

/**
 * The company's name, report colours and logo from Företagsinställningar, as the control's report uses them; a form
 * protocol's report has the same look (Daniel 2026-09-27). A logo that cannot be read is left out.
 */
export async function workflowReportIdentity(organizationId: string, fallbackName: string) {
  const settings = await prisma.workspaceSettings.findUnique({ where: { organizationId } });
  return {
    company: settings?.companyName || fallbackName,
    branding: { primary: settings?.reportPrimary, accent: settings?.reportAccent, soft: settings?.reportSoft },
    logoBytes: settings?.logoPath ? await read(settings.logoPath).then((bytes) => new Uint8Array(bytes)).catch(() => null) : null,
  };
}

export async function workflowReportFont() {
  return new Uint8Array(await readFile(path.join(process.cwd(), "public/fonts/DejaVuSans.ttf")));
}

export async function cloudWorkflowReportTask(organizationId: string, id: string): Promise<WorkflowReportTask | null> {
  const task = await prisma.workflowTask.findFirst({
    where: { id, organizationId },
    include: {
      project: { select: { id: true, name: true, client: true, contactPerson: true, reference: true, workSite: true, description: true, facility: { select: facilitySummarySelect } } },
      facility: { select: facilitySummarySelect },
      customer: { select: { name: true, company: true } },
      site: { select: { name: true } },
      timeEntries: true,
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!task) return null;
  const data = workflowTaskDataSchema.parse(task.data);
  const attachments = await Promise.all(task.attachments.map(async (item) => ({
    id: item.id,
    filename: item.filename,
    mimeType: item.mimeType,
    bytes: item.mimeType.startsWith("image/") ? new Uint8Array(await read(item.storagePath)) : undefined,
  })));
  return {
    id: task.id,
    kind: z.enum(workflowTaskKinds).parse(task.kind),
    formArea: task.formArea,
    title: task.title,
    description: task.description,
    status: z.enum(["PLANNED", "IN_PROGRESS", "PAUSED", "NEEDS_ACTION", "COMPLETED"]).parse(task.status),
    progress: task.progress,
    projectId: task.project?.id ?? null,
    projectName: task.project?.name,
    projectFields: task.project ? projectFieldRows(task.project) : undefined,
    customerName: task.customer?.company || task.customer?.name,
    siteName: task.site?.name,
    facilityName: task.facility ? facilityLabel(task.facility) : undefined,
    assignedToName: task.assignedToName,
    dueDate: task.dueDate,
    totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000)) : 0), 0),
    data,
    attachments,
  };
}
