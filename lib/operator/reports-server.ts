import "server-only";
import { prisma } from "@/lib/db";
import { ApiError, requireModule, type Context } from "@/lib/kfid/server";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { read, remove, store } from "@/lib/kfid/storage";
import { serverExtensions } from "@/lib/extensions/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { prepareAttachmentFile } from "@/lib/workflow/attachment-file";
import { asOwnTree, nodePath, openReportsUpward, visibleNodes, type FaultPhoto, type MachineNode } from "@/lib/operator/machines";
import { maintenancePort } from "@/lib/operator/maintenance-port";
import { callsOnCall, faultReportInputSchema, onCallState, operatorMachineStatus, REPORT_PHOTO_LIMIT, REPORT_STATUS_TONE, reportStatusLabel, SEVERITY_LABELS, type Severity } from "@/lib/operator/rules";
import { notifyFaultOnCall } from "@/lib/operator/on-call-store";
import { operatorAudit } from "@/lib/operator/accounts-server";
import { productOperatorSettings } from "@/lib/operator/settings-server";
import type { OperatorContext } from "@/lib/operator/session";

/**
 * Felanmälan (2026-10-30): what the operator page reads and sends. Every read and write is inside the operator's
 * own company and only for the machines the account sees; a machine outside them answers as one that does not exist.
 * The report is ours (OperatorFaultReport); the corrective maintenance item and its work order come from the maintenance
 * port (lib/operator/machines.ts).
 */
export const MY_REPORTS_LIMIT = 30;

async function accountNodes(operator: OperatorContext) {
  const [tree, chosen] = await Promise.all([
    maintenancePort().tree(operator.organizationId),
    prisma.operatorAccountMachine.findMany({ where: { accountId: operator.account.id, organizationId: operator.organizationId }, select: { nodeId: true } }),
  ]);
  return { tree, visible: visibleNodes(tree, chosen.map((row) => row.nodeId)) };
}

/** listOperatorMachines: the nodes the account may see, as a tree of their own, with each node's full path. */
export async function listOperatorMachines(operator: OperatorContext) {
  const { tree, visible } = await accountNodes(operator);
  return asOwnTree(visible).map((node) => ({ ...node, path: nodePath(tree, node.id) }));
}

const accountName = (operator: OperatorContext) => operator.account.kind === "microsoft" ? operator.account.displayName || "Microsoft-konto" : operator.account.username;

/** Everything the signed-in operator's page shows. */
export async function operatorPageData(operator: OperatorContext, now = new Date()) {
  const machines = await listOperatorMachines(operator);
  const ids = machines.map((node) => node.id);
  const [reports, open, runStates, product] = await Promise.all([
    prisma.operatorFaultReport.findMany({
      where: { organizationId: operator.organizationId, accountId: operator.account.id }, orderBy: { createdAt: "desc" }, take: MY_REPORTS_LIMIT,
      select: { id: true, machineLabel: true, machineNodeId: true, cause: true, severity: true, status: true, taskId: true, workOrderLabel: true, reporterName: true, onCall: true, acknowledgedAt: true, createdAt: true },
    }),
    prisma.operatorFaultReport.findMany({
      where: { organizationId: operator.organizationId, machineNodeId: { in: ids }, status: { in: ["received", "pending"] }, createdAt: { gte: new Date(now.getTime() - 90 * 24 * 3_600_000) } },
      take: 500, select: { machineNodeId: true, status: true, taskId: true },
    }),
    maintenancePort().runStates(operator.organizationId, ids),
    productOperatorSettings(),
  ]);
  const statuses = await maintenancePort().workStatuses(operator.organizationId, [...new Set([...reports, ...open].flatMap((row) => row.taskId ? [row.taskId] : []))]);
  const openByNode = new Map<string, number>();
  for (const row of open) {
    const taskStatus = row.taskId ? statuses.get(row.taskId) ?? null : null;
    if (row.status === "pending" || (taskStatus && taskStatus !== "COMPLETED" && taskStatus !== "CANCELLED")) openByNode.set(row.machineNodeId, (openByNode.get(row.machineNodeId) ?? 0) + 1);
  }
  const openUpward = openReportsUpward(machines, openByNode);
  return {
    company: operator.organization.name,
    account: { name: accountName(operator), shared: operator.account.shared, kind: operator.account.kind },
    inactivityMinutes: operator.settings.inactivityMinutes,
    causes: operator.settings.causes,
    workday: { startMinutes: operator.organization.workdayStartMinutes, endMinutes: operator.organization.workdayEndMinutes },
    intake: operator.settings.intake,
    ai: product.aiTroubleshooting && operator.settings.aiTroubleshooting,
    // A place only groups: it says something only when something under it is reported.
    machines: machines.map((node) => ({ ...node, status: !node.reportable && !openUpward.get(node.id) && !node.operatingState ? { label: "", tone: "neutral" as const } : operatorMachineStatus({ openReports: openUpward.get(node.id) ?? 0, operatingState: node.operatingState, runState: runStates.get(node.id) ?? null }) })),
    reports: reports.map((report) => {
      const label = reportStatusLabel(report.status, report.taskId ? statuses.get(report.taskId) ?? null : null);
      return {
        id: report.id, machine: report.machineLabel, cause: report.cause, severity: report.severity as Severity, severityLabel: SEVERITY_LABELS[report.severity as Severity] ?? report.severity,
        workOrder: report.workOrderLabel, by: report.reporterName, at: report.createdAt.toISOString(), status: label, tone: REPORT_STATUS_TONE[label],
        onCall: onCallState(report),
      };
    }),
  };
}

/** The photos as they are stored: turned upright and made JPEG, at most REPORT_PHOTO_LIMIT. */
async function preparePhotos(files: readonly File[]): Promise<FaultPhoto[]> {
  if (files.length > REPORT_PHOTO_LIMIT) throw new ApiError(400, `Högst ${REPORT_PHOTO_LIMIT} bilder.`);
  const photos: FaultPhoto[] = [];
  for (const file of files) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new ApiError(400, "Välj bilder (JPG, PNG eller WebP).");
    const prepared = await prepareAttachmentFile(file);
    photos.push({ buffer: prepared.buffer, filename: file.name.slice(0, 200) || "bild.jpg", mimeType: prepared.mimeType, extension: prepared.extension });
  }
  return photos;
}

/** createFaultReport: the report, its photos, the corrective work (or the approval list) and, when it is urgent, the on-call path. */
export async function createFaultReport(operator: OperatorContext, raw: unknown, files: readonly File[], now = new Date()) {
  // Företagets moduler (0.39.0): the operator page stands on Underhåll's machine tree and makes its maintenance item.
  if (!organizationModuleOn(operator.organization, "upkeep")) throw new ApiError(409, "Felanmälan är avstängd för företaget just nu. Kontakta din administratör.");
  const input = faultReportInputSchema.parse(raw);
  const limit = await hitRateLimit(RATE_RULES.operatorReport, operator.account.id);
  if (!limit.allowed) throw new ApiError(429, "För många felanmälningar på kort tid. Vänta en stund.");
  const access = await serverExtensions.cloudWriteAccess(operator.organizationId, now);
  if (!access.allowed) throw new ApiError(423, "Felanmälan är pausad för företaget just nu. Kontakta din administratör.");
  const { tree, visible } = await accountNodes(operator);
  const machine = visible.find((node) => node.id === input.machineId);
  if (!machine || !machine.reportable) throw new ApiError(404, "Maskinen finns inte bland dina maskiner.");
  if (!operator.settings.causes.includes(input.cause)) throw new ApiError(400, "Välj en orsak i listan.");
  const photos = await preparePhotos(files);
  const onCall = callsOnCall(input.severity, now, { startMinutes: operator.organization.workdayStartMinutes, endMinutes: operator.organization.workdayEndMinutes });
  // Godkännandelistan (company setting) – but a report that calls the on-call person never waits for an approval.
  const pending = operator.settings.intake === "approval" && !onCall;
  const path = nodePath(tree, machine.id);
  const name = accountName(operator);
  const reporterName = operator.account.shared ? input.reporterName : "";
  const stored: string[] = [];
  const report = await prisma.operatorFaultReport.create({
    data: { organizationId: operator.organizationId, accountId: operator.account.id, accountName: name, reporterName, machineNodeId: machine.id, machineLabel: path.slice(0, 300),
      alarmFacilityId: machine.alarmFacilityId, cause: input.cause, text: input.text, severity: input.severity, status: pending ? "pending" : "received", onCall },
    select: { id: true },
  });
  try {
    for (const photo of photos) {
      const storagePath = await store(photo.buffer, photo.extension);
      stored.push(storagePath);
      await prisma.operatorFaultPhoto.create({ data: { organizationId: operator.organizationId, reportId: report.id, filename: photo.filename, storagePath, mimeType: photo.mimeType, size: photo.buffer.length } });
    }
    if (pending) return { id: report.id, status: "pending" as const, workOrder: "", onCall: false };
    const work = await maintenancePort().createCorrectiveWork({ organizationId: operator.organizationId, reportId: report.id, machine, machinePath: path, cause: input.cause, text: input.text, severity: input.severity, accountName: name, reporterName, photos, now, decidedById: null });
    await prisma.operatorFaultReport.updateMany({ where: { id: report.id, organizationId: operator.organizationId }, data: { taskId: work.workOrderId, workOrderLabel: work.workOrderLabel, maintenanceItemId: work.maintenanceItemId, decidedAt: now } });
    if (onCall) await notifyFaultOnCall({ organizationId: operator.organizationId, reportId: report.id, taskId: work.workOrderId, alarmFacilityId: machine.alarmFacilityId, now });
    return { id: report.id, status: "received" as const, workOrder: work.workOrderLabel, onCall };
  } catch (error) {
    // Nothing half: the report and its photos go when the work order could not be made.
    await prisma.operatorFaultReport.deleteMany({ where: { id: report.id, organizationId: operator.organizationId } }).catch(() => undefined);
    for (const key of stored) await remove(key);
    throw error;
  }
}

/** Godkännandelistan (the company's admin): Godkänn makes the corrective work now; Avvisa closes the report. */
export async function decidePendingReport(ctx: Context, reportId: string, approve: boolean, now = new Date()) {
  if (approve) requireModule(ctx, "upkeep");
  const report = await prisma.operatorFaultReport.findFirst({
    where: { id: reportId, organizationId: ctx.organizationId, status: "pending" },
    select: { id: true, machineNodeId: true, machineLabel: true, cause: true, text: true, severity: true, accountName: true, reporterName: true, photos: { select: { filename: true, storagePath: true, mimeType: true } } },
  });
  if (!report) throw new ApiError(404, "Felanmälan finns inte i godkännandelistan.");
  if (!approve) {
    const { count } = await prisma.operatorFaultReport.updateMany({ where: { id: report.id, organizationId: ctx.organizationId, status: "pending" }, data: { status: "rejected", decidedAt: now, decidedById: ctx.user.id } });
    if (count) await operatorAudit(ctx, "operator_report_rejected", `Avvisade felanmälan ”${report.cause}” på ${report.machineLabel}.`);
    return { workOrder: "" };
  }
  // Claimed first, so two admins at once never make two work orders.
  const { count } = await prisma.operatorFaultReport.updateMany({ where: { id: report.id, organizationId: ctx.organizationId, status: "pending" }, data: { status: "received", decidedAt: now, decidedById: ctx.user.id } });
  if (!count) throw new ApiError(409, "Felanmälan är redan hanterad.");
  try {
    const tree = await maintenancePort().tree(ctx.organizationId);
    const machine: MachineNode = tree.find((node) => node.id === report.machineNodeId) ?? { id: report.machineNodeId, parentId: null, name: report.machineLabel, objectType: "", reportable: true, alarmFacilityId: null, operatingState: "" };
    const photos: FaultPhoto[] = [];
    for (const photo of report.photos) photos.push({ buffer: await read(photo.storagePath), filename: photo.filename, mimeType: photo.mimeType, extension: photo.storagePath.split(".").pop() ?? "jpg" });
    const work = await maintenancePort().createCorrectiveWork({ organizationId: ctx.organizationId, reportId: report.id, machine, machinePath: report.machineLabel, cause: report.cause, text: report.text,
      severity: report.severity as Severity, accountName: report.accountName, reporterName: report.reporterName, photos, now, decidedById: ctx.user.id });
    await prisma.operatorFaultReport.updateMany({ where: { id: report.id, organizationId: ctx.organizationId }, data: { taskId: work.workOrderId, workOrderLabel: work.workOrderLabel, maintenanceItemId: work.maintenanceItemId } });
    await operatorAudit(ctx, "operator_report_approved", `Godkände felanmälan ”${report.cause}” på ${report.machineLabel}: arbetsorder ${work.workOrderLabel}.`);
    return { workOrder: work.workOrderLabel };
  } catch (error) {
    await prisma.operatorFaultReport.updateMany({ where: { id: report.id, organizationId: ctx.organizationId, taskId: null }, data: { status: "pending", decidedAt: null, decidedById: null } });
    throw error;
  }
}

export { REPORT_STATUS_TONE };
