import { createHash, randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, requireAdmin, requireCloudStorage, requireCloudWriteAccess, type Context } from "@/lib/kfid/server";
import type { ExtractedFile } from "@/lib/import/detect";
import { addSwedishDays, fromSwedishDateInput, swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { canViewTeam } from "@/lib/workflow/permissions";
import { timeEntryInOrganization } from "@/lib/workflow/timer-server";
import { ABSENCE_STATUS_LABELS, type AbsenceStatus, type AbsenceType } from "@/lib/workflow/absence";
import { previewAbsenceImport, previewEmployeeNumbers, readAbsenceRows, rowsToWrite, type AbsencePreview, type ConflictChoice, type ExistingAbsence, type ImportMember } from "./absence-import";
import { normalizeCode, sourceSystemKey, sourceSystemLabel, systemLabel, type CodeMap } from "./codes";
import { delimitedText, encodeText, exportBlockers, exportFileName, exportGaps, exportLeftOut, exportRefusal, exportRows, exportTemplateSchema, headerRow, PRESET_TEMPLATES, templateNameClash, type ExportAbsence, type ExportPerson, type ExportTemplate, type ExportTimeEntry } from "./export";
import { latin1Bytes, PAXML_PREVIEW_HEADER, paxmlDocument, paxmlPreviewRows, paxmlTransactions } from "./paxml";
import { monthsBetween, monthStatusLookup, onlyApprovedMonths, skippedWarnings } from "./periods";
import { basisCsv, basisFileName, basisGaps, payrollBasis } from "./basis";
import { createBasisPdf } from "./basis-report";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";
import { headingFingerprint, mergeCodeMap, payrollSettingsSchema, readPayrollSettings, type ImportTemplate, type PayrollSettings } from "./settings";
import { adapterFor } from "./adapters";
import { SFTP_UNAVAILABLE, sftpReady } from "./transport";
import { loadTimeTypePolicies, loadTimeTypes } from "@/lib/workflow/time-types-server";
import { resolveTimeType, timeCountsAsWork } from "@/lib/workflow/time-types";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Lön och frånvaro på servern (2026-10-29): the company's settings, absence and staff files from the Import page, the export to a
 * time or payroll system and the history. Every function is bound to the caller's company; the routes check the session,
 * membership and Origin before they get here. Who may do what:
 * - import absence: admins and the Teamet right (they register absence for anyone anyway);
 * - import employee numbers, change the settings: admins;
 * - export absence and worked time: admins and the Teamet right;
 * Nothing here is sent to AI. The run history keeps counts and row errors, never reasons.
 */
export const mayImportAbsence = (ctx: Context) => ctx.admin || canViewTeam(ctx);

const ROW_SELECT = { system: true, systemName: true, mode: true, importedEditable: true, codeMap: true, exportCodes: true, importTemplates: true, exportTemplates: true, sftp: true, lastImportAt: true, lastExportAt: true, lastError: true } as const;
export async function loadPayrollSettings(organizationId: string): Promise<PayrollSettings> {
  // Frånvarons lagringstid (2026-10-30) is a column of the company, shown and saved with these settings.
  const [row, organization] = await Promise.all([prisma.payrollIntegration.findUnique({ where: { organizationId }, select: ROW_SELECT }), prisma.organization.findUnique({ where: { id: organizationId }, select: { absenceRetentionMonths: true } })]);
  return readPayrollSettings(row, organization?.absenceRetentionMonths);
}

async function importMembers(organizationId: string): Promise<ImportMember[]> {
  const [members, organization] = await Promise.all([
    prisma.organizationMember.findMany({ where: { organizationId, isActive: true, user: { is: { isActive: true } } }, take: 500,
      select: { userId: true, employeeNumber: true, weeklyWorkMinutes: true, user: { select: { name: true, email: true } } } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { weeklyWorkMinutes: true } }),
  ]);
  return members.map((member) => ({ userId: member.userId, name: member.user.name || member.user.email, email: member.user.email.toLowerCase(), employeeNumber: member.employeeNumber, weeklyWorkMinutes: member.weeklyWorkMinutes ?? organization?.weeklyWorkMinutes ?? 2400 }));
}

/** The absences a file can meet: the matched people's absences within the file's dates, and every record of the source's keys. */
async function existingFor(organizationId: string, systemKey: string, members: readonly ImportMember[], from: string, to: string): Promise<ExistingAbsence[]> {
  const rows = await prisma.absence.findMany({
    where: { organizationId, OR: [{ userId: { in: members.map((member) => member.userId) }, fromDate: { lte: to }, toDate: { gte: from } }, { externalSystem: systemKey, fromDate: { lte: to }, toDate: { gte: from } }] },
    take: 10_000,
    select: { id: true, userId: true, type: true, note: true, fromDate: true, toDate: true, startTime: true, endTime: true, status: true, source: true, externalSystem: true, externalKey: true, externalHash: true },
  });
  return rows.map((row) => ({ id: row.id, userId: row.userId, type: row.type as AbsenceType, note: row.note, from: row.fromDate, to: row.toDate,
    hours: row.startTime && row.endTime ? { start: row.startTime, end: row.endTime } : null, status: row.status as AbsenceStatus, source: row.source,
    externalSystem: row.externalSystem, externalKey: row.externalKey, externalHash: row.externalHash }));
}

/** A table's identity for the history: the hash of its headings and rows. */
export const tableHash = (file: Pick<ExtractedFile, "headers" | "rows">) => createHash("sha256").update(JSON.stringify([file.headers ?? [], file.rows ?? []])).digest("hex");

async function buildPreview(ctx: Context, file: ExtractedFile, mapping: Record<string, string | null>, codeMap: CodeMap, settings: PayrollSettings) {
  const rows = readAbsenceRows(file, mapping);
  const members = await importMembers(ctx.organizationId);
  const dates = rows.flatMap((row) => [row.from, row.to]).filter((value): value is string => Boolean(value)).sort();
  const systemKey = sourceSystemKey(settings.system);
  const existing = dates.length ? await existingFor(ctx.organizationId, systemKey, members, dates[0], dates[dates.length - 1]) : [];
  return { preview: previewAbsenceImport({ rows, members, existing, codeMap, systemKey }), systemKey };
}

/** The preview as it travels to the browser (without the internal records). */
const forClient = (preview: AbsencePreview) => ({ ...preview, rows: preview.rows.slice(0, 500).map(({ unit, ...row }) => { void unit; return row; }) });
export type AbsencePlanAnswer = Awaited<ReturnType<typeof absencePlan>>;

/** Import → Frånvaro: the preview of an absence file, with the company's code mapping and what was imported before. */
export async function absencePlan(ctx: Context, file: ExtractedFile, mapping: Record<string, string | null>, extraCodes: Record<string, string> = {}) {
  requireCloudStorage(ctx);
  if (!mayImportAbsence(ctx)) return { allowed: false as const, message: "Bara administratörer och den som har rätten Teamet importerar frånvaro." };
  const settings = await loadPayrollSettings(ctx.organizationId);
  const codeMap = mergeCodeMap(settings.codeMap, extraCodes);
  const { preview } = await buildPreview(ctx, file, mapping, codeMap, settings);
  const hash = tableHash(file);
  const previous = await prisma.integrationRun.findFirst({ where: { organizationId: ctx.organizationId, direction: "import", kind: "absence", contentHash: hash, status: { not: "failed" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return { allowed: true as const, preview: forClient(preview), system: systemLabel(settings.system, settings.systemName), importedBefore: previous?.createdAt.toISOString() ?? null };
}

export const absenceApplySchema = z.object({
  mapping: z.record(z.string().max(40), z.string().max(200).nullable()),
  /** Codes the person mapped in the preview: saved in the company's mapping. */
  codeMap: z.record(z.string().max(60), z.string().max(20)).default({}),
  choices: z.record(z.string().max(320), z.enum(["replace", "keep"])).default({}),
  skip: z.array(z.string().max(320)).max(2000).default([]),
  saveTemplate: z.boolean().default(true),
});

/**
 * Writes an absence file: new and changed records, and conflicts the person chose to replace (the other absence is withdrawn,
 * never deleted). One transaction; the history keeps the counts and the rows that failed. Imported again: unchanged rows are
 * left alone, so nothing is duplicated.
 */
export async function applyAbsenceImport(ctx: Context, file: ExtractedFile, input: z.infer<typeof absenceApplySchema>, mode: "manual" | "sftp" | "api" = "manual") {
  requireCloudStorage(ctx);
  if (!mayImportAbsence(ctx)) throw new ApiError(403, "Bara administratörer och den som har rätten Teamet importerar frånvaro.");
  await requireCloudWriteAccess(ctx);
  const settings = await loadPayrollSettings(ctx.organizationId);
  const codeMap = mergeCodeMap(settings.codeMap, input.codeMap);
  const { preview, systemKey } = await buildPreview(ctx, file, input.mapping, codeMap, settings);
  const writes = rowsToWrite(preview, input.choices as Record<string, ConflictChoice>, new Set(input.skip));
  const source = mode === "manual" ? "FILE" : mode === "sftp" ? "SFTP" : "API";
  const runId = `run_${randomBytes(12).toString("hex")}`;
  const replaced = writes.filter((row) => row.action === "conflict" && row.conflict).map((row) => row.conflict!.id);
  const fingerprint = headingFingerprint(file.headers ?? []);
  const templates: ImportTemplate[] = input.saveTemplate && fingerprint
    ? [{ fingerprint, name: file.name.slice(0, 80), mapping: input.mapping, savedAt: new Date().toISOString() }, ...settings.importTemplates.filter((item) => item.fingerprint !== fingerprint)].slice(0, 50) : settings.importTemplates;
  const errors = preview.rows.filter((row) => row.action === "error").slice(0, 200).map((row) => ({ row: row.index + 2, message: row.issues.join("; ").slice(0, 300) }));
  const counts = { created: writes.filter((row) => !row.existingId).length, changed: writes.filter((row) => row.existingId).length, replaced: replaced.length,
    unchanged: preview.counts.unchanged, ignored: preview.counts.ignored, conflictsKept: preview.counts.conflict - replaced.length, errors: preview.counts.error };
  const status = errors.length ? (writes.length || counts.unchanged ? "partial" : "failed") : "ok";
  await prisma.$transaction(async (tx) => {
    for (const id of replaced) {
      const other = await tx.absence.update({ where: { id }, data: { status: "WITHDRAWN", updatedById: ctx.user.id }, select: { id: true, userId: true } });
      await tx.absenceEvent.create({ data: { organizationId: ctx.organizationId, absenceId: other.id, userId: other.userId, actorId: ctx.user.id, action: "replaced", detail: "Ersatt av importerad frånvaro" } });
    }
    for (const row of writes) {
      const unit = row.unit!;
      const data = { type: unit.type, note: unit.note, fromDate: unit.from, toDate: unit.to, startTime: unit.hours?.start ?? null, endTime: unit.hours?.end ?? null, status: unit.status,
        source, externalCode: unit.code.slice(0, 60), externalHash: unit.hash, importRunId: runId, updatedById: ctx.user.id };
      const saved = row.existingId
        ? await tx.absence.update({ where: { id: row.existingId }, data, select: { id: true } })
        : await tx.absence.create({ data: { ...data, organizationId: ctx.organizationId, userId: unit.userId, externalSystem: systemKey, externalKey: unit.key, createdById: ctx.user.id }, select: { id: true } });
      await tx.absenceEvent.create({ data: { organizationId: ctx.organizationId, absenceId: saved.id, userId: unit.userId, actorId: ctx.user.id, action: row.existingId ? "import_changed" : "imported",
        detail: `${unit.from === unit.to ? unit.from : `${unit.from}–${unit.to}`} · ${ABSENCE_STATUS_LABELS[unit.status]} · ${sourceSystemLabel(systemKey, settings.systemName)}` } });
    }
    await tx.payrollIntegration.upsert({
      where: { organizationId: ctx.organizationId },
      create: { organizationId: ctx.organizationId, codeMap: codeMap as Prisma.InputJsonValue, importTemplates: templates as unknown as Prisma.InputJsonValue, lastImportAt: new Date(), lastError: status === "failed" ? "Importen misslyckades." : "" },
      update: { codeMap: codeMap as Prisma.InputJsonValue, importTemplates: templates as unknown as Prisma.InputJsonValue, lastImportAt: new Date(), lastError: status === "failed" ? "Importen misslyckades." : "" },
    });
    await tx.integrationRun.create({ data: { id: runId, organizationId: ctx.organizationId, direction: "import", mode, system: systemKey, kind: "absence", fileName: file.name.slice(0, 200), contentHash: tableHash(file),
      status, counts: counts as Prisma.InputJsonValue, errors: errors as Prisma.InputJsonValue, createdById: ctx.user.id } });
  }, { timeout: 30_000 });
  return { counts, status, errors: errors.slice(0, 50) };
}

/** A saved column choice for files with the same headings (the company's import template), if any. */
export async function savedAbsenceMapping(organizationId: string, headers: readonly string[]) {
  const fingerprint = headingFingerprint(headers);
  if (!fingerprint) return null;
  const settings = await loadPayrollSettings(organizationId);
  return settings.importTemplates.find((item) => item.fingerprint === fingerprint)?.mapping ?? null;
}

/** Import → Anställningsnummer: the preview (admins only; the numbers are the match key for every later absence file). */
export async function employeeNumbersPlan(ctx: Context, file: ExtractedFile, mapping: Record<string, string | null>) {
  requireCloudStorage(ctx);
  if (!ctx.admin) return { allowed: false as const, message: "Bara företagets administratör lägger in anställningsnummer." };
  return { allowed: true as const, rows: previewEmployeeNumbers(file, mapping, await importMembers(ctx.organizationId)).slice(0, 500) };
}

export async function applyEmployeeNumbers(ctx: Context, file: ExtractedFile, mapping: Record<string, string | null>) {
  requireCloudStorage(ctx);
  requireAdmin(ctx);
  await requireCloudWriteAccess(ctx);
  const rows = previewEmployeeNumbers(file, mapping, await importMembers(ctx.organizationId));
  const writes = rows.filter((row) => row.action === "new" || row.action === "changed");
  await prisma.$transaction(async (tx) => {
    // Two steps, so a number can move from one person to another inside the same file without breaking the unique rule.
    for (const row of writes) await tx.organizationMember.update({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: row.userId } }, data: { employeeNumber: null } });
    for (const row of writes) await tx.organizationMember.update({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: row.userId } }, data: { employeeNumber: row.employeeNumber } });
    await tx.integrationRun.create({ data: { organizationId: ctx.organizationId, direction: "import", mode: "manual", kind: "employee_numbers", fileName: file.name.slice(0, 200), contentHash: tableHash(file),
      status: rows.some((row) => row.action === "error") ? (writes.length ? "partial" : "failed") : "ok",
      counts: { saved: writes.length, unchanged: rows.filter((row) => row.action === "unchanged").length, errors: rows.filter((row) => row.action === "error").length },
      errors: rows.filter((row) => row.action === "error").slice(0, 200).map((row) => ({ row: row.index + 2, message: row.issues.join("; ") })) as Prisma.InputJsonValue, createdById: ctx.user.id } });
  });
  return { saved: writes.length, errors: rows.filter((row) => row.action === "error").length };
}

// ---------- export ----------
const periodSchema = {
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum."), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum."),
  userIds: z.array(z.string().max(60)).max(500).default([]),
  /** Bara godkända månader (2026-10-30, on by default): rows of a person's month that is not approved are left out. */
  onlyApproved: z.boolean().default(true),
};
const periodOk = (value: { from: string; to: string }) => value.to >= value.from && Date.parse(value.to) - Date.parse(value.from) <= 366 * 86_400_000;
const periodMessage = { message: "Välj en period på högst ett år.", path: ["to"] };
export const exportRequestSchema = z.object({ templateId: z.string().max(40).optional(), template: z.unknown().optional(), ...periodSchema }).refine(periodOk, periodMessage);
/** Löneunderlag per period: the same period, people and month rule as the export. */
export const basisRequestSchema = z.object(periodSchema).refine(periodOk, periodMessage);
type PeriodRequest = z.infer<typeof basisRequestSchema>;

const requireExport = (ctx: Context) => { requireCloudStorage(ctx); if (!mayImportAbsence(ctx)) throw new ApiError(403, "Bara administratörer och den som har rätten Teamet exporterar till lönesystemet."); };

async function templateOf(settings: PayrollSettings, request: z.infer<typeof exportRequestSchema>): Promise<ExportTemplate> {
  if (request.template) return exportTemplateSchema.parse(request.template);
  const found = [...settings.exportTemplates, ...PRESET_TEMPLATES].find((item) => item.id === request.templateId);
  if (!found) throw new ApiError(404, "Exportmallen finns inte.");
  return found;
}

/** The people of an export: the company's active members with the employee number, the weekly time and Ingen fast arbetstid. */
async function exportPeople(organizationId: string): Promise<ExportPerson[]> {
  const [members, organization] = await Promise.all([
    prisma.organizationMember.findMany({ where: { organizationId, isActive: true, user: { is: { isActive: true } } }, take: 500,
      select: { userId: true, employeeNumber: true, weeklyWorkMinutes: true, noFixedHours: true, user: { select: { name: true, email: true } } } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { weeklyWorkMinutes: true } }),
  ]);
  return members.map((member) => ({ userId: member.userId, name: member.user.name || member.user.email, email: member.user.email.toLowerCase(), employeeNumber: member.employeeNumber,
    weeklyWorkMinutes: member.weeklyWorkMinutes ?? organization?.weeklyWorkMinutes ?? 2400, noFixedHours: member.noFixedHours }));
}

/**
 * What an export or a payroll basis reads for a period, all bound to the caller's company: the people, absence and worked time
 * (only what is asked for), and each person's month status. With "Bara godkända månader" the rows of months that are not
 * approved are taken out here, once, and listed as warnings.
 */
async function periodSources(ctx: Context, request: PeriodRequest, settings: PayrollSettings, need: { absence: boolean; worked: boolean }) {
  const organizationId = ctx.organizationId;
  const [people, periods] = await Promise.all([
    exportPeople(organizationId),
    prisma.timePeriod.findMany({ where: { organizationId, period: { in: monthsBetween(request.from, request.to) } }, take: 10_000, select: { userId: true, period: true, status: true } }),
  ]);
  let absences: ExportAbsence[] = [];
  if (need.absence) {
    const rows = await prisma.absence.findMany({ where: { organizationId, fromDate: { lte: request.to }, toDate: { gte: request.from } }, take: 20_000, orderBy: { fromDate: "asc" },
      select: { userId: true, type: true, note: true, fromDate: true, toDate: true, startTime: true, endTime: true, status: true, source: true, externalSystem: true, externalCode: true } });
    absences = rows.map((row) => ({ userId: row.userId, type: row.type as AbsenceType, note: row.note, from: row.fromDate, to: row.toDate, hours: row.startTime && row.endTime ? { start: row.startTime, end: row.endTime } : null,
      status: row.status as AbsenceStatus, sourceLabel: row.source === "MANUAL" ? "Workflow" : sourceSystemLabel(row.externalSystem, settings.systemName), externalCode: row.externalCode }));
  }
  let entries: ExportTimeEntry[] = [];
  if (need.worked) {
    // Swedish days: an entry belongs to the day it started on (as the time report counts it).
    const start = fromSwedishDateInput(request.from)!; const end = addSwedishDays(fromSwedishDateInput(request.to)!, 1);
    const rows = await prisma.workflowTimeEntry.findMany({
      where: { endedAt: { not: null }, startedAt: { gte: start, lt: end }, AND: [timeEntryInOrganization(organizationId)] }, take: 50_000,
      select: { userId: true, startedAt: true, durationSec: true, timeTypeId: true, task: { select: { title: true, project: { select: { name: true } }, customer: { select: { name: true, company: true, customerType: true } } } }, project: { select: { name: true } } },
    });
    // Tidstyper (2026-10-29): the entry's type, the standard type when it has none, with the type's payroll code.
    const [types, policies] = await Promise.all([loadTimeTypes(organizationId), loadTimeTypePolicies(organizationId)]);
    entries = rows.map((entry) => ({ userId: entry.userId, day: swedishDayKey(entry.startedAt), seconds: entry.durationSec,
      timeType: resolveTimeType(types, entry.timeTypeId)?.name ?? "", timeTypeCode: resolveTimeType(types, entry.timeTypeId)?.payrollCode ?? "",
      workingTime: timeCountsAsWork(types, policies, entry.timeTypeId),
      project: entry.task?.project?.name ?? entry.project?.name ?? "", workOrder: entry.task?.title ?? "", customer: entry.task?.customer ? customerTitle(entry.task.customer) : "" }));
  }
  const statusOf = monthStatusLookup(periods);
  if (!request.onlyApproved) return { people, absences, entries, statusOf, warnings: [] as string[] };
  const kept = onlyApprovedMonths({ entries, absences, statusOf });
  const asked = (userId: string) => !request.userIds.length || request.userIds.includes(userId);
  return { people, absences: kept.absences, entries: kept.entries, statusOf, warnings: skippedWarnings(kept.skipped.filter((item) => asked(item.userId)), people, request) };
}

/** The rows of an export for a period (the same for the preview and the file); PAXml also gives its transactions and errors. */
async function exportData(ctx: Context, template: ExportTemplate, request: z.infer<typeof exportRequestSchema>, settings: PayrollSettings) {
  const paxml = template.format === "paxml";
  const sources = await periodSources(ctx, request, settings, { absence: paxml || template.kind === "absence", worked: paxml || template.kind === "worked_time" });
  if (paxml) {
    const result = paxmlTransactions({ from: request.from, to: request.to, people: sources.people, entries: sources.entries, absences: sources.absences, exportCodes: settings.exportCodes, statuses: template.statuses, userIds: request.userIds });
    const rows = paxmlPreviewRows(result.transactions);
    const block = exportBlockers({ template, from: request.from, to: request.to, people: sources.people, rowCount: rows.length, paxmlProblems: result.problems });
    return { rows, transactions: result.transactions, errors: result.errors, warnings: sources.warnings, notices: result.warnings, block };
  }
  const input = { template, from: request.from, to: request.to, people: sources.people, absences: sources.absences, entries: sources.entries, exportCodes: settings.exportCodes, userIds: request.userIds };
  const rows = exportRows(input);
  return { rows, transactions: null, errors: [] as string[], warnings: sources.warnings, notices: exportLeftOut(input), block: exportBlockers({ ...input, rowCount: rows.length }) };
}

/** Förhandsgranska: the heading and the first rows, the number of rows, what is missing and what was left out. */
export async function exportPreview(ctx: Context, request: z.infer<typeof exportRequestSchema>) {
  requireExport(ctx);
  const settings = await loadPayrollSettings(ctx.organizationId);
  const template = await templateOf(settings, request);
  const data = await exportData(ctx, template, request, settings);
  return { header: data.transactions ? PAXML_PREVIEW_HEADER : headerRow(template), rows: data.rows.slice(0, 50), total: data.rows.length,
    ...(data.transactions ? { withoutNumber: 0, withoutCode: 0 } : exportGaps(template, data.rows)), errors: data.errors, warnings: [...data.warnings, ...data.notices], fileName: exportFileName(template, request.from, request.to),
    // Spärrarna (2026-10-31): what keeps the file from being made, and the message "Skapa fil" would give.
    problems: data.block.problems, refusal: exportRefusal(data.block) };
}

/** The local time of the export as PAXml's header wants it (Swedish time, no zone). */
const localDateTime = (value: Date) => `${swedishDayKey(value)}T${swedishClock(value)}:00`;

/** The file itself (CSV/TSV in the template's encoding, Excel for review, or PAXml), logged in the history. */
export async function exportFile(ctx: Context, request: z.infer<typeof exportRequestSchema>) {
  requireExport(ctx);
  const settings = await loadPayrollSettings(ctx.organizationId);
  const template = await templateOf(settings, request);
  const { rows, transactions, errors, warnings, block } = await exportData(ctx, template, request, settings);
  // Spärrarna (2026-10-31): nothing to export, or rows the payroll system cannot read – no file, a message naming what to fix.
  const refusal = exportRefusal(block);
  if (refusal) throw new ApiError(422, refusal);
  const table = template.header ? [headerRow(template), ...rows] : rows;
  let bytes: Uint8Array; let mimeType: string;
  if (transactions) {
    const company = (await prisma.workspaceSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { companyName: true } }))?.companyName || ctx.organization.name;
    bytes = latin1Bytes(paxmlDocument({ transactions, createdAt: localDateTime(new Date()), company }));
    mimeType = "application/xml; charset=iso-8859-1";
  } else if (template.format === "xlsx") {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet(template.kind === "absence" ? "Frånvaro" : "Arbetad tid");
    for (const row of table) sheet.addRow(row);
    if (template.header) sheet.getRow(1).font = { bold: true };
    bytes = new Uint8Array(await book.xlsx.writeBuffer()); mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else {
    bytes = encodeText(delimitedText(table, template.delimiter), template.encoding);
    mimeType = `${template.delimiter === "\t" ? "text/tab-separated-values" : "text/csv"}; charset=${template.encoding === "windows-1252" ? "windows-1252" : "utf-8"}`;
  }
  const fileName = exportFileName(template, request.from, request.to);
  await prisma.$transaction([
    prisma.integrationRun.create({ data: { organizationId: ctx.organizationId, direction: "export", mode: "manual", system: sourceSystemKey(settings.system), kind: template.kind, fileName, contentHash: createHash("sha256").update(bytes).digest("hex"),
      status: errors.length ? "partial" : "ok", counts: { rows: rows.length, monthsLeftOut: warnings.length, template: template.name }, errors: errors.slice(0, 200).map((message) => ({ message })) as Prisma.InputJsonValue, createdById: ctx.user.id } }),
    prisma.payrollIntegration.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, lastExportAt: new Date() }, update: { lastExportAt: new Date() } }),
  ]);
  return { bytes, mimeType, fileName };
}

// ---------- löneunderlag ----------
/** Löneunderlag per period: one summary per person, the warnings, and what is missing (the same right as the export). */
async function basisData(ctx: Context, request: PeriodRequest) {
  requireExport(ctx);
  const settings = await loadPayrollSettings(ctx.organizationId);
  const sources = await periodSources(ctx, request, settings, { absence: true, worked: true });
  const people = payrollBasis({ from: request.from, to: request.to, people: sources.people, entries: sources.entries, absences: sources.absences, exportCodes: settings.exportCodes, statusOf: sources.statusOf, userIds: request.userIds });
  return { settings, people, warnings: [...sources.warnings, ...basisGaps(people)] };
}
export async function payrollBasisPreview(ctx: Context, request: PeriodRequest) {
  const { people, warnings } = await basisData(ctx, request);
  return { people, warnings, onlyApproved: request.onlyApproved, fileName: basisFileName(request.from, request.to, "pdf") };
}

/** Löneunderlaget som PDF eller CSV, logged in the history as an export. */
export async function payrollBasisFile(ctx: Context, request: PeriodRequest, format: "pdf" | "csv") {
  const basis = await basisData(ctx, request);
  let bytes: Uint8Array; let mimeType: string;
  if (format === "pdf") {
    const [identity, fontBytes] = await Promise.all([workflowReportIdentity(ctx.organizationId, ctx.organization.name), workflowReportFont()]);
    bytes = await createBasisPdf({ identity, fontBytes, from: request.from, to: request.to, people: basis.people, onlyApproved: request.onlyApproved, warnings: basis.warnings });
    mimeType = "application/pdf";
  } else { bytes = basisCsv(basis.people); mimeType = "text/csv; charset=utf-8"; }
  const fileName = basisFileName(request.from, request.to, format);
  await prisma.integrationRun.create({ data: { organizationId: ctx.organizationId, direction: "export", mode: "manual", system: sourceSystemKey(basis.settings.system), kind: "payroll_basis", fileName,
    contentHash: createHash("sha256").update(bytes).digest("hex"), status: "ok", counts: { people: basis.people.length, warnings: basis.warnings.length }, createdById: ctx.user.id } });
  return { bytes, mimeType, fileName };
}

// ---------- settings and status ----------
/** Lön och frånvaro on Kopplingar: the settings, whether the keys exist, the mode's state, and the latest runs. */
export async function payrollOverview(ctx: Context) {
  requireCloudStorage(ctx);
  if (!mayImportAbsence(ctx)) throw new ApiError(403, "Du saknar behörighet att se lön och frånvaro.");
  const [settings, runs, keys, numbered, members, waiting] = await Promise.all([
    loadPayrollSettings(ctx.organizationId),
    prisma.integrationRun.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, direction: true, mode: true, system: true, kind: true, fileName: true, status: true, counts: true, errors: true, createdAt: true } }),
    prisma.integrationKey.findMany({ where: { organizationId: ctx.organizationId, kind: "EXTERNAL", provider: { in: ["payroll-sftp", "payroll-api"] }, revokedAt: null }, select: { provider: true, expiresAt: true } }),
    prisma.organizationMember.count({ where: { organizationId: ctx.organizationId, isActive: true, employeeNumber: { not: null } } }),
    prisma.organizationMember.count({ where: { organizationId: ctx.organizationId, isActive: true } }),
    prisma.absence.count({ where: { organizationId: ctx.organizationId, status: "APPLIED", toDate: { gte: swedishDayKey(new Date()) } } }),
  ]);
  const hasKey = (provider: string) => keys.some((key) => key.provider === provider && (!key.expiresAt || key.expiresAt > new Date()));
  const adapter = adapterFor(settings.system);
  const modeState = settings.mode === "manual" ? { ok: true, text: "Filer importeras på Import och exporteras här." }
    : settings.mode === "sftp" ? { ok: false, text: !sftpReady(settings.sftp) ? "Fyll i server, användare och serverns fingerprint." : !hasKey("payroll-sftp") ? "Lägg in SFTP-lösenordet eller nyckeln under Lönesystemets nyckel på Lön och export." : SFTP_UNAVAILABLE }
    : { ok: false, text: adapter.unavailableReason };
  return {
    settings: { ...settings, codeMap: settings.codeMap, importTemplates: settings.importTemplates.map(({ name, savedAt, fingerprint }) => ({ name, savedAt, fingerprint })) },
    canEdit: ctx.admin, systemLabel: systemLabel(settings.system, settings.systemName), modeState,
    keys: { sftp: hasKey("payroll-sftp"), api: hasKey("payroll-api") },
    staff: { withNumber: numbered, total: members }, waitingApproval: waiting,
    presets: PRESET_TEMPLATES,
    runs: runs.map((run) => ({ ...run, createdAt: run.createdAt.toISOString(), errors: Array.isArray(run.errors) ? (run.errors as unknown[]).slice(0, 20) : [] })),
  };
}

export async function savePayrollSettings(ctx: Context, raw: unknown) {
  requireCloudStorage(ctx);
  requireAdmin(ctx);
  await requireCloudWriteAccess(ctx);
  const input = payrollSettingsSchema.parse(raw);
  const data = { system: input.system, systemName: input.system === "other" ? input.systemName : "", mode: input.mode, importedEditable: input.importedEditable,
    exportCodes: Object.fromEntries(Object.entries(input.exportCodes).filter(([, code]) => code)) as Prisma.InputJsonValue, sftp: input.sftp as Prisma.InputJsonValue };
  await prisma.payrollIntegration.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, ...data }, update: data });
  // Frånvarons lagringstid (2026-10-30): on the company; the nightly job removes what is older.
  const retention = input.absenceRetentionMonths;
  if (retention !== undefined && retention !== ctx.organization.absenceRetentionMonths) await prisma.organization.update({ where: { id: ctx.organizationId }, data: { absenceRetentionMonths: retention } });
  await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "payroll_settings", detail: `Lön och frånvaro: ${systemLabel(input.system, input.systemName)}, ${input.mode}${input.importedEditable ? ", importerad frånvaro kan ändras" : ""}${retention !== undefined ? `, frånvaro sparas ${retention} mån` : ""}.` } });
}

/** The company's code mapping, changed on the settings page (admins) – an empty type removes the code. */
export async function saveCodeMap(ctx: Context, codes: Record<string, string>) {
  requireCloudStorage(ctx);
  requireAdmin(ctx);
  await requireCloudWriteAccess(ctx);
  const settings = await loadPayrollSettings(ctx.organizationId);
  const removed = new Set(Object.entries(codes).filter(([, type]) => !type).map(([code]) => normalizeCode(code)));
  const next = Object.fromEntries(Object.entries(mergeCodeMap(settings.codeMap, codes)).filter(([code]) => !removed.has(code)));
  await prisma.payrollIntegration.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, codeMap: next }, update: { codeMap: next } });
}

export async function saveExportTemplate(ctx: Context, raw: unknown, remove = false) {
  requireCloudStorage(ctx);
  requireAdmin(ctx);
  await requireCloudWriteAccess(ctx);
  const settings = await loadPayrollSettings(ctx.organizationId);
  let templates = settings.exportTemplates;
  if (remove) templates = templates.filter((item) => item.id !== String(raw));
  else {
    const template = exportTemplateSchema.parse(raw);
    if (template.id.startsWith("preset-")) throw new ApiError(400, "Spara mallen under ett eget namn.");
    // Unika filnamn (2026-10-31): the file is named after the template, so two templates never share a name.
    const clash = templateNameClash(template, [...templates, ...PRESET_TEMPLATES]);
    if (clash) throw new ApiError(400, `Det finns redan en mall med samma namn (”${clash.name}”). Välj ett annat namn, så får filerna olika namn.`);
    templates = [template, ...templates.filter((item) => item.id !== template.id)];
    if (templates.length > 30) throw new ApiError(400, "Högst 30 egna exportmallar.");
  }
  await prisma.payrollIntegration.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, exportTemplates: templates as unknown as Prisma.InputJsonValue }, update: { exportTemplates: templates as unknown as Prisma.InputJsonValue } });
}

/** Anställningsnummer for one member, on the settings page (admins). */
export async function saveEmployeeNumber(ctx: Context, userId: string, employeeNumber: string) {
  requireCloudStorage(ctx);
  requireAdmin(ctx);
  await requireCloudWriteAccess(ctx);
  const number = employeeNumber.trim().slice(0, 40) || null;
  const member = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId } }, select: { id: true } });
  if (!member) throw new ApiError(404, "Personen finns inte i företaget.");
  if (number) {
    const other = await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, employeeNumber: number, userId: { not: userId } }, select: { user: { select: { name: true } } } });
    if (other) throw new ApiError(409, `Numret används redan av ${other.user.name}.`);
  }
  await prisma.organizationMember.update({ where: { id: member.id }, data: { employeeNumber: number } });
}

/**
 * Ingen fast arbetstid set by an admin for a person (2026-10-30: hourly staff is the employer's call, not only the
 * person's own): no expected time and no capacity. Logged like the person's own change.
 */
export async function saveNoFixedHours(ctx: Context, userId: string, noFixedHours: boolean) {
  requireCloudStorage(ctx);
  requireAdmin(ctx);
  await requireCloudWriteAccess(ctx);
  const member = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId } }, select: { id: true, noFixedHours: true, user: { select: { name: true, email: true } } } });
  if (!member) throw new ApiError(404, "Personen finns inte i företaget.");
  if (member.noFixedHours === noFixedHours) return;
  await prisma.$transaction([
    prisma.organizationMember.update({ where: { id: member.id }, data: { noFixedHours } }),
    prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "work_schedule_no_fixed_hours",
      detail: `${ctx.user.name || ctx.user.email} för ${member.user.name || member.user.email}: ${noFixedHours ? "Ingen fast arbetstid" : "Fast arbetstid"}.` } }),
  ]);
}

/** The members with their employee numbers and whether they have fixed hours (admins), for the settings page. */
export async function staffNumbers(ctx: Context) {
  requireCloudStorage(ctx);
  requireAdmin(ctx);
  const fixed = new Map((await prisma.organizationMember.findMany({ where: { organizationId: ctx.organizationId }, select: { userId: true, noFixedHours: true }, take: 500 })).map((row) => [row.userId, row.noFixedHours]));
  return (await importMembers(ctx.organizationId)).map(({ userId, name, email, employeeNumber }) => ({ userId, name, email, employeeNumber, noFixedHours: fixed.get(userId) ?? false })).sort((a, b) => a.name.localeCompare(b.name, "sv"));
}
