import { readFile } from "node:fs/promises";
import { customerComments } from "@/lib/comments/server";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { read } from "@/lib/kfid/storage";
import { customerReceiptOf, workflowTaskDataSchema, workflowTaskKinds, workflowTaskStatuses } from "./task-model";
import { protocolNumberOf, workflowReportSectionKeys, type WorkflowReportOptions, type WorkflowReportTask } from "./report";
import { projectFieldRows } from "./project-frame";
import { facilityLabel } from "./customer-facility";
import { facilitySummarySelect, loadPlaceSummary } from "@/lib/kfid/facility-server";
import { priceSettingsOf } from "@/lib/quotes/settings";
import { parseAmount } from "./expenses";
import { timeTypeRules } from "./time-types-server";
import type { TimeBillingLookup } from "./time-types";
import { customerTitle } from "@/lib/kfid/customer-name";
import { companySenderOf } from "@/lib/kfid/company";
import type { ReportFontSet } from "./report-fonts";
import { pdfTemplateOverrides } from "@/lib/pdf-templates/server";

/**
 * The report's parts from the address. Without `sections` every part is included – except the prices (2026-10-09),
 * which are printed only when asked for by name and `allowPrices` (the caller may see prices, lib/workflow/material-prices.ts).
 */
export function workflowReportOptionsFromUrl(url: string, allowPrices = false): WorkflowReportOptions {
  const named = new URL(url).searchParams.get("sections")?.split(",").filter(Boolean);
  const selected = new Set<string>(named ?? workflowReportSectionKeys.filter((key) => key !== "prices"));
  return Object.fromEntries(workflowReportSectionKeys.map((key) => [key, key === "prices" ? allowPrices && selected.has(key) : selected.has(key)])) as WorkflowReportOptions;
}

/**
 * The company's name, report colours and logo from Företagsinställningar, as the control's report uses them; a form
 * protocol's report has the same look (2026-09-27). A logo that cannot be read is left out. `sender` is what the
 * sender box of a customer document prints (beslut 5, 2026-11-01), from the company's profile. `templates` are the product
 * owner's PDF templates (PDF-mallar, 2026-11-03), the same for every company.
 */
export async function workflowReportIdentity(organizationId: string, fallbackName: string) {
  const [settings, templates] = await Promise.all([prisma.workspaceSettings.findUnique({ where: { organizationId } }), pdfTemplateOverrides()]);
  return {
    company: settings?.companyName || fallbackName,
    branding: { primary: settings?.reportPrimary, accent: settings?.reportAccent, soft: settings?.reportSoft },
    logoBytes: settings?.logoPath ? await read(settings.logoPath).then((bytes) => new Uint8Array(bytes)).catch(() => null) : null,
    sender: companySenderOf(settings?.profile),
    templates,
  };
}

/**
 * The company's hourly rate (Priser och offert) for the work in a work order report's total, read only when the prices
 * are printed (2026-11-01); null when none is set, so the total says the work is without a rate.
 */
export async function workflowReportHourlyRate(organizationId: string, options: Pick<WorkflowReportOptions, "prices">): Promise<number | null> {
  if (!options.prices) return null;
  const row = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { priceSettings: true } });
  const rate = parseAmount(priceSettingsOf(row?.priceSettings).hourlyRate);
  return rate === null || rate <= 0 ? null : rate;
}

/** The task's time as a customer's price report counts it: never a type the company does not bill; a type with its own price by itself. */
export function billedLabourOf(entries: readonly { durationSec: number; timeTypeId: string | null }[], billing: TimeBillingLookup): NonNullable<WorkflowReportTask["billedLabour"]> {
  let standardSec = 0;
  const own = new Map<string, { name: string; seconds: number; rate: number | null }>();
  for (const entry of entries) {
    const type = billing(entry.timeTypeId);
    if (type.billing === "company") standardSec += entry.durationSec;
    if (type.billing !== "own") continue;
    const line = own.get(type.typeId) ?? { name: type.name, seconds: 0, rate: parseAmount(type.price) };
    own.set(type.typeId, { ...line, seconds: line.seconds + entry.durationSec });
  }
  return { standardSec, own: [...own.values()] };
}

/** The document typeface (the PDF design 2026-11-03): Manrope Regular and Bold, with DejaVu Sans behind them for glyphs Manrope lacks. */
let reportFonts: Promise<ReportFontSet> | null = null;
/** The fonts are read once per process: the files never change while it runs. A failed read is tried again next time. */
export function workflowReportFont(): Promise<ReportFontSet> {
  reportFonts ??= (async () => {
    const load = async (name: string) => new Uint8Array(await readFile(path.join(process.cwd(), "public/fonts", name)));
    const [regular, bold, fallback] = await Promise.all([load("Manrope-Regular.ttf"), load("Manrope-Bold.ttf"), load("DejaVuSans.ttf")]);
    return { regular, bold, fallback };
  })().catch((cause) => { reportFonts = null; throw cause; });
  return reportFonts;
}

export async function cloudWorkflowReportTask(organizationId: string, id: string): Promise<WorkflowReportTask | null> {
  const task = await prisma.workflowTask.findFirst({
    where: { id, organizationId },
    include: {
      project: { select: { id: true, name: true, client: true, contactPerson: true, reference: true, workSite: true, staffRegister: true, description: true, facility: { select: facilitySummarySelect }, customer: { select: { name: true, company: true, customerType: true } } } },
      facility: { select: facilitySummarySelect },
      customer: { select: { name: true, company: true, customerType: true } },
      // Hör till arbetsorder (Fas 4B): printed on the report when the task belongs to one.
      workOrder: { select: { title: true, data: true } },
      timeEntries: true,
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!task) return null;
  const data = workflowTaskDataSchema.parse(task.data);
  // Underhåll (2026-10-30): the maintenance items the work order holds (Utgår left out), inside the company.
  // Kommentarer (beslut 14, 2026-11-01): only those chosen "Med i kundrapporten", inside the company.
  const comments = task.kind === "WORK_ORDER" ? await customerComments(organizationId, { type: "WORK_ORDER", id: task.id }) : [];
  const items = task.kind === "WORK_ORDER" ? await prisma.maintenanceItem.findMany({
    where: { organizationId, workOrderId: task.id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, take: 50,
    select: { type: true, priority: true, criticality: true, marking: true, fault: true, cause: true, causeNote: true, reportedAt: true, stoppedAt: true, restoredAt: true, part: { select: { name: true } } },
  }) : [];
  // Avvikelser i loggen från protokollet som inte är klara (kundresa 2026-11-07, M22), inside the company.
  const logged = task.kind === "FORM" ? await prisma.selfInspectionDeviation.findMany({
    where: { organizationId, sourceTaskId: task.id, status: { not: "DONE" } }, orderBy: { number: "asc" }, take: 20, select: { number: true, title: true, status: true },
  }) : [];
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  // Reports print a place's whole way with the facility's address (Platser, 2026-10-04).
  const [place, projectPlace] = await Promise.all([loadPlaceSummary(organizationId, task.facilityId), loadPlaceSummary(organizationId, task.project?.facility?.id)]);
  const attachments = await Promise.all(task.attachments.map(async (item) => ({
    id: item.id,
    filename: item.filename,
    mimeType: item.mimeType,
    receipt: item.receipt,
    bytes: item.mimeType.startsWith("image/") ? new Uint8Array(await read(item.storagePath)) : undefined,
  })));
  return {
    id: task.id,
    kind: z.enum(workflowTaskKinds).parse(task.kind),
    formArea: task.formArea,
    version: task.version,
    title: task.title,
    description: task.description,
    status: z.enum(workflowTaskStatuses).parse(task.status),
    progress: task.progress,
    projectId: task.project?.id ?? null,
    projectName: task.project?.name,
    workOrderTitle: task.workOrder?.title || undefined,
    // Protokollmallen (beslut 6, 2026-11-01): the protocol's fixed number, when it was finished and the customer's receipt.
    ...(task.kind === "FORM" ? { protocolNumber: protocolNumberOf(task.id) } : {}),
    completedAt: task.completedAt?.toISOString() ?? null,
    customerReceipt: customerReceiptOf(data) ?? customerReceiptOf(task.workOrder?.data),
    projectFields: task.project ? projectFieldRows({ ...task.project, facility: projectPlace ?? task.project.facility }) : undefined,
    customerName: customerTitle(task.customer),
    facilityName: place ? facilityLabel(place) : task.facility ? facilityLabel(task.facility) : undefined,
    assignedToName: task.assignedToName,
    dueDate: task.dueDate,
    totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000)) : 0), 0),
    billedLabour: billedLabourOf(task.timeEntries, (await timeTypeRules(organizationId)).billing),
    data,
    customerComments: comments,
    ...(logged.length ? { loggedDeviations: logged } : {}),
    maintenanceItems: items.map(({ part, reportedAt, stoppedAt, restoredAt, ...facts }) => ({ partName: part.name, facts: { ...facts, reportedAt: iso(reportedAt), stoppedAt: iso(stoppedAt), restoredAt: iso(restoredAt) } })),
    attachments,
  };
}
