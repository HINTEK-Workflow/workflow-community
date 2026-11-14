import { z } from "zod";
import { ABSENCE_TYPES, type AbsenceType } from "@/lib/workflow/absence";
import { CODE_TARGETS, normalizeCode, PAYROLL_MODES, PAYROLL_SYSTEMS, type CodeMap, type PayrollMode, type PayrollSystem } from "./codes";
import { exportTemplateSchema, type ExportTemplate } from "./export";
import { sftpSettingsSchema, type SftpSettings } from "./sftp-settings";
import { absenceRetentionMonthsOf, absenceRetentionMonthsSchema } from "@/lib/absence/retention";

/** Lön och frånvaro: the company's settings as stored (PayrollIntegration) and as the settings page changes them. */
export const codeMapSchema = z.record(z.string().max(60), z.enum(CODE_TARGETS as [string, ...string[]])).refine((value) => Object.keys(value).length <= 300, "Högst 300 koder.");
export const exportCodesSchema = z.partialRecord(z.enum(ABSENCE_TYPES), z.string().trim().max(40));
/** A saved column choice for absence files: the file's headings (normalised, joined) → field → heading. */
export const importTemplateSchema = z.object({ fingerprint: z.string().max(2000), name: z.string().max(80), mapping: z.record(z.string().max(40), z.string().max(200).nullable()), savedAt: z.string().max(40) });
export type ImportTemplate = z.infer<typeof importTemplateSchema>;

export const payrollSettingsSchema = z.object({
  system: z.enum(PAYROLL_SYSTEMS),
  systemName: z.string().trim().max(60).default(""),
  mode: z.enum(PAYROLL_MODES),
  importedEditable: z.boolean(),
  exportCodes: exportCodesSchema.default({}),
  sftp: sftpSettingsSchema.default(sftpSettingsSchema.parse({})),
  /** Frånvarons lagringstid (2026-10-30), stored on the company; left out = unchanged. */
  absenceRetentionMonths: absenceRetentionMonthsSchema.optional(),
});
export type PayrollSettingsInput = z.infer<typeof payrollSettingsSchema>;

export type PayrollSettings = {
  system: PayrollSystem; systemName: string; mode: PayrollMode; importedEditable: boolean;
  codeMap: CodeMap; exportCodes: Partial<Record<AbsenceType, string>>; importTemplates: ImportTemplate[]; exportTemplates: ExportTemplate[]; sftp: SftpSettings;
  lastImportAt: string | null; lastExportAt: string | null; lastError: string;
  /** Months absence is kept after it ended (1–120); removed every night after that. */
  absenceRetentionMonths: number;
};

/** A stored row (or none) → settings; anything unreadable falls back to the default rather than failing the page. */
export function readPayrollSettings(row: { system: string; systemName: string; mode: string; importedEditable: boolean; codeMap: unknown; exportCodes: unknown; importTemplates: unknown; exportTemplates: unknown; sftp: unknown; lastImportAt: Date | null; lastExportAt: Date | null; lastError: string } | null, absenceRetentionMonths?: unknown): PayrollSettings {
  const safe = <T,>(schema: z.ZodType<T>, value: unknown, fallback: T) => { const parsed = schema.safeParse(value); return parsed.success ? parsed.data : fallback; };
  return {
    system: (PAYROLL_SYSTEMS as readonly string[]).includes(row?.system ?? "") ? row!.system as PayrollSystem : "none",
    systemName: row?.systemName ?? "",
    mode: (PAYROLL_MODES as readonly string[]).includes(row?.mode ?? "") ? row!.mode as PayrollMode : "manual",
    importedEditable: row?.importedEditable ?? false,
    codeMap: safe(codeMapSchema, row?.codeMap, {}) as CodeMap,
    exportCodes: safe(exportCodesSchema, row?.exportCodes, {}),
    importTemplates: safe(z.array(importTemplateSchema).max(50), row?.importTemplates, []),
    exportTemplates: Array.isArray(row?.exportTemplates) ? (row!.exportTemplates as unknown[]).flatMap((item) => { const parsed = exportTemplateSchema.safeParse(item); return parsed.success ? [parsed.data] : []; }).slice(0, 30) : [],
    sftp: safe(sftpSettingsSchema, row?.sftp, sftpSettingsSchema.parse({})),
    lastImportAt: row?.lastImportAt?.toISOString() ?? null, lastExportAt: row?.lastExportAt?.toISOString() ?? null, lastError: row?.lastError ?? "",
    absenceRetentionMonths: absenceRetentionMonthsOf(absenceRetentionMonths),
  };
}

/** The fingerprint of a file's headings, to find a saved column choice for the same kind of file again. */
export const headingFingerprint = (headers: readonly string[]) => headers.map((header) => normalizeCode(header)).join("|").slice(0, 2000);

/** Merges codes into the company's mapping (keys normalised). */
export const mergeCodeMap = (current: CodeMap, added: Record<string, string>): CodeMap =>
  ({ ...current, ...Object.fromEntries(Object.entries(added).flatMap(([code, type]) => normalizeCode(code) && (CODE_TARGETS as readonly string[]).includes(type) ? [[normalizeCode(code), type as CodeMap[string]]] : [])) });
