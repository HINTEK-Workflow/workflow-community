import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireModule, requireNotPaused } from "@/lib/kfid/server";
import { basisRequestSchema, exportFile, exportPreview, exportRequestSchema, payrollBasisFile, payrollBasisPreview, payrollOverview, saveCodeMap, saveEmployeeNumber, saveExportTemplate, saveNoFixedHours, savePayrollSettings, staffNumbers } from "@/lib/payroll/server";

/**
 * Lön och frånvaro (2026-10-29, lib/payroll/server.ts): the settings on Kopplingar, the export to a time or payroll system and
 * the history. Every call checks the session, company and membership; changes check Origin and the right in lib/payroll/server.
 * Absence and staff files are imported on the Import page (/api/import), never here. Löneunderlag per period (2026-10-30): the
 * summary per person as JSON, PDF or CSV, with the same right as the export.
 */
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), settings: z.unknown() }),
  z.object({ action: z.literal("codes"), codes: z.record(z.string().max(60), z.string().max(20)) }),
  z.object({ action: z.literal("template_save"), template: z.unknown() }),
  z.object({ action: z.literal("template_delete"), id: z.string().min(1).max(40) }),
  z.object({ action: z.literal("employee_number"), userId: z.string().min(1).max(60), employeeNumber: z.string().max(40) }),
  z.object({ action: z.literal("fixed_hours"), userId: z.string().min(1).max(60), noFixedHours: z.boolean() }),
  z.object({ action: z.literal("export_preview"), request: exportRequestSchema }),
  z.object({ action: z.literal("export"), request: exportRequestSchema }),
  z.object({ action: z.literal("basis"), request: basisRequestSchema }),
  z.object({ action: z.literal("basis_file"), request: basisRequestSchema, format: z.enum(["pdf", "csv"]) }),
]);
/** Reads by POST: the file, the preview and the pay basis change nothing, so a paused company keeps them (beslut 11). They only log that a file was made. */
const READ_ACTIONS: ReadonlySet<string> = new Set(["export_preview", "export", "basis", "basis_file"]);
const download = (file: { bytes: Uint8Array; mimeType: string; fileName: string }) => new Response(file.bytes as unknown as BodyInit, { headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET(request: Request) {
  try {
    const ctx = await context();
    if (new URL(request.url).searchParams.get("staff") === "1") return NextResponse.json({ staff: await staffNumbers(ctx) });
    return NextResponse.json(await payrollOverview(ctx));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context({ allowedWhenPaused: true });
    const input = requestSchema.parse(await body(request));
    if (!READ_ACTIONS.has(input.action)) requireNotPaused(ctx);
    // The file and the pay basis are reads, so the history can be exported with Tid och lön off.
    if (!READ_ACTIONS.has(input.action)) requireModule(ctx, "time");
    if (input.action === "settings") await savePayrollSettings(ctx, input.settings);
    else if (input.action === "codes") await saveCodeMap(ctx, input.codes);
    else if (input.action === "template_save") await saveExportTemplate(ctx, input.template);
    else if (input.action === "template_delete") await saveExportTemplate(ctx, input.id, true);
    else if (input.action === "employee_number") await saveEmployeeNumber(ctx, input.userId, input.employeeNumber);
    else if (input.action === "fixed_hours") await saveNoFixedHours(ctx, input.userId, input.noFixedHours);
    else if (input.action === "export_preview") return NextResponse.json(await exportPreview(ctx, input.request));
    else if (input.action === "export") return download(await exportFile(ctx, input.request));
    else if (input.action === "basis") return NextResponse.json(await payrollBasisPreview(ctx, input.request));
    else return download(await payrollBasisFile(ctx, input.request, input.format));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
