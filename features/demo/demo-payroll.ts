import { z } from "zod";
import { swedishDayKey } from "@/lib/swedish-time";
import { canViewTeam } from "@/lib/workflow/permissions";
import { sourceSystemLabel, systemLabel } from "@/lib/payroll/codes";
import { exportBlockers, exportFileName, exportGaps, exportLeftOut, exportRefusal, exportRows, exportTemplateSchema, headerRow, PRESET_TEMPLATES, type ExportTemplate } from "@/lib/payroll/export";
import { PAXML_PREVIEW_HEADER, paxmlPreviewRows, paxmlTransactions } from "@/lib/payroll/paxml";
import { monthStatusLookup, onlyApprovedMonths, skippedWarnings, type PeriodRow } from "@/lib/payroll/periods";
import { basisFileName, basisGaps, payrollBasis } from "@/lib/payroll/basis";
import { payrollSettingsSchema, readPayrollSettings, type PayrollSettings } from "@/lib/payroll/settings";
import { adapterFor } from "@/lib/payroll/adapters";
import { SFTP_UNAVAILABLE, sftpReady } from "@/lib/payroll/sftp-settings";
import type { DemoDatabase, DemoUser } from "./demo-data";
import { demoCountsAsWork, demoTimeTypes } from "./demo-time-types";
import { resolveTimeType } from "@/lib/workflow/time-types";

/**
 * Lön och frånvaro i demon (2026-10-29): GET and POST /api/payroll answered from memory with the shared export engine
 * (lib/payroll/export.ts), so Kopplingar and Tid show the same panels as Cloud. Invented employee numbers; nothing is sent
 * anywhere and a reload starts over. Löneunderlag and PAXml (2026-10-30) use the same pure functions as Cloud with the same
 * "Bara godkända månader" rule: the months come from the demo's time periods when it has them, else every month is open.
 */
export class DemoPayrollError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Ctx = { db: DemoDatabase; user: DemoUser; admin: boolean; now: Date };
let settings: PayrollSettings = readPayrollSettings(null);
const numberOf = (index: number) => (index < 3 ? String(1001 + index) : null);

const exportRequest = z.object({ templateId: z.string().max(40).optional(), template: z.unknown().optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), userIds: z.array(z.string()).default([]), onlyApproved: z.boolean().default(true) });

/** The same sources as Cloud's: people, absence, worked time and the month rule. */
function sourcesOf(ctx: Ctx, request: z.infer<typeof exportRequest>) {
  const people = ctx.db.users.map((user, index) => ({ userId: user.id, name: user.name, email: user.email, employeeNumber: numberOf(index), weeklyWorkMinutes: user.weeklyWorkMinutes ?? ctx.db.organization.weeklyWorkMinutes }));
  const absences = ctx.db.absences.map((absence) => ({ userId: absence.userId, type: absence.type, note: absence.note, from: absence.from, to: absence.to, hours: absence.hours, status: absence.status ?? "APPROVED" as const,
    sourceLabel: (absence.source ?? "MANUAL") === "MANUAL" ? "Workflow" : sourceSystemLabel(absence.externalSystem), externalCode: null }));
  const entries = ctx.db.timeEntries.filter((entry) => entry.endedAt).map((entry) => {
    const task = ctx.db.tasks.find((item) => item.id === entry.taskId);
    const project = ctx.db.projects.find((item) => item.id === (task?.projectId ?? entry.projectId));
    const type = resolveTimeType(demoTimeTypes(ctx.db), entry.timeTypeId);
    return { userId: entry.userId, day: swedishDayKey(new Date(entry.startedAt)), seconds: entry.durationSec, project: project?.name ?? "", workOrder: task?.title ?? "", customer: "", timeType: type?.name ?? "", timeTypeCode: type?.payrollCode ?? "", workingTime: demoCountsAsWork(ctx.db, entry.timeTypeId) };
  });
  const statusOf = monthStatusLookup((ctx.db as { timePeriods?: PeriodRow[] }).timePeriods ?? []);
  if (!request.onlyApproved) return { people, absences, entries, statusOf, warnings: [] as string[] };
  const kept = onlyApprovedMonths({ entries, absences, statusOf });
  return { people, absences: kept.absences, entries: kept.entries, statusOf, warnings: skippedWarnings(kept.skipped.filter((item) => !request.userIds.length || request.userIds.includes(item.userId)), people, request) };
}

function previewOf(ctx: Ctx, template: ExportTemplate, request: z.infer<typeof exportRequest>) {
  const sources = sourcesOf(ctx, request);
  const fileName = exportFileName(template, request.from, request.to);
  if (template.format === "paxml") {
    const result = paxmlTransactions({ from: request.from, to: request.to, people: sources.people, entries: sources.entries, absences: sources.absences, exportCodes: settings.exportCodes, statuses: template.statuses, userIds: request.userIds });
    const rows = paxmlPreviewRows(result.transactions);
    const block = exportBlockers({ template, from: request.from, to: request.to, people: sources.people, rowCount: rows.length, paxmlProblems: result.problems });
    return { header: PAXML_PREVIEW_HEADER, rows: rows.slice(0, 50), total: rows.length, withoutNumber: 0, withoutCode: 0, errors: result.errors, warnings: [...sources.warnings, ...result.warnings], fileName, problems: block.problems, refusal: exportRefusal(block) };
  }
  const input = { template, from: request.from, to: request.to, people: sources.people, absences: sources.absences, entries: sources.entries, exportCodes: settings.exportCodes, userIds: request.userIds };
  const rows = exportRows(input);
  // The same blocks as Cloud (2026-10-31), so the preview says why a file would not be made.
  const block = exportBlockers({ ...input, rowCount: rows.length });
  return { header: headerRow(template), rows: rows.slice(0, 50), total: rows.length, ...exportGaps(template, rows), errors: [] as string[], warnings: [...sources.warnings, ...exportLeftOut(input)], fileName, problems: block.problems, refusal: exportRefusal(block) };
}

export function demoPayroll(ctx: Ctx, request: { method: string; url: URL; body: unknown }) {
  if (!ctx.admin && !canViewTeam({ admin: ctx.admin, workflowPermissions: ctx.user.permissions })) throw new DemoPayrollError(403, "Du saknar behörighet att se lön och frånvaro.");
  if (request.method === "GET") {
    if (request.url.searchParams.get("staff") === "1") return { staff: ctx.db.users.map((user, index) => ({ userId: user.id, name: user.name, email: user.email, employeeNumber: numberOf(index), noFixedHours: Boolean(user.noFixedHours) })) };
    const adapter = adapterFor(settings.system);
    return {
      settings, canEdit: ctx.admin, systemLabel: systemLabel(settings.system, settings.systemName),
      modeState: settings.mode === "manual" ? { ok: true, text: "" } : settings.mode === "sftp" ? { ok: false, text: sftpReady(settings.sftp) ? SFTP_UNAVAILABLE : "Fyll i server, användare och serverns fingerprint." } : { ok: false, text: adapter.unavailableReason },
      keys: { sftp: false, api: false }, staff: { withNumber: Math.min(3, ctx.db.users.length), total: ctx.db.users.length }, waitingApproval: 0, presets: PRESET_TEMPLATES, runs: [],
    };
  }
  const body = (request.body ?? {}) as { action?: string; settings?: unknown; template?: unknown; id?: string; request?: unknown; userId?: string; noFixedHours?: boolean };
  if (body.action === "export_preview" || body.action === "export") {
    const input = exportRequest.parse(body.request);
    const template = input.template ? exportTemplateSchema.parse(input.template) : [...settings.exportTemplates, ...PRESET_TEMPLATES].find((item) => item.id === input.templateId);
    if (!template) throw new DemoPayrollError(404, "Exportmallen finns inte.");
    if (body.action === "export_preview") return previewOf(ctx, template, input);
    // Files are made by the server; the demo says so, as for its other reports.
    throw new DemoPayrollError(403, "Filer skapas inte i demon. Förhandsgranska visar raderna.");
  }
  if (body.action === "basis") {
    const input = exportRequest.parse(body.request);
    const sources = sourcesOf(ctx, input);
    const people = payrollBasis({ from: input.from, to: input.to, people: sources.people, entries: sources.entries, absences: sources.absences, exportCodes: settings.exportCodes, statusOf: sources.statusOf, userIds: input.userIds });
    return { people, warnings: [...sources.warnings, ...basisGaps(people)], onlyApproved: input.onlyApproved, fileName: basisFileName(input.from, input.to, "pdf") };
  }
  if (body.action === "basis_file") throw new DemoPayrollError(403, "Filer skapas inte i demon. Visa underlaget visar summorna.");
  if (!ctx.admin) throw new DemoPayrollError(403, "Bara en företagsadministratör kan göra det.");
  if (body.action === "settings") { const input = payrollSettingsSchema.parse(body.settings); settings = { ...settings, ...input, lastError: "" }; return { ok: true }; }
  if (body.action === "template_save") { const template = exportTemplateSchema.parse(body.template); settings = { ...settings, exportTemplates: [template, ...settings.exportTemplates.filter((item) => item.id !== template.id)] }; return { ok: true }; }
  // Ingen fast arbetstid set by the admin (2026-10-30): kept on the demo person, so the overview and planning follow.
  if (body.action === "fixed_hours") { const user = ctx.db.users.find((item) => item.id === body.userId); if (!user) throw new DemoPayrollError(404, "Personen finns inte i företaget."); user.noFixedHours = body.noFixedHours === true; return { ok: true }; }
  if (body.action === "template_delete") { settings = { ...settings, exportTemplates: settings.exportTemplates.filter((item) => item.id !== body.id) }; return { ok: true }; }
  return { ok: true };
}
